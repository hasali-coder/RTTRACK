import { addRttrackLogoToPdf } from './branding';
import { formatDateTime, formatWeekdayDate } from './date-format';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { CalendarDays, CheckCircle2, ClipboardList, Clock3, Download, RefreshCw, Search, ShieldCheck, Stethoscope } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from './supabase';
import './treatment.css';
import './treatment-lifecycle.css';

// All values below are fetched from the signed-in user's scoped Supabase RPCs.
// No example prescriptions, doses, dates, or appointments are hard-coded.
type Plan = {
  plan_id: string; patient_id: string; patient_name: string; created_by: string;
  clinician_name: string; title: string; treatment_site: string; technique: string;
  total_fractions: number; prescribed_total_gy: number; planned_start_on: string | null;
  estimated_end_on: string | null; status: 'draft' | 'active' | 'completed' | 'discontinued' | 'superseded';
  closed_at?: string | null; closure_reason?: string | null; closed_by?: string | null; superseded_by?: string | null; completed_fractions: number;
  missed_fractions: number; delivered_total_gy: number; next_session_at: string | null;
  next_session_location: string | null; next_fraction_number: number | null;
};
type Session = {
  session_id: string; fraction_number: number; scheduled_for: string; location: string | null;
  status: 'scheduled' | 'completed' | 'missed'; delivered_gy: number | null;
  completed_at: string | null;
};
type LinkedPatient = { patient_id: string; full_name: string };

