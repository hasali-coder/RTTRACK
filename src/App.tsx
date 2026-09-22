import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Bell, BookOpen, CalendarDays, ChevronDown, ChevronRight, CircleHelp, ClipboardList, HeartPulse, LayoutDashboard, LogOut, Menu, ShieldCheck, Stethoscope, Users, X } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { configured, supabase } from './supabase';
import AdminDoctorApprovals from './AdminDoctorApprovals';
import AdminReviewHistory from './AdminReviewHistory';
import AdminActivityLog from './AdminActivityLog';
import AdminReports from './AdminReports';
import PatientPortal from './PatientPortal';
import ConnectionsPanel from './ConnectionsPanel';
import { ClinicianTreatmentManager } from './TreatmentModule';
import { ClinicianSymptomReview } from './SymptomModule';
import EducationHub, { EducationManager } from './EducationHub';
import ClinicianDashboard from './ClinicianDashboard';
import ClinicianPatients from './ClinicianPatients';
import './doctor-portal.css';

type Application = { full_name: string; email: string; institution: string; registration_number: string; status: 'pending' | 'approved' | 'rejected' | 'deactivated' | 'reapproval_requested' };
type Mode = 'register' | 'login' | 'patient-register';
type PatientProfile = { full_name: string };
type AdminSection = 'doctors' | 'education' | 'reviews' | 'activity' | 'reports';
type NavigationContext = { planId?: string; patientId?: string; status?: 'draft' | 'active'; fractionNumber?: number; connectionFilter?: 'pending' | 'active' };
type TreatmentFocus = Pick<NavigationContext, 'planId' | 'patientId' | 'status' | 'fractionNumber'>;
const navigation = [
  { label: 'Dashboard', Icon: LayoutDashboard }, { label: 'Connections', Icon: Users }, { label: 'Patients', Icon: Users },
  { label: 'Treatment', Icon: CalendarDays }, { label: 'Symptoms', Icon: HeartPulse },
  { label: 'Education', Icon: BookOpen }, { label: 'Insights', Icon: Activity },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(null);
  const [patientLookupFailed, setPatientLookupFailed] = useState(false);
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fullName, setFullName] = useState('');
  const [registration, setRegistration] = useState('');
  const [institution, setInstitution] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState('Dashboard');
  const [mobile, setMobile] = useState(false);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [adminView, setAdminView] = useState(false);
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [adminSection, setAdminSection] = useState<AdminSection>('doctors');
  const [adminDoctorFilter, setAdminDoctorFilter] = useState<'all' | 'pending' | 'approved'>('all');
  const [treatmentFocus, setTreatmentFocus] = useState<TreatmentFocus | undefined>();
  const [connectionFocus, setConnectionFocus] = useState<'pending' | 'active' | undefined>();
  const [applicationLookupFailed, setApplicationLookupFailed] = useState(false);
  const [reapprovalReason, setReapprovalReason] = useState('');
  const [reapprovalBusy, setReapprovalBusy] = useState(false);
  const [founderPassword, setFounderPassword] = useState('');
  const [founderPasswordConfirm, setFounderPasswordConfirm] = useState('');
  const [founderSaving, setFounderSaving] = useState(false);

  async function loadAdminRole(id: string) {
    if (!supabase) return;
    const { data, error: roleError } = await supabase.from('rttrack_administrators').select('user_id').eq('user_id',id).maybeSingle();
    setIsAdministrator(!roleError && !!data);
  }

  async function loadApplication(id: string) {
    if (!supabase) return;
    const { data, error: queryError } = await supabase.from('clinician_applications')
      .select('full_name,email,institution,registration_number,status').eq('user_id', id).maybeSingle();
    if (queryError) { setError('Unable to check account access. Please contact the RTTRACK administrator.'); setApplicationLookupFailed(true); setApplication(null); return; }
    setApplicationLookupFailed(false);
    setApplication(data as Application | null);
  }

  async function loadPatient(id: string) {
    if (!supabase) return;
    const { data, error: queryError } = await supabase.from('patient_profiles')
      .select('full_name').eq('user_id', id).maybeSingle();
    if (queryError) {
      setPatientLookupFailed(true);
      setPatientProfile(null);
      setError('Unable to verify your patient account. Please contact RTTRACK support.');
      return;
    }
    setPatientLookupFailed(false);
    setPatientProfile(data as PatientProfile | null);
  }

  useEffect(() => {
    if (!supabase) { setBusy(false); return; }
    const client = supabase;
    let mounted = true;
    client.auth.getUser().then(async ({ data: { user: current } }) => {
      if (!mounted) return;
      setUser(current);
      if (current) await Promise.all([loadApplication(current.id), loadAdminRole(current.id), loadPatient(current.id)]);
      if (mounted) setBusy(false);
    }).catch(() => { if (mounted) { setError('Could not connect to Supabase.'); setBusy(false); } });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      if (!session) { setApplication(null); setPatientProfile(null); setPatientLookupFailed(false); setIsAdministrator(false); setAdminView(false); setAdminExpanded(false); setTreatmentFocus(undefined); setConnectionFocus(undefined); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // Refresh access state when a background tab returns, and periodically while visible.
  // Server-side RPC checks are authoritative; this only clears stale portal UI.
  useEffect(() => {
    if (!user) return;
    const recheck = () => { if (document.visibilityState === 'visible') void loadApplication(user.id); };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    const timer = window.setInterval(recheck, 60_000);
    return () => { document.removeEventListener('visibilitychange', recheck); window.removeEventListener('focus', recheck); window.clearInterval(timer); };
  }, [user?.id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || sending) return;
    setSending(true); setError(''); setMessage('');
    try {
      if (mode === 'register' || mode === 'patient-register') {
        const { error: authError } = await supabase.auth.signUp({ email, password, options: {
          data: mode === 'patient-register'
            ? { account_type: 'patient', full_name: fullName.trim() }
            : { account_type: 'clinician', full_name: fullName.trim(), registration_number: registration.trim(), institution: institution.trim() },
          emailRedirectTo: window.location.origin,
        } });
        if (authError) throw authError;
        setMessage(mode === 'patient-register'
          ? 'If registration succeeded, check your inbox and confirm your email. You can then sign in to your private patient dashboard.'
          : 'If registration succeeded, check your inbox and confirm your email. Your clinician application will remain pending until an administrator verifies your credentials.');
        setMode('login'); setPassword('');
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        setUser(data.user);
        await Promise.all([loadApplication(data.user.id), loadAdminRole(data.user.id), loadPatient(data.user.id)]);
        setPassword('');
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Please try again.'); }
    finally { setSending(false); }
  }
  async function completeFounderInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user || founderSaving) return;
    setError('');
    if (founderPassword.length < 12) { setError('Use a password of at least 12 characters.'); return; }
    if (founderPassword !== founderPasswordConfirm) { setError('The passwords do not match.'); return; }
    setFounderSaving(true);
    try {
      // This user-controlled metadata only tracks completion of the UI step.
      // It does NOT grant administrator access: the RLS-protected membership table does.
      const { data, error: updateError } = await supabase.auth.updateUser({
        password: founderPassword,
        data: { rttrack_founder_setup_complete: true },
      });
      if (updateError) throw updateError;
      if (!data.user) throw new Error('The account update was not confirmed. Please try again.');
      setUser(data.user);
      setFounderPassword('');
      setFounderPasswordConfirm('');
      setMessage('Password set. The existing founding administrator must now activate your administrator membership.');
      await loadAdminRole(data.user.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not set password. Please try again.');
    } finally {
      setFounderSaving(false);
    }
  }

  async function requestReapproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user || reapprovalBusy || reapprovalReason.trim().length < 15) return;
    setReapprovalBusy(true); setError(''); setMessage('');
    try {
      const {error: requestError} = await supabase.rpc('rttrack_request_doctor_reapproval', {p_reason:reapprovalReason.trim()});
      if (requestError) throw requestError;
      setReapprovalReason('');
      await loadApplication(user.id);
      setMessage('Reapproval requested. An administrator will review your request.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not send request.'); }
    finally { setReapprovalBusy(false); }
  }

  async function signOut() { await supabase?.auth.signOut(); setUser(null); setApplication(null); setPatientProfile(null); setPatientLookupFailed(false); setIsAdministrator(false); setAdminView(false); setAdminExpanded(false); setTreatmentFocus(undefined); setConnectionFocus(undefined); setMessage(''); setError(''); setMode('login'); setFounderPassword(''); setFounderPasswordConfirm(''); }

  if (!configured) return <div className="setup"><h1>RTTRACK · Setup required</h1><p>Copy <code>.env.example</code> to <code>.env</code>, paste your Supabase project URL and publishable key, then restart the development server.</p><p>Never paste a secret or service-role key into the frontend.</p></div>;
  if (busy) return <div className="setup" role="status">Loading RTTRACK…</div>;

  if (!user) return <main className="auth-page"><section className="auth-panel"><div className="brand">RTTRACK</div><span className="eyebrow">{mode === 'patient-register' ? 'PATIENT PORTAL' : 'SECURE ACCESS'}</span><h1>{mode === 'login' ? 'Welcome back' : mode === 'patient-register' ? 'Create your patient account' : 'Create your doctor account'}</h1><p className="muted">{mode === 'patient-register' ? 'Create your private account. A clinician connection and treatment plan will be added in a future milestone.' : mode === 'register' ? 'Your clinical access begins only after credential verification and administrator approval.' : 'Sign in to your RTTRACK account.'}</p>
    {error && <p className="alert error" role="alert">{error}</p>}{message && <p className="alert success" role="status">{message}</p>}
    <form onSubmit={submit} className="auth-form">
      {mode !== 'login' && <label>Full name<input value={fullName} onChange={e => setFullName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" /></label>}
      {mode === 'register' && <><label>Professional registration number<input value={registration} onChange={e => setRegistration(e.target.value)} required maxLength={80} /></label><label>Hospital / institution<input value={institution} onChange={e => setInstitution(e.target.value)} required maxLength={160} /></label></>}
      <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
      <button className="primary" disabled={sending}>{sending ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'patient-register' ? 'Create patient account' : 'Submit doctor application'}</button>
    </form>
    <div aria-label="Account options" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
      {mode !== 'login' && <button className="text-button" onClick={() => { setMode('login'); setError(''); setMessage(''); }}>Already registered? Sign in</button>}
      {mode !== 'patient-register' && <button className="text-button" onClick={() => { setMode('patient-register'); setError(''); setMessage(''); }}>Register as patient</button>}
      {mode !== 'register' && <button className="text-button" onClick={() => { setMode('register'); setError(''); setMessage(''); }}>Register as doctor</button>}
    </div>
    <p className="fine-print">Development only. Use fictional test identities. Never enter actual patient records or health information.</p>
  </section></main>;

  const approved = application?.status === 'approved';
  const adminAccess = isAdministrator && !!user.email_confirmed_at && application?.status !== 'deactivated' && application?.status !== 'reapproval_requested';
  // Invited administrators have no clinician application. They set their own password
  // before we show any administration controls; existing clinician accounts are unchanged.
  const founderSetupComplete = user.user_metadata?.rttrack_founder_setup_complete === true;
  if (patientLookupFailed) return <main className="auth-page"><section className="auth-panel"><div className="brand">RTTRACK</div><h1>Account check unavailable</h1><p className="muted">Patient-account permissions could not be verified. Confirm that migration 003 has been installed.</p>{error && <p className="alert error" role="alert">{error}</p>}<button className="outline" onClick={() => { setError(''); void loadPatient(user.id); }}>Retry account check</button><button className="text-button" onClick={signOut}>Sign out</button></section></main>;
  if (patientProfile) return <PatientPortal name={patientProfile.full_name} email={user.email ?? ''} userId={user.id} onSignOut={signOut} />;
  if (!application && user.user_metadata?.account_type === 'patient') return <main className="auth-page"><section className="auth-panel"><div className="brand">RTTRACK</div><h1>Patient profile unavailable</h1><p className="muted">Your patient profile could not be found. No account privileges have been granted. Contact RTTRACK support.</p><button className="outline" onClick={() => void loadPatient(user.id)}>Retry</button><button className="text-button" onClick={signOut}>Sign out</button></section></main>;
  if (applicationLookupFailed) return <main className="auth-page"><section className="auth-panel"><div className="brand">RTTRACK</div><h1>Account check unavailable</h1><p className="muted">We couldn't check the account's access restrictions. No clinical or administration records are available until this is resolved.</p>{error && <p className="alert error" role="alert">{error}</p>}<button className="outline" onClick={() => {setError(''); void Promise.all([loadApplication(user.id), loadAdminRole(user.id)]);}}>Retry account check</button><button className="text-button" onClick={signOut}>Sign out</button></section></main>;
  if (!application && !founderSetupComplete) return <main className="auth-page"><section className="auth-panel"><div className="brand">RTTRACK</div><span className="eyebrow">FOUNDING ADMINISTRATOR INVITATION</span><h1>Set your password</h1><p className="muted">Your invitation has been accepted. Choose a private password to finish setting up your account. Administrator privileges will be assigned separately by an authorised founder.</p>{error && <p className="alert error" role="alert">{error}</p>}
    <form className="auth-form" onSubmit={completeFounderInvitation}><label>New password<input type="password" value={founderPassword} onChange={e => setFounderPassword(e.target.value)} required minLength={12} autoComplete="new-password" /></label><label>Confirm password<input type="password" value={founderPasswordConfirm} onChange={e => setFounderPasswordConfirm(e.target.value)} required minLength={12} autoComplete="new-password" /></label><button className="primary" disabled={founderSaving}>{founderSaving ? 'Saving…' : 'Set password'}</button></form><button className="text-button" onClick={signOut}>Sign out</button><p className="fine-print">Development use only. Do not enter real patient information.</p></section></main>;
  return <div className="app-shell"><aside className={`sidebar ${mobile ? 'open' : ''}`}><div className="brand">RTTRACK</div><div className="identity"><div className="avatar"><Stethoscope size={19}/></div><div><strong>{application?.full_name || user.email}</strong><small>{adminAccess ? 'Founding administrator' : approved ? 'Approved doctor' : 'Access pending'}</small></div></div><nav aria-label="Doctor navigation">{adminAccess && <><button type="button" aria-expanded={adminExpanded} aria-controls="rttrack-admin-subnav" className={`nav-link rtadm-parent ${adminView ? 'selected' : ''}`} onClick={() => {setAdminExpanded(expanded => !expanded);setAdminView(true);setMobile(false);}}><ShieldCheck size={19}/>Administration{adminExpanded ? <ChevronDown className="rtadm-chevron" size={16}/> : <ChevronRight className="rtadm-chevron" size={16}/>}</button>{adminExpanded && <div id="rttrack-admin-subnav" className="rtadm-subnav">
      <button type="button" className={`nav-link ${adminView && adminSection === 'doctors' ? 'selected' : ''}`} onClick={() => {setAdminView(true);setAdminSection('doctors');setAdminDoctorFilter('all');setMobile(false);}}>Doctor approvals</button>
      <button type="button" className={`nav-link ${adminView && adminSection === 'education' ? 'selected' : ''}`} onClick={() => {setAdminView(true);setAdminSection('education');setMobile(false);}}>Education management</button>
      <button type="button" className={`nav-link ${adminView && adminSection === 'reviews' ? 'selected' : ''}`} onClick={() => {setAdminView(true);setAdminSection('reviews');setMobile(false);}}>Doctor review history</button>
      <button type="button" className={`nav-link ${adminView && adminSection === 'activity' ? 'selected' : ''}`} onClick={() => {setAdminView(true);setAdminSection('activity');setMobile(false);}}>Activity log</button>
      <button type="button" className={`nav-link ${adminView && adminSection === 'reports' ? 'selected' : ''}`} onClick={() => {setAdminView(true);setAdminSection('reports');setMobile(false);}}>Reports</button>
    </div>}</>}{navigation.map(({ label, Icon }) => <button key={label} disabled={!approved} className={`nav-link ${active === label ? 'selected' : ''}`} onClick={() => { setAdminView(false); setActive(label); setTreatmentFocus(undefined); setConnectionFocus(undefined); setMobile(false); }}><Icon size={19}/>{label}</button>)}</nav><div className="sidebar-bottom"><button className="emergency" onClick={() => setMessage('Emergency services are not connected. Follow your clinical emergency protocol.')}>✱ &nbsp; Emergency protocol</button><button className="signout" onClick={signOut}><LogOut size={17}/> Sign out</button></div></aside>
    <button type="button" className="rttrack-mobile-backdrop" aria-label="Close navigation" tabIndex={-1} onClick={() => setMobile(false)} hidden={!mobile} />
    <div className="content"><header className="topbar"><button className="menu" aria-label="Toggle navigation" onClick={() => setMobile(!mobile)}>{mobile ? <X/> : <Menu/>}</button><strong>{adminAccess && (adminView || !application) ? 'Administration Centre' : 'Doctor Portal'}</strong><div className="top-actions"><Bell size={19}/><CircleHelp size={19}/><span>{application?.full_name || user.email}</span></div></header><main className="workspace">{message && <p className="alert success" role="status">{message}</p>}{error && <p className="alert error" role="alert">{error}</p>}
    {adminAccess && (adminView || !application) ? adminSection === 'doctors' ? <AdminDoctorApprovals initialFilter={adminDoctorFilter}/> : adminSection === 'education' ? <EducationManager/> : adminSection === 'reviews' ? <AdminReviewHistory/> : adminSection === 'activity' ? <AdminActivityLog/> : <AdminReports/> : !application ? <section className="panel"><h1>Awaiting administrator activation</h1><p>Your invitation and password setup are complete. A founding administrator must grant your account administrator membership before you can access the Administration Centre. You do not need to register as a clinician.</p>{message && <p className="alert success" role="status">{message}</p>}<button className="outline" onClick={() => void loadAdminRole(user.id)}>Refresh administrator status</button></section> : application?.status === 'deactivated' || application?.status === 'reapproval_requested' ? <section className="panel"><span className="eyebrow">DOCTOR ACCOUNT</span><h1>{application.status === 'deactivated' ? 'Account deactivated' : 'Reapproval requested'}</h1><p className="muted">Clinical access is suspended. Your existing patient connections and records are retained, but you cannot access them unless an administrator reapproves your account.</p>{application.status === 'deactivated' ? <form className="auth-form" onSubmit={requestReapproval}><label>Reason for requesting reapproval<textarea required minLength={15} maxLength={2000} value={reapprovalReason} onChange={e=>setReapprovalReason(e.target.value)} placeholder="Explain why your access should be reviewed." /></label><button className="primary" disabled={reapprovalBusy || reapprovalReason.trim().length<15}>{reapprovalBusy ? 'Submitting…' : 'Request reapproval'}</button></form> : <p>Your request is awaiting administrator review.</p>}<button className="outline" onClick={()=>void loadApplication(user.id)}>Refresh account status</button><button className="text-button" onClick={signOut}>Sign out</button></section> : !approved ? <><span className="eyebrow">DOCTOR VERIFICATION</span><h1>Application {application.status === 'pending' ? 'under review' : 'not approved'}</h1><p className="muted">Your account is registered, but access to patient records is blocked until credentials are checked and approved.</p><section className="panel status-panel"><ShieldCheck size={35} color="#0c5c9f"/><div><h2>{application.status === 'pending' ? 'Verification pending' : 'Verification decision'}</h2><p>{application.status === 'pending' ? 'An RTTRACK administrator must verify your professional registration and institutional affiliation before granting access.' : 'Your application was not approved. Contact the RTTRACK administrator for more information.'}</p><dl><dt>Name</dt><dd>{application.full_name}</dd><dt>Institution</dt><dd>{application.institution}</dd><dt>Registration number</dt><dd>{application.registration_number}</dd><dt>Status</dt><dd><span className="pill">{application.status}</span></dd></dl><button className="outline" onClick={() => loadApplication(user.id)}>Refresh approval status</button></div></section></> : active === 'Connections' ? <ConnectionsPanel role="clinician" userId={user.id} initialFilter={connectionFocus}/> : active === 'Patients' ? <ClinicianPatients userId={user.id} onNavigate={destination => { setActive(destination); setAdminView(false); setTreatmentFocus(undefined); setConnectionFocus(undefined); setMobile(false); }} /> : active === 'Treatment' ? <ClinicianTreatmentManager userId={user.id} focus={treatmentFocus}/> : active === 'Symptoms' ? <ClinicianSymptomReview userId={user.id}/> : active === 'Education' ? <EducationHub/> : active === 'Dashboard' ? <ClinicianDashboard userId={user.id} clinicianName={application.full_name} onNavigate={(destination, context) => { setActive(destination); setAdminView(false); setTreatmentFocus(destination === 'Treatment' ? context : undefined); setConnectionFocus(destination === 'Connections' ? context?.connectionFilter : undefined); setMobile(false); }} /> : <><span className="eyebrow">DOCTOR PORTAL</span><h1>{active === 'Dashboard' ? `Welcome, ${application.full_name.split(' ')[0]}` : active}</h1><p className="muted">Manage your care connections, treatment plans and symptoms.</p><section className="panel"><div className="panel-head"><ClipboardList color="#0c5c9f"/><h2>{active === 'Dashboard' ? 'Clinical workspace' : `${active} module`}</h2></div><p>Open a module from the sidebar to continue.</p><div className="feature-grid"><div><strong>Patient connections</strong><small>Available under Connections</small></div><div><strong>Treatment plans</strong><small>Available under Treatment</small></div><div><strong>Email reminders</strong><small>Planned next · SMS-ready architecture</small></div></div></section></>}
    </main></div>
  </div>;
}
