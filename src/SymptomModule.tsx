import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, ClipboardList, Download, RefreshCw, ShieldCheck, Stethoscope } from 'lucide-react';
import { supabase } from './supabase';
import './symptoms.css';

type SymptomType = 'fatigue' | 'nausea' | 'skin_irritation' | 'appetite_changes' | 'pain' | 'other';
type SymptomEntry = {
  entry_id: string; patient_id: string; symptom_type: SymptomType; onset_at: string;
  severity: number; observations: string | null; created_at: string;
  reviewed_at: string | null; reviewed_by: string | null;
};
type CareLink = {
  id: string; clinician_name: string; status: 'pending' | 'active' | 'declined' | 'revoked';
};
type Sharing = { link_id: string; allowed: boolean };
type VisiblePatient = { patient_id: string; full_name: string };
const symptoms: { value: SymptomType; label: string }[] = [
  { value: 'fatigue', label: 'Fatigue' }, { value: 'nausea', label: 'Nausea' },
  { value: 'skin_irritation', label: 'Skin irritation' }, { value: 'appetite_changes', label: 'Appetite changes' },
  { value: 'pain', label: 'Pain' }, { value: 'other', label: 'Other' },
];
const symptomName = (kind: SymptomType) => symptoms.find(item => item.value === kind)?.label ?? 'Other';
const formattedTime = (iso: string) => new Date(iso).toLocaleString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const localDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const localDayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function EmergencyNotice() {
  return <div className="rts-safety" role="note"><ShieldCheck size={19} aria-hidden="true" />
    <span><strong>Not monitored for emergencies.</strong> Entries do not send alerts, emails or SMS. If you need urgent help, contact your care team or local emergency services directly.</span>
  </div>;
}

function History({ entries, clinician = false, onAcknowledge, working }: {
  entries: SymptomEntry[]; clinician?: boolean; onAcknowledge?: (id: string) => void; working?: boolean;
}) {
  return <section className="rts-card rts-history" aria-labelledby="rts-history-title">
    <h2 id="rts-history-title"><ClipboardList size={20} aria-hidden="true" />{clinician ? 'Patient symptom entries' : 'Recent logs'}</h2>
    {entries.length === 0 ? <p className="rts-muted">No symptom entries available.</p> :
      <div className="rts-entry-list">{entries.map(entry => <article className="rts-entry" key={entry.entry_id}>
        <div className="rts-entry-heading"><strong>{symptomName(entry.symptom_type)}</strong><time dateTime={entry.onset_at}>{formattedTime(entry.onset_at)}</time></div>
        <span className="rts-severity">Self-rated severity: {entry.severity}/10</span>
        {entry.observations && <p className="rts-observations">{entry.observations}</p>}
        <div className="rts-entry-footer"><span>{entry.reviewed_at ? `Acknowledged ${formattedTime(entry.reviewed_at)} · not a clinical assessment` : 'Not yet acknowledged · no automatic alert sent'}</span>
          {clinician && !entry.reviewed_at && <button type="button" className="rts-outline" disabled={working} onClick={() => onAcknowledge?.(entry.entry_id)}>Mark acknowledged</button>}
        </div>
      </article>)}</div>}
    <p className="rts-footnote">Only the 100 most recent entries appear here. An acknowledgement does not indicate a diagnosis, treatment decision or emergency response.</p>
  </section>;
}

function WeeklyChart({ entries }: { entries: SymptomEntry[] }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (6 - i));
    const matching = entries.filter(item => localDayKey(new Date(item.onset_at)) === localDayKey(date));
    return {
      label: date.toLocaleDateString(undefined, { weekday: 'short' }), key: localDayKey(date),
      fatigue: Math.max(0, ...matching.filter(item => item.symptom_type === 'fatigue').map(item => item.severity)),
      skin: Math.max(0, ...matching.filter(item => item.symptom_type === 'skin_irritation').map(item => item.severity)),
    };
  }), [entries]);
  return <section className="rts-card rts-trend" aria-labelledby="rts-trend-title">
    <div className="rts-chart-head"><h2 id="rts-trend-title">Weekly severity distribution</h2>
      <div className="rts-legend"><span><i className="rts-key rts-key-fatigue"/>Fatigue</span><span><i className="rts-key rts-key-skin"/>Skin irritation</span></div></div>
    <p className="rts-muted">Highest self-reported severity for each day (1–10). No entry is shown as zero, not as symptom-free.</p>
    <div className="rts-bars" role="img" aria-label={days.map(d => `${d.label}: fatigue ${d.fatigue || 'not logged'}, skin irritation ${d.skin || 'not logged'}`).join('; ')}>
      {days.map(day => <div className="rts-day" key={day.key}>
        <div className="rts-bar-pair"><div className="rts-bar rts-fatigue" style={{ height: `${day.fatigue * 10}%` }}/>
          <div className="rts-bar rts-skin" style={{ height: `${day.skin * 10}%` }}/></div>
        <span>{day.label}</span>
      </div>)}
    </div>
  </section>;
}