const formattedTime = formatDateTime;
const formatDose = (value: number) => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })} Gy`;

function usePlans(userId: string) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const client = supabase;
    if (!client) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    const result = await client.rpc('rttrack_list_treatment_plans');
    if (result.error) setError(result.error.message);
    else setPlans((result.data ?? []) as Plan[]);
    setLoading(false);
  }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { plans, loading, error, refresh };
}

function useSessions(planId: string | null) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const client = supabase;
    if (!planId) { setSessions([]); setError(''); return; }
    if (!client) { setError('Supabase is not configured.'); return; }
    setLoading(true); setError('');
    const result = await client.rpc('rttrack_list_treatment_sessions', { p_plan_id: planId });
    if (result.error) { setError(result.error.message); setSessions([]); }
    else setSessions((result.data ?? []) as Session[]);
    setLoading(false);
  }, [planId]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { sessions, loading, error, refresh };
}

function PlanRing({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return <div className="rtt-ring" style={{ '--rtt-progress': `${percent}%` } as CSSProperties}
    aria-label={`${percent}% of prescribed fractions recorded as completed`}>
    <div className="rtt-ring-inner"><strong>{percent}%</strong><small>Completed</small></div>
  </div>;
}

// A line chart using recorded, clinician-entered delivered doses only.
// This is a VISUAL summary, not a treatment-planning or dose-verification tool.
function DoseChart({ sessions, target }: { sessions: Session[]; target: number }) {
  const delivered = sessions.filter(s => s.status === 'completed')
    .sort((a, b) => new Date(a.completed_at ?? a.scheduled_for).getTime() - new Date(b.completed_at ?? b.scheduled_for).getTime());
  const cumulative = delivered.reduce<number[]>((out, s) => {
    out.push((out[out.length - 1] ?? 0) + Number(s.delivered_gy ?? 0));
    return out;
  }, []);
  const maxDose = Math.max(target, cumulative[cumulative.length - 1] ?? 0, 1);
  const heightFor = (dose: number) => 190 - (dose / maxDose) * 145;
  const points = [{ x: 30, y: heightFor(0) }, ...cumulative.map((dose, i) => ({
    x: 30 + ((i + 1) / Math.max(delivered.length, 1)) * 620, y: heightFor(dose),
  }))];
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return <section className="rtt-card rtt-chart">
    <div className="rtt-heading"><h3>Cumulative Dose Progression</h3>
      <div className="rtt-legend"><span><i className="rtt-dot rtt-dot-blue"/> Recorded</span><span><i className="rtt-dot rtt-dot-grey"/> Prescribed total</span></div>
    </div>
    <svg viewBox="0 0 680 225" role="img" aria-label={`Recorded delivered dose ${formatDose(cumulative[cumulative.length - 1] ?? 0)} of doctor-entered prescribed total ${formatDose(target)}.`}>
      <title>Recorded cumulative delivered dose by completed fraction</title>
      {[55,100,145,190].map(y => <line key={y} x1="30" y1={y} x2="650" y2={y} stroke="#e8ebf3" strokeWidth="1"/>)}
      <line x1="30" y1={heightFor(target)} x2="650" y2={heightFor(target)} stroke="#aab1c3" strokeDasharray="5 5" strokeWidth="2"/>
      {cumulative.length > 0 && <><path d={path} fill="none" stroke="#0c5c9f" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="6" fill="#fff" stroke="#0c5c9f" strokeWidth="3"/></>}
      <text x="30" y="213" fill="#5c6474" fontSize="12">Start</text>
      <text x="650" y="213" fill="#5c6474" fontSize="12" textAnchor="end">{cumulative.length} recorded fraction{cumulative.length === 1 ? '' : 's'}</text>
    </svg>
    <p className="rtt-note">Displays only recorded delivery data. It does not verify treatment delivery or suggest a dose.</p>
  </section>;
}

export function TreatmentSummary({ userId, onViewTreatment }: { userId: string; onViewTreatment: () => void }) {
  const { plans, loading, error, refresh } = usePlans(userId);
  const plan = plans.find(p => p.status === 'active');
  return <div className="rtp-primary-grid">
    <section className="rtp-card rtp-plan">
      <div className="rtp-card-heading"><div><h2>Radiotherapy Care Plan</h2>
        <p>{plan ? `${plan.title} · ${plan.technique}` : 'No active treatment plan'}</p></div>
        <span className="rtp-tag">{plan ? 'Doctor-published plan' : 'No active plan'}</span></div>
      <div className="rtp-plan-body">
        {plan ? <PlanRing done={Number(plan.completed_fractions)} total={plan.total_fractions}/> :
          <div className="rtp-empty-ring"><ShieldCheck size={31}/><span>Not started</span></div>}
        <div className="rtp-plan-text">
          {loading ? <p role="status">Loading your treatment information…</p> : error ?
            <><p role="alert">Could not load the plan: {error}</p><button type="button" className="rtt-outline" onClick={() => void refresh()}>Retry</button></> : plan ?
            <><h3>Sessions completed: {plan.completed_fractions} / {plan.total_fractions}</h3>
              <p>Recorded delivered dose: {formatDose(Number(plan.delivered_total_gy))}<br/>Prescribed total (doctor-entered): {formatDose(Number(plan.prescribed_total_gy))}</p>
              <div className="rtt-progress" role="progressbar" aria-valuemin={0} aria-valuemax={plan.total_fractions}
                aria-valuenow={Number(plan.completed_fractions)}><span style={{ width: `${Math.min(100, (Number(plan.completed_fractions) / plan.total_fractions) * 100)}%` }}/></div>
              <button type="button" className="rtt-link" onClick={onViewTreatment}>View treatment details →</button></> :
            <><h3>Your treatment information will appear here</h3><p>Connect with an approved doctor. Only their published treatment plan will display here.</p>
              <div className="rtp-placeholder-bar" aria-hidden="true"/></>}
        </div>
      </div>
    </section>
    <section className="rtp-card rtp-next"><div className="rtp-kicker"><CalendarDays size={19}/> NEXT SESSION</div>
      <h2>{plan?.next_session_at ? formatWeekdayDate(plan.next_session_at) : 'Not scheduled'}</h2>
      <p>{plan?.next_session_at ? formattedTime(plan.next_session_at) : 'No upcoming appointment is available.'}</p>
      <div className="rtp-next-location">{plan?.next_session_at ? (plan.next_session_location || 'Location not provided by doctor') : 'Your doctor will schedule your appointment here.'}</div>
      <button type="button" disabled>Preparation guide not available yet</button>
    </section>
  </div>;
}

export function TreatmentTracker({ userId }: { userId: string }) {
  const { plans, loading, error, refresh } = usePlans(userId);
  const plan = plans.find(p => p.status === 'active');
  const { sessions, loading: sessionsLoading, error: sessionsError, refresh: refreshSessions } = useSessions(plan?.plan_id ?? null);
  const [historyPlanId, setHistoryPlanId] = useState('');
  const historyPlan = plans.find(p => p.plan_id === historyPlanId && p.status !== 'draft');
  const { sessions: historySessions, loading: historyLoading, error: historyError } = useSessions(historyPlan?.plan_id ?? null);
  const historyDialogRef = useRef<HTMLDialogElement | null>(null);
  const percent = plan ? Math.round((Number(plan.completed_fractions) / plan.total_fractions) * 100) : 0;

  useEffect(() => {
    const dialog = historyDialogRef.current;
    if (!dialog) return;
    if (historyPlan && !dialog.open) dialog.showModal();
    if (!historyPlan && dialog.open) dialog.close();
  }, [historyPlan]);

  const closeHistory = () => setHistoryPlanId('');

  return <div className="rtt-module">
    <div className="rtt-page-header"><div><span className="rtt-eyebrow">PATIENT PORTAL · TREATMENT</span><h1>Treatment Tracker</h1><p>{plan ? `${plan.title} · ${plan.treatment_site} (${plan.technique})` : 'Your prescribed care plan and appointment history'}</p></div>
      <button type="button" className="rtt-outline" onClick={() => { void refresh(); void refreshSessions(); }}><RefreshCw size={17}/> Refresh</button></div>

    {loading ? <p role="status">Loading treatment…</p> : error ? <p className="rtt-error" role="alert">{error}</p> : !plan ?
      <section className="rtt-card"><h2>No active treatment plan</h2><p>No active plan is recorded. Previously published plans, if any, remain accessible in your treatment history.</p></section> : <>
        <div className="rtt-top-grid"><DoseChart sessions={sessions} target={Number(plan.prescribed_total_gy)}/>
          <section className="rtt-card rtt-progress-card"><h3>Overall Progress</h3><PlanRing done={Number(plan.completed_fractions)} total={plan.total_fractions}/>
            <div className="rtt-stat"><CheckCircle2 size={17}/> Completed <strong>{plan.completed_fractions}</strong></div>
            <div className="rtt-stat"><Clock3 size={17}/> Not recorded completed <strong>{Math.max(0,plan.total_fractions-Number(plan.completed_fractions))}</strong></div>
            <div className="rtt-stat"><ClipboardList size={17}/> Marked missed <strong>{plan.missed_fractions}</strong></div>
          </section></div>

        <section className="rtt-card"><div className="rtt-heading"><h3>Treatment details</h3><span className="rtt-pill rtt-pill-active">Published</span></div>
          <div className="rtt-metrics"><div><small>Recorded delivered dose</small><strong>{formatDose(Number(plan.delivered_total_gy))}</strong></div>
            <div><small>Prescribed total dose</small><strong>{formatDose(Number(plan.prescribed_total_gy))}</strong></div>
            <div><small>Session completion</small><strong>{percent}%</strong></div>
            <div><small>Doctor</small><strong>{plan.clinician_name}</strong></div></div>
        </section>
      </>}

    {!loading && !error && plans.some(p => p.status !== 'draft') && <section className="rtt-card rtt-history-card">
      <div className="rtt-heading"><div><h3>Published treatment history</h3><p className="rtt-note">Open any plan to view its full fraction history without leaving this section.</p></div><span className="rtt-pill">{plans.filter(p => p.status !== 'draft').length} plan{plans.filter(p => p.status !== 'draft').length === 1 ? '' : 's'}</span></div>
      <div className="rtt-table-scroll"><table className="rtt-table"><thead><tr><th>Plan</th><th>Status</th><th>Completed</th><th>Action</th></tr></thead>
        <tbody>{plans.filter(p => p.status !== 'draft').map(p => <tr key={p.plan_id}>
          <td>{p.title}</td><td><span className={`rtt-pill rtt-pill-${p.status}`}>{p.status === 'active' ? 'Published' : p.status}</span></td>
          <td>{p.completed_fractions} / {p.total_fractions}</td>
          <td><button className="rtt-outline" type="button" onClick={() => setHistoryPlanId(p.plan_id)}>View details</button></td>
        </tr>)}</tbody></table></div>
    </section>}

    {!loading && !error && plan && <>
      <section className="rtt-card"><div className="rtt-heading"><h3>Session log</h3><span className="rtt-note">Times shown in your device's time zone</span></div>
        {sessionsError && <p className="rtt-error" role="alert">{sessionsError}</p>}
        {sessionsLoading ? <p role="status">Loading sessions…</p> : sessions.length === 0 ?
          <p>No sessions scheduled yet. Your doctor will add appointments.</p> :
          <div className="rtt-table-scroll"><table className="rtt-table"><thead><tr><th>Fraction</th><th>Scheduled time</th><th>Delivered dose</th><th>Status</th><th>Location</th></tr></thead>
            <tbody>{sessions.map(s => <tr key={s.session_id}><td>#{s.fraction_number}</td><td>{formattedTime(s.scheduled_for)}</td>
              <td>{s.delivered_gy === null ? 'Not recorded' : formatDose(Number(s.delivered_gy))}</td>
              <td><span className={`rtt-pill rtt-pill-${s.status}`}>{s.status}</span></td><td>{s.location || 'Not provided'}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="rtt-card"><h3>Upcoming appointments</h3>
        {sessions.filter(s => s.status === 'scheduled' && new Date(s.scheduled_for).getTime() >= Date.now()).length === 0 ?
          <p>No upcoming sessions recorded.</p> : <div className="rtt-appointments">{sessions.filter(s => s.status === 'scheduled' && new Date(s.scheduled_for).getTime() >= Date.now())
            .sort((a,b)=>new Date(a.scheduled_for).getTime()-new Date(b.scheduled_for).getTime()).map(s =>
              <div className="rtt-appointment" key={s.session_id}><CalendarDays size={20}/><div><strong>Fraction {s.fraction_number}</strong><small>{formattedTime(s.scheduled_for)}</small></div><span>{s.location || 'Location not provided'}</span></div>)}</div>}
      </section>
    </>}

    <dialog ref={historyDialogRef} className="rtt-history-dialog" aria-labelledby="rtt-history-dialog-title"
      onCancel={event => { event.preventDefault(); closeHistory(); }}
      onClose={closeHistory}
      onClick={event => { if (event.target === event.currentTarget) closeHistory(); }}>
      <div className="rtt-history-dialog-shell">
        <div className="rtt-history-dialog-head"><div><span className="rtt-eyebrow">TREATMENT HISTORY</span><h2 id="rtt-history-dialog-title">{historyPlan?.title ?? 'Treatment plan'}</h2></div>
          <button type="button" className="rtt-outline" onClick={closeHistory}>Close</button></div>
        {historyPlan && <>
          <div className="rtt-history-summary">
            <div><small>Status</small><strong>{historyPlan.status === 'active' ? 'Published' : historyPlan.status}</strong></div>
            <div><small>Treatment site</small><strong>{historyPlan.treatment_site}</strong></div>
            <div><small>Technique</small><strong>{historyPlan.technique}</strong></div>
            <div><small>Completed fractions</small><strong>{historyPlan.completed_fractions} / {historyPlan.total_fractions}</strong></div>
            <div><small>Recorded delivered dose</small><strong>{formatDose(Number(historyPlan.delivered_total_gy))}</strong></div>
            {historyPlan.closed_at && <div><small>Closed</small><strong>{formattedTime(historyPlan.closed_at)}</strong></div>}
          </div>
          {historyPlan.closure_reason && <p className="rtt-note"><strong>Recorded closure reason:</strong> {historyPlan.closure_reason}</p>}
          {historyError && <p className="rtt-error" role="alert">{historyError}</p>}
          {historyLoading ? <p role="status">Loading fraction history…</p> :
            historySessions.length === 0 ? <p>No fraction records are attached to this plan.</p> :
            <div className="rtt-table-scroll"><table className="rtt-table"><thead><tr><th>Fraction</th><th>Date</th><th>Status</th><th>Recorded dose</th></tr></thead><tbody>
              {historySessions.map(s => <tr key={s.session_id}><td>#{s.fraction_number}</td><td>{formattedTime(s.scheduled_for)}</td><td><span className={`rtt-pill rtt-pill-${s.status}`}>{s.status}</span></td><td>{s.delivered_gy == null ? 'Not recorded' : formatDose(Number(s.delivered_gy))}</td></tr>)}
            </tbody></table></div>}
        </>}
      </div>
    </dialog>

    <p className="rtt-note">RTTRACK displays recorded treatment information and does not prescribe treatment or verify delivered dose.</p>
  </div>;
}
// RTTRACK_CONTEXT_FOCUS_V1 — scoped plan navigation; does not alter treatment RPCs.
type TreatmentFocus = { planId?: string; patientId?: string; status?: 'draft' | 'active'; fractionNumber?: number };
export function ClinicianTreatmentManager({ userId, focus, doctorName, institution }: { userId: string; focus?: TreatmentFocus; doctorName: string; institution: string }) {
  const { plans, loading, error, refresh } = usePlans(userId);
  const [patients, setPatients] = useState<LinkedPatient[]>([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [title, setTitle] = useState('');
  const [site, setSite] = useState('');
  const [technique, setTechnique] = useState('');
  const [fractions, setFractions] = useState('');
  const [totalDose, setTotalDose] = useState('');
  const [startOn, setStartOn] = useState('');
  const [endOn, setEndOn] = useState('');
  const [fractionNumber, setFractionNumber] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [location, setLocation] = useState('');
  const [doses, setDoses] = useState<Record<string,string>>({});
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [patientError, setPatientError] = useState('');
  const [focusMessage, setFocusMessage] = useState('');
  const [closureOutcome, setClosureOutcome] = useState<'completed' | 'discontinued'>('completed');
  const [closureReason, setClosureReason] = useState('');
  const [closureConfirm, setClosureConfirm] = useState('');
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const closureDialogRef = useRef<HTMLDialogElement | null>(null);
  const fractionRecordsRef = useRef<HTMLElement | null>(null);
  const [replacementReason, setReplacementReason] = useState('');
  const [replacementConfirm, setReplacementConfirm] = useState('');
  // Only show plans for the patient explicitly selected by this clinician.
  // If access to that patient is withdrawn, hide their register immediately.
  const patientSelected = !!patientId && patients.some(p => p.patient_id === patientId);
  const patientPlans = patientSelected ? plans.filter(p => p.patient_id === patientId) : [];
  const patientOptions = useMemo(() => {
    const query = patientSearch.trim().toLocaleLowerCase();
    const filtered = query ? patients.filter(patient => patient.full_name.toLocaleLowerCase().includes(query)) : patients;
    const chosen = patients.find(patient => patient.patient_id === patientId);
    return chosen && !filtered.some(patient => patient.patient_id === chosen.patient_id) ? [chosen, ...filtered] : filtered;
  }, [patients, patientSearch, patientId]);
  const selected = patientPlans.find(p => p.plan_id === selectedPlanId) ?? null;
  const { sessions, loading: sessionsLoading, error: sessionsError, refresh: refreshSessions } = useSessions(selected?.plan_id ?? null);
  // Native dialog provides focus containment and Escape-key dismissal.
  useEffect(() => {
    const dialog = closureDialogRef.current;
    if (!dialog) return;
    if (closeModalOpen && !dialog.open) dialog.showModal();
    if (!closeModalOpen && dialog.open) dialog.close();
  }, [closeModalOpen]);
  function hidePlanDetails() {
    if (working) return;
    setCloseModalOpen(false);
    setSelectedPlanId('');
    setActionError('');
    setMessage('');
  }
  function goToFractionRecords() {
    fractionRecordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const reloadPatients = useCallback(async () => {
    const client = supabase;
    if (!client) { setPatientError('Supabase is not configured.'); return; }
    const result = await client.rpc('rttrack_treatment_patients');
    if (result.error) setPatientError(result.error.message);
    else { setPatientError(''); setPatients((result.data ?? []) as LinkedPatient[]); }
  }, [userId]);
  useEffect(() => { void reloadPatients(); }, [reloadPatients]);

  // Patient-directory navigation can carry a patient directly into Treatment.
  // The ID is accepted only if it exists in this doctor's permission-scoped list.
  useEffect(() => {
    if (!focus?.patientId || focus.planId || !!patientError) return;
    const patient = patients.find(item => item.patient_id === focus.patientId);
    if (!patient) {
      if (patients.length > 0) {
        setFocusMessage('This patient is unavailable or treatment-record sharing is no longer authorised.');
      }
      return;
    }
    setPatientId(patient.patient_id);
    setPatientSearch(patient.full_name);
    setCloseModalOpen(false);
    setSelectedPlanId('');
    setFractionNumber('');
    setScheduledFor('');
    setLocation('');
    setDoses({});
    setActionError('');
    setMessage('');
    setFocusMessage(`Opened treatment workspace for ${patient.full_name}.`);
  }, [focus, patientError, patients]);

  // A dashboard plan link is resolved ONLY against permission-scoped lists.
  useEffect(() => {
    if (!focus?.planId || loading || !!error || !!patientError) return;
    const plan = plans.find(p => p.plan_id === focus.planId);
    if (!plan || (focus.patientId && plan.patient_id !== focus.patientId) ||
        !patients.some(p => p.patient_id === plan.patient_id)) {
      setFocusMessage('This plan is unavailable or you no longer have permission to view it.');
      return;
    }
    setFocusMessage(focus.fractionNumber != null ? `Opened ${plan.title}. Find fraction ${focus.fractionNumber} in its records.` : `Opened ${plan.title}.`);
    setPatientId(plan.patient_id);
    setPatientSearch(patients.find(patient => patient.patient_id === plan.patient_id)?.full_name ?? plan.patient_name);
    setSelectedPlanId(plan.plan_id);
  }, [focus, loading, error, patientError, plans, patients]);
  const focusedPlans = focus?.status && !focus.planId
    ? plans.filter(p => p.status === focus.status && patients.some(patient => patient.patient_id === p.patient_id) &&
       (focus.status !== 'draft' || p.created_by === userId)) : [];
  const ownedPlan = selected?.created_by === userId;
  const linkedPatientIds = useMemo(() => new Set(patients.map(p=>p.patient_id)), [patients]);
  const canEdit = !!selected && ownedPlan && linkedPatientIds.has(selected.patient_id);
  // One active plan per patient remains enforced by the database. Closure is always explicit.
  const conflictingActivePlan = selected?.status === 'draft'
    ? plans.find(plan => plan.patient_id === selected.patient_id && plan.status === 'active' && plan.plan_id !== selected.plan_id)
    : undefined;

  async function doAction(run: (client: NonNullable<typeof supabase>) => Promise<{ error: {message: string} | null }>, success: string) {
    const client = supabase;
    if (!client || working) return false;
    setWorking(true); setMessage(''); setActionError('');
    try {
      const result = await run(client);
      if (result.error) throw new Error(result.error.message);
      setMessage(success);
      await Promise.all([refresh(), refreshSessions(), reloadPatients()]);
      return true;
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'Action failed.'); return false; }
    finally { setWorking(false); }
  }
  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = supabase;
    if (!client || working) return;
    if (!patientId || !title.trim() || !site.trim() || !technique.trim() ||
        !Number.isInteger(Number(fractions)) || Number(fractions) < 1 || Number(fractions) > 1000 ||
        !Number.isFinite(Number(totalDose)) || Number(totalDose) <= 0) {
      setActionError('Complete all doctor-entered plan fields with valid positive values.'); return;
    }
    setWorking(true); setActionError(''); setMessage('');
    try {
      const result = await client.rpc('rttrack_create_treatment_plan', {
        p_patient_id: patientId, p_title: title.trim(), p_site: site.trim(), p_technique: technique.trim(),
        p_total_fractions: Number(fractions), p_prescribed_total_gy: Number(totalDose),
        p_start_on: startOn || null, p_end_on: endOn || null,
      });
      if (result.error) throw new Error(result.error.message);
      setSelectedPlanId(String(result.data));
      setTitle(''); setSite(''); setTechnique(''); setFractions(''); setTotalDose(''); setStartOn(''); setEndOn('');
      setMessage('Draft plan created. It is NOT visible to the patient until you publish it.');
      await refresh();
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'Plan could not be created.'); }
    finally { setWorking(false); }
  }
  function publish() {
    if (!selected || !canEdit || selected.status !== 'draft') return;
    if (conflictingActivePlan) {
      setActionError(`This patient already has a published plan (${conflictingActivePlan.title}). RTTRACK currently permits only one published plan per patient. No plan was changed. Keep this draft until a reviewed plan-completion or supersession workflow is added.`);
      return;
    }
    if (!window.confirm('Publish this doctor-entered plan to the patient? Check all entered values first.')) return;
    void doAction(async client=>await client.rpc('rttrack_publish_treatment_plan',{p_plan_id:selected.plan_id}), 'Plan published to the patient.');
  }
  async function closePlan() {
    if (!selected || !canEdit || selected.status !== 'active' || working) return;
    if (closureReason.trim().length < 10 || closureConfirm !== 'CLOSE PLAN') {
      setActionError('Enter a reason of at least 10 characters and type CLOSE PLAN.'); return;
    }
    const succeeded = await doAction(async client => await client.rpc('rttrack_close_treatment_plan', {
      p_plan_id: selected.plan_id, p_outcome: closureOutcome,
      p_reason: closureReason.trim(), p_confirm: closureConfirm,
    }), `Plan ${closureOutcome}. Historical records preserved.`);
    if (succeeded) { setCloseModalOpen(false); setClosureReason(''); setClosureConfirm(''); }
  }
  function supersedePlan() {
    if (!selected || !canEdit || selected.status !== 'draft' || !conflictingActivePlan || working) return;
    if (conflictingActivePlan.created_by !== userId) {
      setActionError('Only the author of both plans can supersede the active plan. Coordinate with its author.'); return;
    }
    if (replacementReason.trim().length < 10 || replacementConfirm !== 'SUPERSEDE') {
      setActionError('Enter a reason of at least 10 characters and type SUPERSEDE.'); return;
    }
    if (!window.confirm(`Replace the active plan “${conflictingActivePlan.title}” with draft “${selected.title}”? The old plan remains in history.`)) return;
    void doAction(async client => await client.rpc('rttrack_supersede_treatment_plan', {
      p_old_plan_id: conflictingActivePlan.plan_id, p_new_plan_id: selected.plan_id,
      p_reason: replacementReason.trim(), p_confirm: replacementConfirm,
    }), 'Previous plan superseded and replacement published together.');
    setReplacementReason(''); setReplacementConfirm('');
  }
  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canEdit || !['draft','active'].includes(selected.status) || !fractionNumber || !scheduledFor || !Number.isInteger(Number(fractionNumber))) return;
    const parsed = new Date(scheduledFor);
    if (Number.isNaN(parsed.getTime())) { setActionError('Enter a valid appointment time.'); return; }
    await doAction(async client=>await client.rpc('rttrack_schedule_fraction',{
      p_plan_id:selected.plan_id, p_fraction_number:Number(fractionNumber),
      p_scheduled_for:parsed.toISOString(), p_location:location.trim() || null,
    }), 'Fraction appointment saved. No email has been sent.');
    setFractionNumber(''); setScheduledFor(''); setLocation('');
  }
  function complete(session: Session) {
    const value = Number(doses[session.session_id]);
    if (!Number.isFinite(value) || value <= 0 || !doses[session.session_id]?.trim()) {
      setActionError('Enter the actual delivered dose from the clinical record; RTTRACK does not suggest it.'); return;
    }
    if (!window.confirm(`Record fraction ${session.fraction_number} as completed with delivered dose ${formatDose(value)}? This prototype does not support editing this entry.`)) return;
    void doAction(async client=>await client.rpc('rttrack_complete_fraction',{
      p_session_id:session.session_id,p_delivered_gy:value,
    }), 'Completed fraction recorded.');
  }
  function markMissed(session: Session) {
    if (!window.confirm(`Mark fraction ${session.fraction_number} as missed? Only use this for fictional test records.`)) return;
    void doAction(async client=>await client.rpc('rttrack_mark_fraction_missed', {p_session_id:session.session_id}), 'Fraction marked missed.');
  }

  async function exportFractionsPdf() {
    if (!selected || sessionsLoading) return;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const locations = [...new Set(sessions.map(session => session.location?.trim()).filter((value): value is string => !!value))];
    await addRttrackLogoToPdf(doc, 40, 28, 112);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Treatment Fraction Record', 40, 67);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const header = [
      `Patient: ${selected.patient_name}`,
      `Doctor: ${doctorName}`,
      `Hospital / Institution: ${institution || 'Not recorded'}`,
      `Recorded treatment location: ${locations.length ? locations.join(', ') : 'Not recorded'}`,
      `Plan: ${selected.title}`,
      `Treatment site: ${selected.treatment_site}`,
      `Technique: ${selected.technique}`,
      `Prescribed fractions: ${selected.total_fractions}`,
      `Prescribed total dose: ${formatDose(Number(selected.prescribed_total_gy))}`,
      `Plan status: ${selected.status === 'active' ? 'Published' : selected.status}`,
    ];
    header.forEach((line, index) => doc.text(line, 40, 84 + index * 13));
    autoTable(doc, {
      startY: 224,
      head: [['Fraction', 'Scheduled', 'Status', 'Delivered dose', 'Completed at', 'Location']],
      body: sessions
        .slice()
        .sort((a, b) => a.fraction_number - b.fraction_number)
        .map(session => [
          String(session.fraction_number),
          formattedTime(session.scheduled_for),
          session.status,
          session.delivered_gy == null ? 'Not recorded' : formatDose(Number(session.delivered_gy)),
          session.completed_at ? formattedTime(session.completed_at) : 'Not recorded',
          session.location || 'Not recorded',
        ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [11, 18, 92] },
      margin: { left: 40, right: 40 },
    });
    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFontSize(8);
      doc.setTextColor(80);
      doc.text(`Printed by: ${doctorName}`, 40, 812);
      doc.text(`Generated: ${formatDateTime(new Date())}`, 40, 825);
      doc.text(`Page ${page} of ${pageCount}`, 515, 825, { align: 'right' });
    }
    const safePatient = selected.patient_name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'patient';
    const safePlan = selected.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'plan';
    doc.save(`rttrack-${safePatient}-${safePlan}-fractions.pdf`);
  }
  return <div className="rtt-module rtt-clinician">
    {focusMessage && <p className="rtt-note" role="status">{focusMessage}</p>}
    {focus?.status && !focus.planId && <section className="rtt-card" aria-label="Plans selected from dashboard">
      <h2>{focus.status === 'draft' ? 'My draft plans' : 'Active treatment plans'}</h2>
      {loading ? <p>Loading plans…</p> : error || patientError ?
        <p role="alert">The selected plans could not be loaded. Refresh to retry.</p> : focusedPlans.length === 0 ?
        <p>No accessible {focus.status} plans were found.</p> :
        <div className="rtt-table-scroll"><table className="rtt-table"><thead><tr><th scope="col">Patient</th><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
          <tbody>{focusedPlans.map(p => <tr key={p.plan_id}><td>{p.patient_name}</td><td>{p.title}</td><td>{p.status}</td>
            <td><button type="button" className="rtt-outline" onClick={() => { setPatientId(p.patient_id); setSelectedPlanId(p.plan_id); setFocusMessage(`Opened ${p.title}.`); }}>Open plan</button></td>
          </tr>)}</tbody></table></div>}
    </section>}
    <div className="rtt-page-header"><div><span className="rtt-eyebrow">DOCTOR PORTAL · TREATMENT</span><h1>Treatment management</h1>
      <p>Create and publish doctor-entered plans, schedule fractions and record actual delivery.</p></div>
      <button type="button" className="rtt-outline" onClick={() => {void refresh(); void refreshSessions(); void reloadPatients();}}><RefreshCw size={17}/> Refresh</button></div>
    
    {message && <p className="rtt-success" role="status">{message}</p>}{actionError && <p className="rtt-error" role="alert">{actionError}</p>}
    {error && <p className="rtt-error" role="alert">{error}</p>}{patientError && <p className="rtt-error" role="alert">{patientError}</p>}
    <div className="rtt-manager-grid">
      <section className="rtt-card"><h3><Stethoscope size={20}/> Create a draft plan</h3>
        <p className="rtt-note">Only patients with an active connection and authorised treatment sharing appear.</p>
        {patients.length === 0 ? <p>No patients have authorised treatment-record access. Connect with a patient and confirm they have authorised treatment sharing.</p> :
          <form className="rtt-form" onSubmit={createPlan}>
            <label>Connected patient
              <div className="rtt-search-input">
                <Search size={16}/>
                <input
                  type="search"
                  list="rtt-connected-patients"
                  value={patientSearch}
                  placeholder="Search or select a connected patient…"
                  autoComplete="off"
                  onChange={e => {
                    const value = e.target.value;
                    setPatientSearch(value);
                    const match = patients.find(patient =>
                      patient.full_name.toLocaleLowerCase() === value.trim().toLocaleLowerCase()
                    );
                    const nextPatientId = match?.patient_id ?? '';
                    if (nextPatientId !== patientId) {
                      setPatientId(nextPatientId);
                      setCloseModalOpen(false);
                      setSelectedPlanId('');
                      setFractionNumber('');
                      setScheduledFor('');
                      setLocation('');
                      setDoses({});
                      setActionError('');
                      setMessage('');
                    }
                  }}
                />
                <datalist id="rtt-connected-patients">
                  {patientOptions.map(patient =>
                    <option key={patient.patient_id} value={patient.full_name}/>
                  )}
                </datalist>
              </div>
            </label>
            {patientSearch.trim() && !patientId && patientOptions.length === 0 &&
              <p className="rtt-note">No authorised patients match that name.</p>}<label>Plan title<input required minLength={3} maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Enter the doctor's plan title"/></label>
            <div className="rtt-two"><label>Treatment site<input required minLength={2} maxLength={120} value={site} onChange={e=>setSite(e.target.value)} placeholder="From clinical record"/></label>
              <label>Technique<input required minLength={2} maxLength={120} value={technique} onChange={e=>setTechnique(e.target.value)} placeholder="From clinical record"/></label></div>
            <div className="rtt-two"><label>Prescribed fractions<input required type="number" min="1" max="1000" step="1" value={fractions} onChange={e=>setFractions(e.target.value)} placeholder="Doctor-entered"/></label>
              <label>Prescribed total dose (Gy)<input required type="number" min="0.001" step="0.001" value={totalDose} onChange={e=>setTotalDose(e.target.value)} placeholder="Doctor-entered"/></label></div>
            <div className="rtt-two"><label>Planned start (optional)<input type="date" value={startOn} onChange={e=>setStartOn(e.target.value)}/></label>
              <label>Estimated end (optional)<input type="date" min={startOn || undefined} value={endOn} onChange={e=>setEndOn(e.target.value)}/></label></div>
            <button className="rtt-primary" disabled={working} type="submit">{working?'Saving…':'Create draft'}</button>
          </form>}
      </section>
      {patientSelected && <section className="rtt-card"><h3><ClipboardList size={20}/> Treatment plan register</h3>
        <p className="rtt-note">Plans for {patients.find(p => p.patient_id === patientId)?.full_name}. Select View to inspect published, closed and draft records.</p>
        {loading ? <p role="status">Loading plans…</p> : patientPlans.length === 0 ? <p>No plans for this patient yet. Create a draft to get started.</p> :
          <><div className="rtt-plan-register-scroll"><table className="rtt-table rtt-plan-register-table"><thead><tr><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Fractions</th><th scope="col">Action</th></tr></thead>
            <tbody>{patientPlans.map(plan=><tr key={plan.plan_id} className={selected?.plan_id === plan.plan_id ? 'rtt-plan-register-selected' : undefined}>
              <td data-label="Plan"><span className="rtt-plan-title">{plan.title}</span></td>
              <td data-label="Status"><span className={`rtt-pill rtt-pill-${plan.status}`}>{plan.status === 'active' ? 'Published' : plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}</span></td>
              <td data-label="Fractions">{plan.completed_fractions} / {plan.total_fractions}</td>
              <td data-label="Action"><button type="button" className="rtt-outline rtt-plan-row-button" aria-expanded={selected?.plan_id === plan.plan_id} aria-controls={selected?.plan_id === plan.plan_id ? "rtt-selected-plan-details" : undefined} onClick={()=>{if(selected?.plan_id === plan.plan_id) hidePlanDetails(); else {setCloseModalOpen(false);setSelectedPlanId(plan.plan_id);setActionError('');setMessage('');}}}>{selected?.plan_id === plan.plan_id ? 'Hide details' : 'View details'}</button></td>
            </tr>)}</tbody></table></div>
            {!selected && <p className="rtt-note">Choose View details to open a plan and its fraction records. Choose Hide details to collapse it completely.</p>}
            {selected && <div id="rtt-selected-plan-details" className="rtt-plan-detail"><div className="rtt-plan-detail-header"><div className="rtt-plan-detail-name"><strong>{selected.title}</strong><span className={`rtt-pill rtt-pill-${selected.status}`}>{selected.status === 'active' ? 'Published' : selected.status}</span></div>
              <button className="rtt-outline rtt-plan-close-detail" type="button" disabled={working} onClick={hidePlanDetails} aria-label={`Collapse details for ${selected.title}`}>Hide details</button></div>
              <p>Patient: {selected.patient_name}<br/>Site: {selected.treatment_site} · {selected.technique}<br/>Fractions: {selected.total_fractions} · Prescribed total: {formatDose(Number(selected.prescribed_total_gy))}</p>
              <p>Recorded completed: {selected.completed_fractions} · Delivered: {formatDose(Number(selected.delivered_total_gy))}</p>
              <button className="rtt-outline rtt-jump-fractions" type="button" onClick={goToFractionRecords}>Go to fraction records ↓</button>
              {!ownedPlan && <p className="rtt-note">Read-only: this plan was entered by another connected doctor.</p>}
              {!canEdit && ownedPlan && <p className="rtt-note">Editing unavailable: an active patient connection is required.</p>}
              {selected.status !== 'draft' && <div className="rtt-lifecycle-history">
                <p><strong>Plan status:</strong> {selected.status === 'active' ? 'Published' : selected.status}</p>
                {selected.closed_at && <p><strong>Closed:</strong> {formattedTime(selected.closed_at)}</p>}
                {selected.closure_reason && <p><strong>Recorded closure reason:</strong> {selected.closure_reason}</p>}
                {selected.superseded_by && <p><strong>Replacement plan:</strong> {patientPlans.find(p => p.plan_id === selected.superseded_by)?.title ?? 'See treatment register'}</p>}
              </div>}
              {canEdit && selected.status==='draft' && <>
                {conflictingActivePlan ? <div className="rtt-lifecycle-action"><h4>Replace the currently active plan</h4>
                  <p className="rtt-note">Active plan: {conflictingActivePlan.title}. Replacing it will keep all past session records and exclude its uncompleted appointments from upcoming lists.</p>
                  {conflictingActivePlan.created_by !== userId ? <p className="rtt-error">Only the author of both plans can perform supersession. Coordinate with the active plan's author.</p> : <>
                    <label>Clinical reason for replacement (required)<textarea minLength={10} maxLength={1000} rows={3} value={replacementReason} onChange={e=>setReplacementReason(e.target.value)} placeholder="Enter a documented reason; 10–1000 characters"/></label>
                    <label>Type SUPERSEDE to confirm<input value={replacementConfirm} onChange={e=>setReplacementConfirm(e.target.value)} autoComplete="off"/></label>
                    <button className="rtt-primary" type="button" disabled={working || replacementReason.trim().length < 10 || replacementConfirm !== 'SUPERSEDE'} onClick={supersedePlan}>Supersede old plan and publish this draft</button>
                  </>}
                </div> : <button className="rtt-primary" type="button" disabled={working} onClick={publish}>Publish plan to patient</button>}
              </>}
              {canEdit && selected.status==='active' && <div className="rtt-plan-close-trigger">
                <button type="button" className="rtt-outline" disabled={working} onClick={()=>{setClosureReason('');setClosureConfirm('');setActionError('');setCloseModalOpen(true);}}>Close plan…</button>
                <p className="rtt-note">Complete or discontinue this plan. You will be asked to record a reason and confirm before anything changes.</p>
              </div>}
              {canEdit && (selected.status==='draft' || selected.status==='active') && <><hr/><h4>Schedule a fraction</h4><form className="rtt-form" onSubmit={schedule}>
                <div className="rtt-two"><label>Fraction number<input type="number" required step="1" min="1" max={selected.total_fractions} value={fractionNumber} onChange={e=>setFractionNumber(e.target.value)}/></label>
                  <label>Appointment date &amp; time<input required type="datetime-local" value={scheduledFor} onChange={e=>setScheduledFor(e.target.value)}/></label></div>
                <label>Location (optional)<input maxLength={160} value={location} onChange={e=>setLocation(e.target.value)} placeholder="From appointment record"/></label>
                <button type="submit" disabled={working} className="rtt-outline">Save appointment</button>
                <p className="rtt-note">Time is entered in your device's local time zone. Appointments do not send email yet.</p>
              </form></>}
            </div>}</>}
      </section>}
    </div>
    <dialog ref={closureDialogRef} className="rtt-closure-dialog" aria-labelledby="rtt-closure-title" aria-describedby="rtt-closure-description" onClose={()=>setCloseModalOpen(false)} onCancel={event=>{if(working) event.preventDefault(); else setCloseModalOpen(false);}}>
      <div className="rtt-closure-modal-content">
        <div className="rtt-closure-modal-heading"><h2 id="rtt-closure-title">Close treatment plan</h2><button type="button" className="rtt-outline rtt-closure-dismiss" aria-label="Close dialog without changing plan" disabled={working} onClick={()=>setCloseModalOpen(false)}>✕</button></div>
        <p id="rtt-closure-description" className="rtt-note">{selected ? `Plan: ${selected.title}. Closing preserves recorded sessions and removes future appointments from upcoming lists. Completion is a doctor-recorded decision.` : 'Select an active plan before closing.'}</p>
        <div className="rtt-lifecycle-action">
          <label>Closure outcome<select value={closureOutcome} disabled={working} onChange={e=>setClosureOutcome(e.target.value as 'completed' | 'discontinued')}><option value="completed">Completed</option><option value="discontinued">Discontinued</option></select></label>
          <label>Clinical reason (required)<textarea minLength={10} maxLength={1000} rows={3} value={closureReason} disabled={working} onChange={e=>setClosureReason(e.target.value)} placeholder="Enter a documented reason (10–1000 characters)"/></label>
          <label>Type CLOSE PLAN to confirm<input value={closureConfirm} disabled={working} onChange={e=>setClosureConfirm(e.target.value)} autoComplete="off" placeholder="CLOSE PLAN"/></label>
        </div>
        <div className="rtt-closure-modal-actions"><button type="button" className="rtt-outline" disabled={working} onClick={()=>setCloseModalOpen(false)}>Cancel</button>
          <button type="button" className="rtt-primary" disabled={working || !selected || !canEdit || selected.status !== 'active' || closureReason.trim().length < 10 || closureConfirm !== 'CLOSE PLAN'} onClick={()=>void closePlan()}>{working ? 'Closing…' : `Confirm ${closureOutcome}`}</button></div>
        {actionError && <p className="rtt-error" role="alert">{actionError}</p>}
      </div>
    </dialog>
    {selected && <section className="rtt-card rtt-fraction-records" ref={fractionRecordsRef} id="rtt-fraction-records"><div className="rtt-heading rtt-fraction-heading"><div><h3>Fraction records — {selected.patient_name}</h3><span className="rtt-note">Plan: {selected.title} · Only the author with an active connection can record delivery</span></div><button type="button" className="rtt-outline" disabled={sessionsLoading || sessions.length === 0} onClick={exportFractionsPdf}><Download size={16}/> Export fractions PDF</button></div>
      {sessionsError && <p className="rtt-error" role="alert">{sessionsError}</p>}
      {sessionsLoading ? <p role="status">Loading fraction records…</p> : sessions.length === 0 ? <p>No fractions scheduled for this plan.</p> :
        <div className="rtt-table-scroll rtt-fractions-scroll" role="region" aria-label="Fraction records table" tabIndex={0}><table className="rtt-table rtt-fractions-table"><thead><tr><th>Fraction</th><th>Scheduled</th><th>Status</th><th>Recorded dose</th><th>Completed</th><th>Actions</th></tr></thead><tbody>
          {sessions.map(s=> <tr key={s.session_id}><td data-label="Fraction">#{s.fraction_number}</td><td data-label="Scheduled">{formattedTime(s.scheduled_for)}</td><td data-label="Status"><span className={`rtt-pill rtt-pill-${s.status}`}>{s.status}</span></td>
            <td data-label="Recorded dose">{s.delivered_gy===null?'Not recorded':formatDose(Number(s.delivered_gy))}</td><td data-label="Completed">{s.completed_at ? formattedTime(s.completed_at) : 'Not recorded'}</td><td data-label="Actions">{canEdit && selected.status==='active' && s.status==='scheduled' && new Date(s.scheduled_for).getTime() <= Date.now() ?
              <div className="rtt-row-actions"><label>Delivered dose (Gy)<input aria-label={`Delivered dose for fraction ${s.fraction_number} in Gy`} type="number" min="0.001" step="0.001" placeholder="Actual recorded" value={doses[s.session_id]??''} onChange={e=>setDoses(old=>({...old,[s.session_id]:e.target.value}))}/></label>
                <button className="rtt-primary" disabled={working} onClick={()=>complete(s)} type="button">Record completed</button>
                <button className="rtt-outline" disabled={working} onClick={()=>markMissed(s)} type="button">Mark missed</button></div>:
              <span className="rtt-note">{s.status === 'scheduled' ? 'Scheduled / read-only' : 'Recorded'}</span>}</td></tr>)}
        </tbody></table></div>}
    </section>}
    
  </div>;
}
