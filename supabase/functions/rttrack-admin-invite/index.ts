import { createClient } from 'npm:@supabase/supabase-js@2';

const corsFor = (origin: string | null) => {
  const configured = (Deno.env.get('RTTRACK_ALLOWED_ORIGINS') || 'https://rttrack.vercel.app,http://localhost:5173')
    .split(',').map(value => value.trim()).filter(Boolean);
  const allowed = origin && configured.includes(origin) ? origin : configured[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };
};

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });

function keyFromEnvironment(named: string, legacy: string) {
  const combined = Deno.env.get(named);
  if (combined) {
    try {
      const parsed = JSON.parse(combined) as Record<string, string>;
      const first = parsed.default || Object.values(parsed)[0];
      if (typeof first === 'string') return first;
    } catch { /* legacy fallback */ }
  }
  return Deno.env.get(legacy) || '';
}

type InviteRequest = {
  role?: unknown;
  full_name?: unknown;
  email?: unknown;
  institution?: unknown;
  registration_number?: unknown;
};

Deno.serve(async (req: Request) => {
  const headers = corsFor(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);

  const origin = req.headers.get('Origin');
  if (origin && headers['Access-Control-Allow-Origin'] !== origin) {
    return json({ error: 'Origin is not allowed' }, 403, headers);
  }
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in required' }, 401, headers);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const publicKey = keyFromEnvironment('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const serverKey = keyFromEnvironment('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serverKey) {
    console.error('Missing backend Supabase environment configuration');
    return json({ error: 'Account invitation service is not configured' }, 503, headers);
  }

  const callerClient = createClient(url, publicKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authResult, error: authError } = await callerClient.auth.getUser(token);
  if (authError || !authResult.user || !authResult.user.email_confirmed_at) {
    return json({ error: 'A confirmed administrator session is required' }, 401, headers);
  }
  const { data: isAdmin, error: adminError } = await callerClient.rpc('rttrack_is_administrator');
  if (adminError || isAdmin !== true) {
    return json({ error: 'Administrator privileges are required' }, 403, headers);
  }

  let input: InviteRequest;
  try { input = await req.json(); }
  catch { return json({ error: 'Invalid request' }, 400, headers); }

  const role = input.role === 'doctor' ? 'doctor' : input.role === 'patient' ? 'patient' : null;
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const name = typeof input.full_name === 'string' ? input.full_name.trim() : '';
  const institution = typeof input.institution === 'string' ? input.institution.trim() : '';
  const registration = typeof input.registration_number === 'string' ? input.registration_number.trim() : '';
  if (!role || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      name.length < 2 || name.length > 120 || /[\r\n]/.test(name) ||
      (role === 'doctor' && (!institution || institution.length > 160 || !registration || registration.length > 80))) {
    return json({ error: 'Check role, email, name and required doctor registration details.' }, 400, headers);
  }

  const admin = createClient(url, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const site = (Deno.env.get('RTTRACK_APP_URL') || 'https://rttrack.vercel.app').trim();
  if (!/^https:\/\/[^\s]+$/.test(site) && site !== 'http://localhost:5173') {
    return json({ error: 'Invitation redirect is not configured' }, 503, headers);
  }

  // Auth's invitation email contains only an activation link, never a password.
  // Existing Auth triggers independently create the patient profile or pending
  // doctor application from these bounded metadata fields.
  const metadata = {
    account_type: role === 'doctor' ? 'clinician' : 'patient',
    full_name: name,
    rttrack_admin_invited: true,
    ...(role === 'doctor' ? { institution, registration_number: registration } : {}),
  };
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: metadata,
    redirectTo: site,
  });
  if (inviteError || !invited.user) {
    console.error('User invite failed', inviteError?.status, inviteError?.code);
    const exists = inviteError?.status === 422 || /already|registered|exists/i.test(inviteError?.message || '');
    return json({ error: exists ? 'An account already exists for this email.' : 'Invitation could not be sent. Check Auth email configuration.' }, exists ? 409 : 502, headers);
  }

  // This audit row also enables the database-enforced first-password gate.
  const { error: auditError } = await admin.from('rttrack_account_invites').insert({
    user_id: invited.user.id,
    invited_by: authResult.user.id,
    role,
  });
  if (auditError) {
    console.error('Invite audit failed', auditError.code, auditError.message);
    // Fail closed: invalidating the new invite is safer than granting a user
    // an account without the server-side password-setup gate.
    const { error: rollbackError } = await admin.auth.admin.deleteUser(invited.user.id);
    if (rollbackError) console.error('Invite rollback requires manual investigation', rollbackError.code);
    return json({ error: 'Invitation setup did not complete. Check function logs before retrying.' }, 500, headers);
  }

  return json({ success: true, message: 'Activation invitation sent. Access remains restricted until activation and applicable doctor approval.' }, 201, headers);
});
