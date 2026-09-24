import { formatDate } from './date-format';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronRight, Link2, RefreshCw, UserPlus, X } from 'lucide-react';
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
type Props = { role: Role; userId: string; initialFilter?: 'pending' | 'active' };

export default function ConnectionsPanel({ role, userId, initialFilter }: Props) {
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
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'active'>(initialFilter ?? 'all');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const patientDialogRef = useRef<HTMLDialogElement | null>(null);

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
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load connections.'); }
    finally { setLoading(false); }
  }, [role]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setStatusFilter(initialFilter ?? 'all'); setSelectedLinkId(null); }, [initialFilter]);

  const openPairIds = new Set(connections.filter(l => l.status === 'pending' || l.status === 'active').map(l => l.clinician_id));
  const visible = directory.filter(item => `${item.full_name} ${item.institution}`.toLowerCase().includes(search.toLowerCase()));
  const selected = connections.find(link => link.id === selectedLinkId) ?? null;
  const otherName = (link: Connection) => role === 'patient' ? link.clinician_name : link.patient_name;

  useEffect(() => {
    if (role !== 'patient') return;
    const dialog = patientDialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) dialog.close();
  }, [role, selected]);

  async function execute(action: (client: NonNullable<typeof supabase>) => Promise<{ error: { message: string } | null }>, success: string) {
    const client = supabase;
    if (!client || saving) return;
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
    await execute(async client => client.rpc('rttrack_clinician_request_patient', { p_patient_email: requested }),
      'If the account is eligible, a connection request was recorded. Ask the patient to sign in and review it.');
    setPatientEmail('');
  }

  async function requestClinician(id: string) {
    if (!supabase || !consent) return;
    await execute(async client => client.rpc('rttrack_patient_request_clinician', { p_clinician_id: id, p_consent: true }),
      'Connection and treatment-record sharing requested. Awaiting doctor acceptance.');
    setConsent(false);
  }

  async function respond(link: Connection, accept: boolean) {
    if (!supabase) return;
    const patientConsent = role === 'patient' && consentFor.includes(link.id);
    if (accept && role === 'patient' && !patientConsent) { setError('Please confirm the connection and treatment-record consent.'); return; }
    await execute(async client => client.rpc('rttrack_respond_link', {
      p_link_id: link.id, p_accept: accept, p_patient_consent: patientConsent,
    }), accept ? 'Connection accepted; treatment sharing follows your authorisation.' : 'Request declined.');
    setConsentFor(old => old.filter(id => id !== link.id));
  }

  async function changeSharing(link: Connection, allow: boolean) {
    if (role !== 'patient' || link.status !== 'active' || !supabase) return;
    if (allow && !sharingConfirmed.includes(link.id)) { setError('Confirm treatment-record access before granting it.'); return; }
    if (!allow && !window.confirm('Withdraw this doctor’s access to treatment records? Your own published plan remains available to you.')) return;
    await execute(async client => client.rpc('rttrack_set_treatment_sharing', { p_link_id: link.id, p_allow: allow }),
      allow ? 'Treatment-record sharing authorised for this doctor.' : 'Treatment-record sharing withdrawn.');
    setSharingConfirmed(previous => previous.filter(id => id !== link.id));
  }

  const filteredConnections = connections.filter(link =>
    statusFilter === 'all' ||
    (statusFilter === 'active' ? link.status === 'active' : link.status === 'pending' && link.initiated_by !== userId)
  );

  const selectedDetails = selected ? <section className="rtc-selected-details" aria-label={`Connection details for ${otherName(selected)}`}>
    <div className="rtc-detail-header"><div><span className={`rtc-pill rtc-${selected.status}`}>{selected.status}{selected.is_primary ? ' · Primary' : ''}</span><h4>{otherName(selected)}</h4><small>{role === 'patient' ? selected.institution : 'Patient'} · {new Date(selected.created_at).toLocaleDateString()}</small></div>{role !== 'patient' && <button type="button" className="rtc-outline" onClick={() => setSelectedLinkId(null)}>Close</button>}</div>
    <div className="rtc-detail-summary"><div><span>Connection status</span><strong>{selected.status}</strong></div><div><span>Treatment access</span><strong>{selected.status === 'active' ? (sharing[selected.id] ? 'Shared' : 'Not shared') : '—'}</strong></div>{role === 'patient' && <div><span>Primary doctor</span><strong>{selected.is_primary ? 'Yes' : 'No'}</strong></div>}</div>

    {selected.status === 'pending' && selected.initiated_by !== userId && <div className="rtc-actions">
      {role === 'patient' && <div className="rtc-consent-area"><p className="rtc-consent-explain">Accepting connects you with {selected.clinician_name} and authorises access to your RTTRACK treatment plans, prescribed doses and session records. Symptom sharing remains separate.</p><label className="rtc-consent"><input type="checkbox" checked={consentFor.includes(selected.id)} onChange={e => setConsentFor(old => e.target.checked ? [...old, selected.id] : old.filter(id => id !== selected.id))}/> I agree to connect and share my treatment records.</label></div>}
      <button type="button" className="rtc-primary" disabled={saving || (role === 'patient' && !consentFor.includes(selected.id))} onClick={() => void respond(selected, true)}>{role === 'patient' ? 'Accept & share records' : 'Accept request'}</button><button type="button" className="rtc-outline" disabled={saving} onClick={() => void respond(selected, false)}>Decline</button>
    </div>}

    {selected.status === 'pending' && selected.initiated_by === userId && <div className="rtc-actions"><span className="rtc-help">Awaiting a response.</span><button type="button" className="rtc-outline" disabled={saving} onClick={() => { if (supabase && window.confirm('Withdraw this pending request?')) void execute(async client => client.rpc('rttrack_end_link', { p_link_id: selected.id }), 'Request withdrawn.'); }}>Withdraw request</button></div>}

    {selected.status === 'active' && <div className="rtc-actions">
      {role === 'patient' && <div className="rtc-consent-area"><strong>Treatment-record access: {sharing[selected.id] ? 'Allowed' : 'Not shared'}</strong>{!sharing[selected.id] && <><p className="rtc-consent-explain">Allow this doctor to view your treatment plans, prescribed doses and session records and, if they authored a plan, record sessions.</p><label className="rtc-consent"><input type="checkbox" checked={sharingConfirmed.includes(selected.id)} onChange={e => setSharingConfirmed(old => e.target.checked ? [...old, selected.id] : old.filter(id => id !== selected.id))}/> I authorise treatment-record access for {selected.clinician_name}.</label></>}
        <button type="button" className={sharing[selected.id] ? 'rtc-outline' : 'rtc-primary'} disabled={saving || (!sharing[selected.id] && !sharingConfirmed.includes(selected.id))} onClick={() => void changeSharing(selected, !sharing[selected.id])}>{sharing[selected.id] ? 'Withdraw treatment access' : 'Allow treatment access'}</button></div>}
      {role === 'patient' && !selected.is_primary && <button type="button" className="rtc-outline" disabled={saving} onClick={() => { if (supabase) void execute(async client => client.rpc('rttrack_set_primary', { p_link_id: selected.id }), 'Primary doctor updated.'); }}>Make primary doctor</button>}
      <button type="button" className="rtc-outline rtc-danger-outline" disabled={saving} onClick={() => { if (supabase && window.confirm('End this connection? The relationship will be revoked.')) void execute(async client => client.rpc('rttrack_end_link', { p_link_id: selected.id }), 'Connection revoked.'); }}>End connection</button>
    </div>}
  </section> : null;

  return <section className="rtc-panel" aria-label="Care connections">
    <div className="rtc-heading"><div><span className="rtc-eyebrow">RTTRACK · CARE CONNECTIONS</span><h2>{role === 'patient' ? 'My care team' : 'Patient connections'}</h2></div><button type="button" className="rtc-outline" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw size={16}/> Refresh</button></div>
    {error && <p className="rtc-error" role="alert">{error}</p>}{message && <p className="rtc-success" role="status">{message}</p>}
    {loading ? <p role="status">Loading connections…</p> : <div className="rtc-grid">
      {role === 'patient' ? <section className="rtc-card rtc-find-card" aria-labelledby="rtc-discovery-title">
        <h3 id="rtc-discovery-title"><UserPlus size={19}/> Find a doctor</h3>
        <label className="rtc-label">Search by name or institution<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search doctors" /></label>
        <div className="rtc-directory" role="region" aria-label="Available doctors" tabIndex={0}>
          {visible.length === 0 ? <p>No doctors currently available in the directory.</p> : visible.map(item => <div className="rtc-person" key={item.clinician_id}><div><strong>{item.full_name}</strong><small>{item.institution}</small></div><button type="button" className="rtc-primary" disabled={!consent || saving || openPairIds.has(item.clinician_id)} onClick={() => void requestClinician(item.clinician_id)}>{openPairIds.has(item.clinician_id) ? 'Already requested' : 'Request'}</button></div>)}
        </div>
        <div className="rtc-consent-area"><p className="rtc-consent-explain">Connecting also authorises the doctor to access your treatment records after they accept. You can withdraw treatment access or end the connection later. Symptom sharing is separate.</p><label className="rtc-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/> I agree to connect and share my treatment records with the doctor I select.</label></div>
      </section> : <section className="rtc-card" aria-labelledby="rtc-request-title">
        <h3 id="rtc-request-title"><UserPlus size={19}/> Find & request</h3>
        <label className="rtc-consent rtc-directory-toggle"><input type="checkbox" checked={discoverable} disabled={saving} onChange={e => { if (!supabase) return; void execute(async client => client.rpc('rttrack_set_discoverable', { p_discoverable: e.target.checked }), 'Directory preference saved.'); }}/> Show me in the patient directory</label>
        <form onSubmit={e => void requestPatient(e)} className="rtc-form"><label className="rtc-label">Patient email<input type="email" required value={patientEmail} onChange={e => setPatientEmail(e.target.value)} placeholder="patient@example.com" maxLength={254}/></label><button type="submit" className="rtc-primary" disabled={saving || !patientEmail.trim()}>Send request</button></form>
        <details className="rtc-disclosure"><summary>How requests work</summary><p>Requests do not reveal whether an email belongs to a patient. The patient must accept and consent to treatment-record sharing before access begins.</p></details>
      </section>}

      <section className="rtc-card rtc-connections-card" aria-labelledby="rtc-connections-title"><div className="rtc-list-heading"><h3 id="rtc-connections-title"><Link2 size={19}/> My connections</h3><label className="rtc-status-filter">Show <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as typeof statusFilter); setSelectedLinkId(null); }}><option value="all">All</option><option value="pending">To respond to</option><option value="active">Active</option></select></label></div><p className="rtc-list-copy">{role === 'patient' ? 'Select a doctor to open connection details.' : 'Select a patient to manage the connection.'}</p>
        <div className="rtc-connection-list" role="region" aria-label="Connection list" tabIndex={0}>{connections.length === 0 ? <p className="rtc-empty">No connection requests yet.</p> : filteredConnections.length === 0 ? <p className="rtc-empty">No connections match this filter.</p> : filteredConnections.map(link => <button key={link.id} type="button" className={`rtc-connection-row ${selectedLinkId === link.id ? 'rtc-selected' : ''}`} aria-pressed={selectedLinkId === link.id} onClick={() => { setSelectedLinkId(link.id); setConsentFor([]); setSharingConfirmed([]); }}><span><strong>{otherName(link)}</strong><small>{role === 'patient' ? link.institution : 'Patient'} · {formatDate(link.created_at)}</small></span><span className="rtc-row-meta"><span className={`rtc-pill rtc-${link.status}`}>{link.status}{link.is_primary ? ' · Primary' : ''}</span>{link.status === 'active' && <small>Treatment: {sharing[link.id] ? 'Shared' : 'Not shared'}</small>}</span><ChevronRight className="rtc-row-chevron" size={17}/></button>)}</div>
        {role !== 'patient' && (selectedDetails ?? <p className="rtc-select-hint">Select a connection to manage it.</p>)}
      </section>
    </div>}

    {role === 'patient' && <dialog ref={patientDialogRef} className="rtc-dialog" aria-labelledby="rtc-dialog-title"
      onCancel={event => { event.preventDefault(); setSelectedLinkId(null); }}
      onClose={() => { if (selectedLinkId) setSelectedLinkId(null); }}
      onClick={event => { if (event.target === event.currentTarget) setSelectedLinkId(null); }}>
      <div className="rtc-dialog-shell"><div className="rtc-dialog-top"><div><span className="rtc-eyebrow">CONNECTION DETAILS</span><h3 id="rtc-dialog-title">{selected ? selected.clinician_name : 'Doctor connection'}</h3></div><button type="button" className="rtc-dialog-close" aria-label="Close connection details" onClick={() => setSelectedLinkId(null)}><X size={19}/></button></div>{selectedDetails}</div>
    </dialog>}
  </section>;
}
