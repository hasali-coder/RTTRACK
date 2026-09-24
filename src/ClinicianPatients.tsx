import { formatDate as displayDate, formatDateTime as displayDateTime } from './date-format';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpenCheck, CalendarDays, HeartPulse, RefreshCw, Search, Users } from 'lucide-react';
import { supabase } from './supabase';
import './clinician-patients.css';

type Destination = 'Connections' | 'Treatment' | 'Symptoms';
type Connection = {
  id: string;
  patient_id: string;
  clinician_id: string;
  patient_name: string;
  status: string;
  patient_consented_at: string | null;
  created_at: string;
  is_primary: boolean;
};
type AllowedPatient = { patient_id: string; full_name: string };
type Plan = {
  plan_id: string;
  patient_id: string;
  title: string;
  status: string;
  total_fractions: number;
  completed_fractions: number;
  next_session_at: string | null;
};
type Filter = 'all' | 'treatment' | 'symptoms';
type PatientNavigationContext = { patientId?: string };
type Props = { userId: string; onNavigate: (destination: Destination, context?: PatientNavigationContext) => void };
type LoadState = {
  connections: Connection[];
  treatmentIds: string[];
  symptomIds: string[];
  plans: Plan[];
  errors: { connections: string; treatment: string; symptoms: string; plans: string };
};

const empty: LoadState = {
  connections: [], treatmentIds: [], symptomIds: [], plans: [],
  errors: { connections: '', treatment: '', symptoms: '', plans: '' },
};

function formatDate(value: string | null) { return value ? displayDate(value) : 'Not recorded'; }
function formatAppointment(value: string | null) { return value ? displayDateTime(value) : 'No upcoming session listed'; }
function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The service could not be reached. Please retry.';
}

/** Read-only directory of patients who have an active, consented link to this clinician.
 * Separate permission-checked RPCs govern treatment and symptom access.
 * No direct patient-profile, authentication-user or clinical-table reads are made here.
 */