export function PatientSymptoms({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<SymptomEntry[]>([]);
  const [links, setLinks] = useState<CareLink[]>([]);
  const [sharing, setSharing] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<string[]>([]);
  const [kind, setKind] = useState<SymptomType | ''>('');
  const [onset, setOnset] = useState(localDateTime);
  const [severity, setSeverity] = useState<number | null>(null);
  const [observations, setObservations] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const client = supabase;
    if (!client) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [symptomResult, linkResult, sharingResult] = await Promise.all([
        client.rpc('rttrack_list_symptoms', { p_patient_id: null }),
        client.rpc('rttrack_list_my_links'),
        client.rpc('rttrack_my_symptom_sharing'),
      ]);
      if (symptomResult.error) throw symptomResult.error;
      if (linkResult.error) throw linkResult.error;
      if (sharingResult.error) throw sharingResult.error;
      setEntries((symptomResult.data ?? []) as SymptomEntry[]);
      setLinks(((linkResult.data ?? []) as CareLink[]).filter(link => link.status === 'active'));
      setSharing(Object.fromEntries(((sharingResult.data ?? []) as Sharing[]).map(row => [row.link_id, row.allowed])));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load your symptom information.'); }
    finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = supabase;
    if (!client || saving) return;
    const parsed = new Date(onset);
    if (!kind || severity === null || !Number.isInteger(severity) || severity < 1 || severity > 10 || Number.isNaN(parsed.getTime())) {
      setError('Choose a symptom, onset and self-rated severity from 1 to 10.'); return;
    }
    if (parsed.getTime() > Date.now() + 5 * 60_000) { setError('Onset cannot be in the future.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await client.rpc('rttrack_log_symptom', {
        p_symptom_type: kind, p_onset_at: parsed.toISOString(),
        p_severity: severity, p_observations: observations.trim() || null,
      });
      if (result.error) throw result.error;
      setKind(''); setOnset(localDateTime()); setSeverity(null); setObservations('');
      await refresh(); setNotice('Symptom saved privately. No alert or message has been sent.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Symptom could not be recorded.'); }
    finally { setSaving(false); }
  }

  async function changeSharing(link: CareLink, allow: boolean) {
    const client = supabase;
    if (!client || saving || (allow && !checked.includes(link.id))) return;
    if (allow && !window.confirm(`Allow ${link.clinician_name} to read your RTTRACK symptom entries? This is separate from treatment-record access.`)) return;
    if (!allow && !window.confirm(`Stop sharing symptom entries with ${link.clinician_name}?`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await client.rpc('rttrack_set_symptom_sharing', { p_link_id: link.id, p_allow: allow });
      if (result.error) throw result.error;
      setChecked(prev => prev.filter(id => id !== link.id));
      await refresh(); setNotice(allow ? 'Symptom sharing enabled for this doctor. No email or alert was sent.' : 'Symptom sharing withdrawn for this doctor.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update symptom sharing.'); }
    finally { setSaving(false); }
  }

  function exportDisplayedLogs() {
    if (!entries.length) return;
    const csvCell = (value: string | number | null) => {
      let text = String(value ?? '');
      // Prevent spreadsheet applications from treating user-written text as a formula.
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [
      ['Symptom', 'Onset', 'Self-rated severity (1-10)', 'Observations', 'Acknowledged at'],
      ...entries.map(entry => [symptomName(entry.symptom_type), entry.onset_at,
        entry.severity, entry.observations, entry.reviewed_at]),
    ];
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const downloadUrl = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = 'rttrack-symptom-logs.csv';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setNotice('Downloaded up to 100 displayed entries. Store the file privately; it contains symptom information.');
  }

  return <div className="rts-module rts-patient">
    <div className="rts-header"><div><span className="rts-eyebrow">RTTRACK · SYMPTOM TRACKING</span><h2>Symptom tracking</h2>
      <p>Monitor your daily status and record observations for your own reference.</p></div>
      <div className="rts-header-actions"><button type="button" className="rts-outline" disabled={loading || !entries.length} onClick={exportDisplayedLogs}><Download size={17}/> Export displayed logs</button>
      <button type="button" className="rts-outline" disabled={saving} onClick={() => void refresh()}><RefreshCw size={17}/> Refresh</button></div></div>
    <EmergencyNotice/>
    {error && <p className="rts-alert rts-error" role="alert">{error}</p>}{notice && <p className="rts-alert rts-success" role="status">{notice}</p>}
    <div className="rts-patient-grid">
      <div className="rts-main-column">
        <section className="rts-card" aria-labelledby="rts-form-title"><h2 id="rts-form-title"><ClipboardList size={20}/> Log new symptom</h2>
          <p className="rts-muted">This is a self-reported development log, not a medical assessment.</p>
          <form className="rts-form" onSubmit={submit}>
            <div className="rts-two"><label>Symptom type<select required value={kind} onChange={e => setKind(e.target.value as SymptomType | '')} disabled={saving}>
              <option value="">Select symptom…</option>{symptoms.map(symptom => <option key={symptom.value} value={symptom.value}>{symptom.label}</option>)}</select></label>
              <label>Onset time<input type="datetime-local" required value={onset} max={localDateTime()} onChange={e => setOnset(e.target.value)} disabled={saving}/></label></div>
            <fieldset className="rts-scale"><legend>Severity scale (self-rated, 1–10)</legend>
              <div className="rts-severity-options">{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <label key={n} className={severity === n ? 'rts-chosen' : ''}>
                <input type="radio" name="rts-severity" value={n} checked={severity === n} onChange={() => setSeverity(n)} disabled={saving} required={severity === null}/><span>{n}</span></label>)}</div>
              <div className="rts-scale-labels"><span>1 · Lower self-rated severity</span><span>10 · Higher self-rated severity</span></div>
            </fieldset>
            <label>Clinical observations (optional)<textarea value={observations} maxLength={1000} rows={4} disabled={saving} onChange={e => setObservations(e.target.value)} placeholder="Describe when it began, its location or other observations…"/>
              <small>{observations.length}/1000 characters · Avoid entering identifying information about others.</small></label>
            <div className="rts-actions"><button type="button" className="rts-outline" disabled={saving} onClick={() => { setKind(''); setSeverity(null); setOnset(localDateTime()); setObservations(''); setError(''); }}>Clear</button>
              <button type="submit" className="rts-primary" disabled={saving}>{saving ? 'Recording…' : 'Record entry'}</button></div>
          </form>
        </section>
        {!loading && <WeeklyChart entries={entries}/>}
        <section className="rts-card rts-sharing" aria-labelledby="rts-sharing-title"><h2 id="rts-sharing-title"><ShieldCheck size={20}/> Symptom sharing permissions</h2>
          <p className="rts-muted">Your log is private by default. A care connection or treatment-record permission does not grant symptom access. You choose separately for each connected doctor.</p>
          {loading ? <p role="status">Loading permissions…</p> : links.length === 0 ? <p className="rts-muted">No active care connections yet. You can still save private symptom entries.</p> :
            links.map(link => <div className="rts-share-row" key={link.id}><div><strong>{link.clinician_name}</strong>
              <span>{sharing[link.id] ? 'Symptom sharing enabled' : 'Symptom sharing off'}</span></div>
              {sharing[link.id] ? <button type="button" className="rts-outline" disabled={saving} onClick={() => void changeSharing(link, false)}>Withdraw access</button> :
                <div className="rts-share-controls"><label><input type="checkbox" checked={checked.includes(link.id)} disabled={saving} onChange={e => setChecked(prev => e.target.checked ? [...prev, link.id] : prev.filter(id => id !== link.id))}/>
                  I explicitly authorise this doctor to view my symptom entries.</label>
                  <button type="button" className="rts-primary" disabled={saving || !checked.includes(link.id)} onClick={() => void changeSharing(link, true)}>Allow symptom access</button></div>}
            </div>)}
        </section>
      </div>
      <div className="rts-side-column"><History entries={entries}/></div>
    </div>
  </div>;
}

