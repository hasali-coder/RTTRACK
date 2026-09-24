import { formatDate } from './date-format';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, CheckCircle2, Clock3, HeartPulse, RefreshCw, Users } from 'lucide-react';
import { supabase } from './supabase';
import './doctor-insights.css';

type FilterRow = {
  patient_id: string;
  patient_name: string;
  plan_id: string | null;
  plan_title: string | null;
  plan_status: string | null;
};

type Summary = {
  connected_patients: number | string;
  active_plans: number | string;
  total_plans: number | string;
  completed_fractions: number | string;
  missed_fractions: number | string;
  upcoming_fractions: number | string;
  symptom_entries: number | string;
  unacknowledged_symptoms: number | string;
  prescribed_fractions: number | string;
  completion_percent: number | string;
};

type TrendRow = {
  day: string;
  completed_fractions: number | string;
  missed_fractions: number | string;
  symptom_entries: number | string;
};

const asNumber = (value: number | string | null | undefined) => Number(value ?? 0);

export default function DoctorInsights() {
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [patientId, setPatientId] = useState('');
  const [planId, setPlanId] = useState('');
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const patients = useMemo(() => {
    const map = new Map<string, string>();
    filters.forEach(row => map.set(row.patient_id, row.patient_name));
    return [...map.entries()].map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filters]);

  const plans = useMemo(() => {
    const map = new Map<string, { id: string; title: string; patientId: string; status: string }>();
    filters.forEach(row => {
      if (!row.plan_id || !row.plan_title) return;
      if (patientId && row.patient_id !== patientId) return;
      map.set(row.plan_id, {
        id: row.plan_id,
        title: row.plan_title,
        patientId: row.patient_id,
        status: row.plan_status ?? '',
      });
    });
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [filters, patientId]);

  const refreshFilters = useCallback(async () => {
    const client = supabase;
    if (!client) throw new Error('Supabase is not configured.');
    const result = await client.rpc('rttrack_doctor_insight_filters');
    if (result.error) throw result.error;
    setFilters((result.data ?? []) as FilterRow[]);
  }, []);

  const refreshInsights = useCallback(async () => {
    const client = supabase;
    if (!client) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true);
    setError('');
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);
    try {
      const args = {
        p_patient_id: patientId || null,
        p_plan_id: planId || null,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      };
      const [summaryResult, trendResult] = await Promise.all([
        client.rpc('rttrack_doctor_insight_summary', args),
        client.rpc('rttrack_doctor_insight_trend', args),
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (trendResult.error) throw trendResult.error;
      setSummary(((summaryResult.data ?? [])[0] ?? null) as Summary | null);
      setTrend((trendResult.data ?? []) as TrendRow[]);
    } catch (caught) {
      setSummary(null);
      setTrend([]);
      setError(caught instanceof Error ? caught.message : 'Could not load doctor insights.');
    } finally {
      setLoading(false);
    }
  }, [patientId, planId, days]);

  useEffect(() => {
    void (async () => {
      try { await refreshFilters(); }
      catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load insight filters.'); }
    })();
  }, [refreshFilters]);

  useEffect(() => { void refreshInsights(); }, [refreshInsights]);

  useEffect(() => {
    if (planId && !plans.some(plan => plan.id === planId)) setPlanId('');
  }, [planId, plans]);

  const maxTrend = Math.max(1, ...trend.flatMap(row => [
    asNumber(row.completed_fractions),
    asNumber(row.missed_fractions),
    asNumber(row.symptom_entries),
  ]));

  return <section className="rti-root" aria-label="Doctor insights">
    <header className="rti-header">
      <div><span className="rti-eyebrow">DOCTOR PORTAL · INSIGHTS</span><h1>Insights</h1>
        <p>Review descriptive activity across records you are currently authorised to access.</p></div>
      <button type="button" className="rti-button" disabled={loading}
        onClick={() => { void refreshFilters().then(refreshInsights).catch(caught => setError(caught instanceof Error ? caught.message : 'Could not refresh insights.')); }}>
        <RefreshCw size={17}/> Refresh
      </button>
    </header>

    <section className="rti-filters" aria-label="Insight filters">
      <label>Period<select value={days} onChange={event => setDays(Number(event.target.value))}>
        <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
      </select></label>
      <label>Patient<select value={patientId} onChange={event => { setPatientId(event.target.value); setPlanId(''); }}>
        <option value="">All authorised patients</option>
        {patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
      </select></label>
      <label>Plan<select value={planId} onChange={event => setPlanId(event.target.value)}>
        <option value="">All accessible plans</option>
        {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}{plan.status ? ` · ${plan.status}` : ''}</option>)}
      </select></label>
    </section>

    {error && <p className="rti-error" role="alert">{error}</p>}
    {loading ? <p role="status">Loading insights…</p> : summary && <>
      <div className="rti-metrics">
        <article><Users size={20}/><span>Connected patients</span><strong>{asNumber(summary.connected_patients)}</strong></article>
        <article><CalendarDays size={20}/><span>Active plans</span><strong>{asNumber(summary.active_plans)}</strong></article>
        <article><CheckCircle2 size={20}/><span>Completed fractions</span><strong>{asNumber(summary.completed_fractions)}</strong></article>
        <article><Clock3 size={20}/><span>Missed fractions</span><strong>{asNumber(summary.missed_fractions)}</strong></article>
        <article><CalendarDays size={20}/><span>Upcoming fractions</span><strong>{asNumber(summary.upcoming_fractions)}</strong></article>
        <article><HeartPulse size={20}/><span>Shared symptom entries</span><strong>{asNumber(summary.symptom_entries)}</strong></article>
        <article><HeartPulse size={20}/><span>Unacknowledged symptoms</span><strong>{asNumber(summary.unacknowledged_symptoms)}</strong></article>
        <article><Activity size={20}/><span>Overall recorded completion</span><strong>{asNumber(summary.completion_percent).toFixed(1)}%</strong></article>
      </div>

      <section className="rti-card">
        <div className="rti-card-head"><div><h2>Activity trend</h2><p>Counts are record activity, not predictions or clinical risk scores.</p></div>
          <span>{days}-day view</span></div>
        {trend.length === 0 ? <p>No activity was recorded in this period.</p> :
          <div className="rti-trend-list">
            {trend.map(row => {
              const completed = asNumber(row.completed_fractions);
              const missed = asNumber(row.missed_fractions);
              const symptoms = asNumber(row.symptom_entries);
              return <div className="rti-day" key={row.day}>
                <time>{formatDate(`${row.day}T00:00:00`)}</time>
                <div className="rti-bars">
                  <div><span>Completed</span><i style={{ width: `${(completed / maxTrend) * 100}%` }}/><strong>{completed}</strong></div>
                  <div><span>Missed</span><i style={{ width: `${(missed / maxTrend) * 100}%` }}/><strong>{missed}</strong></div>
                  <div><span>Symptoms</span><i style={{ width: `${(symptoms / maxTrend) * 100}%` }}/><strong>{symptoms}</strong></div>
                </div>
              </div>;
            })}
          </div>}
      </section>
    </>}
  </section>;
}