export default function ClinicianPatients({ userId, onNavigate }: Props) {
  const [data, setData] = useState<LoadState>(empty);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setData(empty);
    setSelectedId(null);
    async function load() {
      if (!supabase) {
        if (current) {
          setData({ ...empty, errors: { ...empty.errors, connections: 'Supabase is not configured.' } });
          setLoading(false);
        }
        return;
      }
      const client = supabase;
      // Each RPC checks auth.uid() and currently granted permissions on the server.
      // Each load is handled independently so a symptom-service error never implies consent was denied.
      const responses = await Promise.allSettled([
        client.rpc('rttrack_list_my_links'),
        client.rpc('rttrack_treatment_patients'),
        client.rpc('rttrack_symptom_patients'),
        client.rpc('rttrack_list_treatment_plans'),
      ]);
      if (!current) return;
      const next: LoadState = {
        connections: [], treatmentIds: [], symptomIds: [], plans: [],
        errors: { connections: '', treatment: '', symptoms: '', plans: '' },
      };
      const keys = ['connections', 'treatment', 'symptoms', 'plans'] as const;
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        const key = keys[i];
        if (response.status === 'rejected') {
          next.errors[key] = errorText(response.reason);
        } else if (response.value.error) {
          next.errors[key] = response.value.error.message;
        } else if (key === 'connections') {
          next.connections = (response.value.data ?? []) as Connection[];
        } else if (key === 'treatment') {
          next.treatmentIds = ((response.value.data ?? []) as AllowedPatient[]).map(patient => patient.patient_id);
        } else if (key === 'symptoms') {
          next.symptomIds = ((response.value.data ?? []) as AllowedPatient[]).map(patient => patient.patient_id);
        } else {
          next.plans = (response.value.data ?? []) as Plan[];
        }
      }
      setData(next);
      setLoading(false);
    }
    void load();
    return () => { current = false; };
  }, [userId, refresh]);

  const patients = useMemo(() => {
    const seen = new Set<string>();
    return data.connections.filter(link => {
      // Pending, revoked and declined links must NEVER populate the patient directory.
      if (link.clinician_id !== userId || link.status !== 'active' || !link.patient_consented_at) return false;
      if (seen.has(link.patient_id)) return false;
      seen.add(link.patient_id);
      return true;
    }).sort((a, b) => a.patient_name.localeCompare(b.patient_name));
  }, [data.connections, userId]);
  const treatmentSet = useMemo(() => new Set(data.treatmentIds), [data.treatmentIds]);
  const symptomSet = useMemo(() => new Set(data.symptomIds), [data.symptomIds]);
  const visible = useMemo(() => patients.filter(patient => {
    if (!patient.patient_name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (filter === 'treatment') return !data.errors.treatment && treatmentSet.has(patient.patient_id);
    if (filter === 'symptoms') return !data.errors.symptoms && symptomSet.has(patient.patient_id);
    return true;
  }), [patients, search, filter, data.errors.treatment, data.errors.symptoms, treatmentSet, symptomSet]);
  const selected = patients.find(patient => patient.patient_id === selectedId) ?? null;
  const selectedPlans = selected && !data.errors.plans && !data.errors.treatment && treatmentSet.has(selected.patient_id)
    ? data.plans.filter(plan => plan.patient_id === selected.patient_id) : [];
  const countLimit = [data.connections.length, data.treatmentIds.length, data.symptomIds.length, data.plans.length].some(count => count >= 100);

  return <section className="rtcp-root" aria-label="Doctor patients">
    <header className="rtcp-heading">
      <div><span className="rtcp-eyebrow">DOCTOR PORTAL · PATIENTS</span><h1>My patients</h1>
        <p>Find patients who have an active, consented connection with you. Treatment and symptom access require separate patient permissions.</p></div>
      <button type="button" className="rtcp-outline" disabled={loading} onClick={() => setRefresh(value => value + 1)}>
        <RefreshCw size={17} aria-hidden="true" /> {loading ? 'Loading…' : 'Refresh patients'}
      </button>
    </header>

    {data.errors.connections && <div className="rtcp-error" role="alert">Patient connections could not be loaded: {data.errors.connections}. <button type="button" className="rtcp-link" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    {(data.errors.treatment || data.errors.symptoms || data.errors.plans) && !data.errors.connections && <div className="rtcp-notice" role="status">
      Some permissions or records could not be checked. The affected sections below show “Unavailable,” not “Not shared.” Refresh to retry.
    </div>}

    <div className="rtcp-toolbar">
      <div><strong>{loading ? 'Loading patients…' : `${patients.length} connected patient${patients.length === 1 ? '' : 's'}`}</strong>
        <span>Only your currently active connections appear here.</span></div>
      <button type="button" className="rtcp-primary" onClick={() => onNavigate('Connections')}><Users size={17} aria-hidden="true"/> Manage connections <ArrowRight size={16} aria-hidden="true"/></button>
    </div>
    <div className="rtcp-grid">
      <section className="rtcp-panel" aria-labelledby="rtcp-list-title">
        <div className="rtcp-panel-head"><h2 id="rtcp-list-title">Patient list</h2><span>{loading ? '…' : `${visible.length} shown`}</span></div>
        <div className="rtcp-controls">
          <label className="rtcp-search"><span>Search by patient name</span><div><Search size={17} aria-hidden="true"/><input value={search} onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)} placeholder="Search connected patients" type="search" maxLength={120}/></div></label>
          <label><span>Show patients</span><select value={filter} onChange={(event: ChangeEvent<HTMLSelectElement>) => setFilter(event.target.value as Filter)}>
            <option value="all">All connected</option><option value="treatment" disabled={!!data.errors.treatment}>Treatment access granted</option><option value="symptoms" disabled={!!data.errors.symptoms}>Symptom access granted</option>
          </select></label>
        </div>
        {loading ? <p className="rtcp-empty" role="status">Loading your connected patients…</p> : data.errors.connections ?
          <p className="rtcp-empty">Patient list unavailable. Use Refresh patients after the connection service is working.</p> : patients.length === 0 ?
          <div className="rtcp-empty"><p>No active, consented patient connections yet.</p><button type="button" className="rtcp-outline" onClick={() => onNavigate('Connections')}>Open Connections <ArrowRight size={15} aria-hidden="true"/></button></div> : visible.length === 0 ?
          <p className="rtcp-empty">No connected patients match these filters. Try another name or choose All connected.</p> :
          <div className="rtcp-list" role="list">{visible.map(patient => <div className={`rtcp-person ${selectedId === patient.patient_id ? 'rtcp-person-selected' : ''}`} role="listitem" key={patient.patient_id}>
            <div className="rtcp-person-main"><span className="rtcp-avatar" aria-hidden="true"><Users size={18}/></span>
              <div><strong>{patient.patient_name}</strong><small>Connected {formatDate(patient.created_at)}{patient.is_primary ? ' · Primary doctor' : ''}</small></div></div>
            <div className="rtcp-person-actions"><span className="rtcp-dot rtcp-active">Connected</span>
              <button type="button" className="rtcp-outline" aria-pressed={selectedId === patient.patient_id} onClick={() => setSelectedId(selectedId === patient.patient_id ? null : patient.patient_id)}>
                {selectedId === patient.patient_id ? 'Close details' : 'View patient'} <ArrowRight size={15} aria-hidden="true"/></button></div>
          </div>)}</div>}
      </section>

      <section className="rtcp-panel rtcp-details" aria-labelledby="rtcp-details-title">
        {!selected ? <div className="rtcp-details-empty"><BookOpenCheck size={32} aria-hidden="true"/><h2 id="rtcp-details-title">Select a patient</h2><p>Choose View patient from the list to see their connection details and only the records they have authorised you to access.</p></div> : <>
          <div className="rtcp-panel-head rtcp-details-head"><div><span className="rtcp-eyebrow">PATIENT OVERVIEW</span><h2 id="rtcp-details-title">{selected.patient_name}</h2></div>
            <button type="button" className="rtcp-outline" onClick={() => setSelectedId(null)}><ArrowLeft size={16} aria-hidden="true"/> Close details</button></div>
          <dl className="rtcp-facts"><div><dt>Care connection</dt><dd>Active · Patient consent recorded</dd></div><div><dt>Connection created</dt><dd>{formatDate(selected.created_at)}</dd></div><div><dt>Primary doctor</dt><dd>{selected.is_primary ? 'You are marked as primary' : 'You are not marked as primary'}</dd></div></dl>
          <h3>Record access</h3>
          <div className="rtcp-access">
            <article><div><CalendarDays size={19} aria-hidden="true"/><strong>Treatment</strong></div>
              <span className={`rtcp-dot ${!data.errors.treatment && treatmentSet.has(selected.patient_id) ? 'rtcp-allowed' : ''}`}>
                {data.errors.treatment ? 'Unavailable' : treatmentSet.has(selected.patient_id) ? 'Sharing allowed' : 'Not shared'}</span>
              <p>{data.errors.treatment ? 'The treatment permission service could not be checked.' : treatmentSet.has(selected.patient_id) ? 'Open Treatment to view this patient’s currently shared plans.' : 'The patient must separately authorise treatment-record sharing in Connections.'}</p>
              <button type="button" className="rtcp-outline" disabled={!!data.errors.treatment || !treatmentSet.has(selected.patient_id)} onClick={() => onNavigate('Treatment', { patientId: selected.patient_id })}>Open Treatment <ArrowRight size={15} aria-hidden="true"/></button></article>
            <article><div><HeartPulse size={19} aria-hidden="true"/><strong>Symptoms</strong></div>
              <span className={`rtcp-dot ${!data.errors.symptoms && symptomSet.has(selected.patient_id) ? 'rtcp-allowed' : ''}`}>
                {data.errors.symptoms ? 'Unavailable' : symptomSet.has(selected.patient_id) ? 'Sharing allowed' : 'Not shared'}</span>
              <p>{data.errors.symptoms ? 'The symptom permission service could not be checked.' : symptomSet.has(selected.patient_id) ? 'Open Symptoms and select this patient to review their shared entries.' : 'The patient must separately authorise symptom sharing in Connections.'}</p>
              <button type="button" className="rtcp-outline" disabled={!!data.errors.symptoms || !symptomSet.has(selected.patient_id)} onClick={() => onNavigate('Symptoms')}>Open Symptoms <ArrowRight size={15} aria-hidden="true"/></button></article>
          </div>
          <div className="rtcp-plans"><h3>Shared treatment plans</h3>
            {data.errors.treatment || data.errors.plans ? <p className="rtcp-empty">Plan records are unavailable right now. Refresh to retry.</p> : !treatmentSet.has(selected.patient_id) ?
              <p className="rtcp-empty">Treatment records have not been shared with you.</p> : selectedPlans.length === 0 ?
              <p className="rtcp-empty">No accessible plans are currently listed for this patient.</p> : <div className="rtcp-plan-list">{selectedPlans.map(plan => <article key={plan.plan_id} className="rtcp-plan">
                <div><strong>{plan.title}</strong><span className="rtcp-status">{plan.status === 'active' ? 'Published · Active' : plan.status}</span></div>
                <p>Fractions recorded completed: {plan.completed_fractions ?? 0} / {plan.total_fractions ?? '—'}</p>
                {plan.status === 'active' && plan.next_session_at && <p>Next recorded appointment: {formatAppointment(plan.next_session_at)}</p>}
              </article>)}</div>}
            {!data.errors.plans && data.plans.length >= 100 && <p className="rtcp-caution">The treatment service returned its maximum of 100 plans. This list may be incomplete.</p>}
          </div>
          <p className="rtcp-guidance">For treatment actions and fraction history, Open Treatment carries this patient into the Treatment workspace automatically. This summary cannot edit prescriptions or record delivered doses.</p>
        </>}
      </section>
    </div>
    {countLimit && <p className="rtcp-caution">One of the existing services returned 100 records, its maximum. Counts and lists may be incomplete; no complete patient census is claimed.</p>}
  </section>;
}