export function ClinicianSymptomReview({ userId }: { userId: string }) {
  const [patients, setPatients] = useState<VisiblePatient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState('');
  const [patientQuery, setPatientQuery] = useState('');
  const filteredPatients = useMemo(() => {
    const query = patientQuery.trim().toLocaleLowerCase();
    return query ? patients.filter(patient => patient.full_name.toLocaleLowerCase().includes(query)) : patients;
  }, [patients, patientQuery]);
  const [entries, setEntries] = useState<SymptomEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const client = supabase;
    if (!client) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError(''); setEntries([]);
    try {
      const patientsResult = await client.rpc('rttrack_symptom_patients');
      if (patientsResult.error) throw patientsResult.error;
      const available = (patientsResult.data ?? []) as VisiblePatient[];
      setPatients(available);
      const next = available.find(patient => patient.patient_id === selectedPatient)?.patient_id ?? available[0]?.patient_id ?? '';
      setSelectedPatient(next);
      if (next) {
        const result = await client.rpc('rttrack_list_symptoms', { p_patient_id: next });
        if (result.error) throw result.error;
        setEntries((result.data ?? []) as SymptomEntry[]);
      }
    } catch (caught) { setEntries([]); setPatients([]); setSelectedPatient(''); setError(caught instanceof Error ? caught.message : 'Could not load authorised symptom entries.'); }
    finally { setLoading(false); }
  }, [userId, selectedPatient]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function acknowledge(entryId: string) {
    const client = supabase;
    if (!client || saving || !window.confirm('Mark this entry as acknowledged? This does not send a response or constitute clinical assessment.')) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await client.rpc('rttrack_acknowledge_symptom', { p_entry_id: entryId });
      if (result.error) throw result.error;
      await refresh(); setNotice('Entry acknowledged. No notification or clinical message was sent.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not acknowledge this entry.'); }
    finally { setSaving(false); }
  }

  return <div className="rts-module rts-clinician">
    <div className="rts-header"><div><span className="rts-eyebrow">DOCTOR PORTAL · SYMPTOMS</span><h2>Symptom review</h2>
      <p>View entries shared by connected patients and record acknowledgements.</p></div>
      <button type="button" className="rts-outline" disabled={saving} onClick={() => void refresh()}><RefreshCw size={17}/> Refresh</button></div>
    <EmergencyNotice/>
    {error && <p className="rts-alert rts-error" role="alert">{error}</p>}{notice && <p className="rts-alert rts-success" role="status">{notice}</p>}
    <section className="rts-card rts-selector"><h2><Stethoscope size={20}/> Authorised patients</h2>
      <p className="rts-muted">Only patients with an active care connection AND separate symptom-sharing permission appear. Administrator status alone grants no symptom access.</p>
      {loading ? <p role="status">Loading…</p> : patients.length === 0 ? <p className="rts-muted">No patients have authorised symptom sharing yet.</p> : <>
        <label>Search authorised patients<input type="search" value={patientQuery} onChange={e=>setPatientQuery(e.target.value)} placeholder="Search patient by name…" autoComplete="off"/></label>
        <div className="rts-patient-results" role="list" aria-label="Authorised patient search results">
          {filteredPatients.length === 0 ? <p className="rts-muted">No authorised patients match that search.</p> :
            filteredPatients.map(patient => <button type="button" role="listitem" key={patient.patient_id} className={`rts-patient-result ${selectedPatient === patient.patient_id ? 'selected' : ''}`} onClick={() => { setSelectedPatient(patient.patient_id); setEntries([]); setNotice(''); }}>
              <strong>{patient.full_name}</strong><span>{selectedPatient === patient.patient_id ? 'Viewing symptoms' : 'View symptoms'}</span>
            </button>)}
        </div></>}
    </section>
    {selectedPatient && !loading && <History entries={entries} clinician onAcknowledge={id => void acknowledge(id)} working={saving}/>}
    <p className="rts-footnote"><CheckCircle2 size={16} aria-hidden="true"/> This prototype does not generate doctor alerts, determine risk levels, or replace the clinical follow-up process.</p>
  </div>;
}
