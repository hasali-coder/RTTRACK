import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link2, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import { supabase } from './supabase';
import './connections.css';

type Role = 'patient' | 'clinician';
type DirectoryEntry = { clinician_id: string; full_name: string; institution: string };
type Connection = {
  id: string; patient_id: string; clinician_id: string; patient_name: string;
  clinician_name: string; institution: string; initiated_by: string;
  status: 'pending' | 'active' | 'declined' | 'revoked';
  is_primary: boolean; patient_consented_at: string | null; created_at: string;
};
type SharingRecord = { link_id: string; allowed: boolean; allowed_at: string | null };
type Props = { role: Role; userId: string };

export default function ConnectionsPanel({ role, userId }: Props) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [discoverable, setDiscoverable] = useState(false);
  const [search, setSearch] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [consentFor, setConsentFor] = useState<string[]>([]);
  const [sharing, setSharing] = useState<Record<string, boolean>>({});
  const [sharingConfirmed, setSharingConfirmed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const links = await supabase.rpc('rttrack_list_my_links');
      if (links.error) throw links.error;
      setConnections((links.data ?? []) as Connection[]);
      const sharingResult = await supabase.rpc('rttrack_my_treatment_sharing');
      if (sharingResult.error) throw sharingResult.error;
      setSharing(Object.fromEntries(((sharingResult.data ?? []) as SharingRecord[]).map(row => [row.link_id, row.allowed])));
      if (role === 'patient') {
        const result = await supabase.rpc('rttrack_find_clinicians');
        if (result.error) throw result.error;
        setDirectory((result.data ?? []) as DirectoryEntry[]);
      } else {
        const result = await supabase.rpc('rttrack_my_discoverability');
        if (result.error) throw result.error;
        setDiscoverable(result.data === true);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load connections. Check migration 004.'); }
    finally { setLoading(false); }
  }, [role]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function execute(action: (client: NonNullable<typeof supabase>) => Promise<{ error: { message: string } | null }>, success: string) {
    const client = supabase;
    if (!client) { setError('Supabase is not configured.'); return; }
    if (saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await action(client);
      if (result.error) throw new Error(result.error.message);
      setMessage(success);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Action failed. Please retry.'); }
    finally { setSaving(false); }
  }
  async function requestPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requested = patientEmail.trim();
    if (!requested || !supabase) return;
    await execute(async (client) => client.rpc('rttrack_clinician_request_patient', { p_patient_email: requested }),
      'If the account is eligible, a connection request was recorded. Ask the patient to sign in and review it.');
    setPatientEmail('');
  }
  async function requestClinician(id: string) {
    if (!supabase || !consent) return;
    await execute(async (client) => client.rpc('rttrack_patient_request_clinician', {
      p_clinician_id: id, p_consent: true,
    }), 'Connection request submitted. Awaiting clinician acceptance.');
    setConsent(false);
  }
  async function respond(link: Connection, accept: boolean) {
    if (!supabase) return;
    const patientConsent = role === 'patient' && consentFor.includes(link.id);
    if (accept && role === 'patient' && !patientConsent) {
      setError('Please explicitly confirm consent for this connection.'); return;
    }
    await execute(async (client) => client.rpc('rttrack_respond_link', {
      p_link_id: link.id, p_accept: accept, p_patient_consent: patientConsent,
    }), accept ? 'Connection accepted.' : 'Request declined.');
    setConsentFor(old => old.filter(id => id !== link.id));
  }
  async function changeSharing(link: Connection, allow: boolean) {
    if (role !== 'patient' || link.status !== 'active' || !supabase) return;
    if (allow && !sharingConfirmed.includes(link.id)) { setError('Check the separate treatment-record consent first.'); return; }
    if (!allow && !window.confirm('Withdraw this clinician’s access to treatment records? This will block new clinician access and updates; your own published plan stays visible to you.')) return;
    await execute(async client => client.rpc('rttrack_set_treatment_sharing', { p_link_id: link.id, p_allow: allow }),
      allow ? 'Treatment-record sharing authorised for this clinician.' : 'Treatment-record sharing withdrawn.');
    setSharingConfirmed(previous => previous.filter(id => id !== link.id));
  }
  const openPairIds = new Set(connections.filter(l => l.status === 'pending' || l.status === 'active')
    .map(l => l.clinician_id));
  const visible = directory.filter(item => `${item.full_name} ${item.institution}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="rtc-panel" aria-label="Patient–clinician connections">
    <div className="rtc-heading"><div><span className="rtc-eyebrow">RTTRACK · CARE CONNECTIONS</span><h2>{role === 'patient' ? 'My care team' : 'Patient connections'}</h2><p>Development only · Use fictional identities. A connection alone never grants treatment-record access. Patients can separately opt in below.</p></div>
      <button type="button" className="rtc-outline" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw size={16}/> Refresh</button></div>
    {error && <p className="rtc-error" role="alert">{error}</p>}
    {message && <p className="rtc-success" role="status">{message}</p>}
    {loading ? <p role="status">Loading connections…</p> : <>
      <div className="rtc-grid">
        {role === 'patient' ? <section className="rtc-card"><h3><UserPlus size={20}/> Find a clinician</h3>
          <p>Only approved clinicians who have opted into the directory appear here.</p>
          <label className="rtc-label">Search name or institution<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clinicians" /></label>
          <label className="rtc-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>
            I consent to sending my name and connection request to the selected clinician. I understand this does not share treatment records.</label>
          {visible.length === 0 ? <p>No discoverable clinicians found. An approved clinician must opt into the directory first.</p> : visible.map(item =>
            <div className="rtc-person" key={item.clinician_id}><div><strong>{item.full_name}</strong><small>{item.institution}</small></div>
              <button type="button" className="rtc-primary" disabled={!consent || saving || openPairIds.has(item.clinician_id)} onClick={() => void requestClinician(item.clinician_id)}>
                {openPairIds.has(item.clinician_id) ? 'Already connected/requested' : 'Request connection'}</button></div>)}
        </section> : <section className="rtc-card"><h3><UserPlus size={20}/> Clinician directory and requests</h3>
          <p>Directory listing is optional. Patients can only find you if you choose to be discoverable.</p>
          <label className="rtc-consent"><input type="checkbox" checked={discoverable} disabled={saving} onChange={e => {
            if (!supabase) return;
            void execute(async (client) => client.rpc('rttrack_set_discoverable', { p_discoverable: e.target.checked }),
              'Your directory preference has been saved.');
          }}/> Show my name and self-reported institution in the patient directory</label>
          <form onSubmit={e => void requestPatient(e)} className="rtc-form"><label className="rtc-label">Patient email (provided to you by the patient)
            <input type="email" required value={patientEmail} onChange={e => setPatientEmail(e.target.value)} placeholder="patient@example.com" maxLength={254}/></label>
            <button type="submit" className="rtc-primary" disabled={saving || !patientEmail.trim()}>Request connection</button></form>
          <p className="rtc-help">For privacy, RTTRACK does not reveal whether an email matches an account. The patient must consent before a clinician-initiated request becomes active.</p>
        </section>}
        <section className="rtc-card"><h3><Link2 size={20}/> My connections</h3>
          {connections.length === 0 ? <p>No connection requests yet.</p> : connections.map(link => {
            const recipient = link.initiated_by !== userId;
            const other = role === 'patient' ? link.clinician_name : link.patient_name;
            return <div className="rtc-link" key={link.id}><div className="rtc-link-top"><div><strong>{other}</strong>
              <small>{role === 'patient' ? link.institution : 'Patient'} · {new Date(link.created_at).toLocaleDateString()}</small></div>
              <span className={`rtc-pill rtc-${link.status}`}>{link.status}{link.is_primary ? ' · Primary' : ''}</span></div>
              {link.status === 'pending' && recipient && <div className="rtc-actions">
                {role === 'patient' && <label className="rtc-consent"><input type="checkbox" checked={consentFor.includes(link.id)} onChange={e => setConsentFor(old => e.target.checked ? [...old,link.id] : old.filter(id => id !== link.id))}/>
                  I consent to connecting with this clinician. This does not yet grant access to treatment records.</label>}
                <button type="button" className="rtc-primary" disabled={saving || (role === 'patient' && !consentFor.includes(link.id))} onClick={() => void respond(link,true)}>Accept</button>
                <button type="button" className="rtc-outline" disabled={saving} onClick={() => void respond(link,false)}>Decline</button></div>}
              {link.status === 'pending' && !recipient && <p className="rtc-help">Awaiting the other person's response.</p>}
              {link.status === 'active' && <div className="rtc-sharing-box">
                <strong>Treatment-record sharing: {sharing[link.id] ? 'Allowed' : 'Not authorised'}</strong>
                {role === 'patient' ? <>
                  <p className="rtc-help">This is separate from agreeing to connect. When allowed, this clinician may view your RTTRACK treatment plan, prescribed dose and fraction/appointment records and, if they authored the plan, record sessions. You can withdraw permission at any time. Your own published plan remains available to you.</p>
                  {!sharing[link.id] && <label className="rtc-consent"><input type="checkbox" checked={sharingConfirmed.includes(link.id)} onChange={e => setSharingConfirmed(previous => e.target.checked ? [...previous, link.id] : previous.filter(id => id !== link.id))}/>
                    I explicitly authorise {link.clinician_name} to access my RTTRACK treatment-plan and session records for this development test.</label>}
                  <button type="button" className={sharing[link.id] ? 'rtc-outline' : 'rtc-primary'} disabled={saving || (!sharing[link.id] && !sharingConfirmed.includes(link.id))}
                    onClick={() => void changeSharing(link, !sharing[link.id])}>{sharing[link.id] ? 'Withdraw treatment-record access' : 'Allow treatment-record access'}</button>
                </> : <p className="rtc-help">{sharing[link.id] ? 'The patient has separately authorised treatment-record access.' : 'The patient has not authorised treatment-record access. You cannot create or view their treatment plan yet.'}</p>}
              </div>}
              {link.status === 'active' && <div className="rtc-actions">
                {role === 'patient' && !link.is_primary && <button type="button" className="rtc-outline" disabled={saving} onClick={() => {
                  if (supabase) void execute(async (client) => client.rpc('rttrack_set_primary',{p_link_id:link.id}), 'Primary clinician updated.');
                }}>Make primary</button>}
                <button type="button" className="rtc-outline" disabled={saving} onClick={() => {
                  if (supabase && window.confirm('End this connection? The relationship will be revoked.'))
                    void execute(async (client) => client.rpc('rttrack_end_link',{p_link_id:link.id}), 'Connection revoked.');
                }}>End connection</button></div>}
              {link.status === 'pending' && !recipient && <button type="button" className="rtc-outline" disabled={saving} onClick={() => {
                if (supabase && window.confirm('Withdraw this pending request?'))
                  void execute(async (client) => client.rpc('rttrack_end_link',{p_link_id:link.id}), 'Request withdrawn.');
              }}>Withdraw request</button>}
            </div>;
          })}
        </section>
      </div>
      <p className="rtc-disclaimer"><ShieldCheck size={16}/> Treatment-record access requires separate patient authorisation. Emergency alerts are not connected.</p>
    </>}
  </section>;
}
