import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Activity, Bell, CalendarDays, CheckCircle2, Clock3, HeartPulse, RefreshCw } from 'lucide-react';
import { supabase } from './supabase';
import { formatDateTime } from './date-format';
import './patient-insights.css';

type Plan = {
  plan_id: string; title: string; status: string; total_fractions: number;
  completed_fractions: number; missed_fractions: number; next_session_at: string | null;
  next_session_location: string | null; next_fraction_number: number | null;
};
type Session = {
  session_id: string; plan_id: string; fraction_number: number; scheduled_for: string; location: string | null;
  status: 'scheduled' | 'completed' | 'missed'; delivered_gy: number | null; completed_at: string | null;
};
type SymptomEntry = { entry_id: string; onset_at: string; severity: number; symptom_type: string };
type Reminder = { reminder_id: string; title: string; due_at: string; status: 'pending' | 'done' | 'cancelled' };

const symptomLabel = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export default function PatientInsights({ userId }: { userId: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [symptoms, setSymptoms] = useState<SymptomEntry[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const client = supabase;
    if (!client) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [planResult, symptomResult, reminderResult] = await Promise.all([
        client.rpc('rttrack_list_treatment_plans'),
        client.rpc('rttrack_list_symptoms', { p_patient_id: null }),
        client.rpc('rttrack_list_personal_reminders'),
      ]);
      if (planResult.error) throw planResult.error;
      if (symptomResult.error) throw symptomResult.error;
      if (reminderResult.error) throw reminderResult.error;

      const nextPlans = (planResult.data ?? []) as Plan[];
      const readablePlans = nextPlans.filter(plan => plan.status !== 'draft');
      const sessionGroups = await Promise.all(readablePlans.slice(0, 25).map(async plan => {
        const result = await client.rpc('rttrack_list_treatment_sessions', { p_plan_id: plan.plan_id });
        if (result.error) throw result.error;
        return ((result.data ?? []) as Omit<Session, 'plan_id'>[]).map(session => ({ ...session, plan_id: plan.plan_id }));
      }));

      setPlans(readablePlans);
      setSessions(sessionGroups.flat());
      setSymptoms((symptomResult.data ?? []) as SymptomEntry[]);
      setReminders((reminderResult.data ?? []) as Reminder[]);
    } catch (caught) {
      setPlans([]); setSessions([]); setSymptoms([]); setReminders([]);
      setError(caught instanceof Error ? caught.message : 'Could not load insights.');
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const activePlans = plans.filter(plan => plan.status === 'active');
  const completed = sessions.filter(session => session.status === 'completed').length;
  const missed = sessions.filter(session => session.status === 'missed').length;
  const activePlanIds = new Set(activePlans.map(plan => plan.plan_id));
  const upcoming = sessions.filter(session => activePlanIds.has(session.plan_id) && session.status === 'scheduled' && new Date(session.scheduled_for).getTime() >= now)
    .sort((a,b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  const recentSymptoms = symptoms.filter(entry => new Date(entry.onset_at).getTime() >= sevenDaysAgo);
  const pendingReminders = reminders.filter(reminder => reminder.status === 'pending');
  const prescribed = activePlans.reduce((sum, plan) => sum + Number(plan.total_fractions || 0), 0);
  const completedOnActive = activePlans.reduce((sum, plan) => sum + Number(plan.completed_fractions || 0), 0);
  const missedOnActive = activePlans.reduce((sum, plan) => sum + Number(plan.missed_fractions || 0), 0);
  const futureScheduled = upcoming.length;
  const unplanned = Math.max(0, prescribed - completedOnActive - missedOnActive - futureScheduled);
  const progress = prescribed > 0 ? Math.min(100, Math.round((completedOnActive / prescribed) * 100)) : 0;

  const treatmentParts = [
    { label: 'Completed', value: completedOnActive, className: 'rtpi-completed' },
    { label: 'Missed', value: missedOnActive, className: 'rtpi-missed' },
    { label: 'Scheduled', value: futureScheduled, className: 'rtpi-scheduled' },
    { label: 'Not yet scheduled', value: unplanned, className: 'rtpi-unplanned' },
  ];
  const treatmentTotal = Math.max(1, treatmentParts.reduce((sum, part) => sum + part.value, 0));
  const completedEnd = (treatmentParts[0].value / treatmentTotal) * 100;
  const missedEnd = completedEnd + (treatmentParts[1].value / treatmentTotal) * 100;
  const scheduledEnd = missedEnd + (treatmentParts[2].value / treatmentTotal) * 100;
  const treatmentDonutStyle = {
    '--rtpi-a': `${completedEnd}%`,
    '--rtpi-b': `${missedEnd}%`,
    '--rtpi-c': `${scheduledEnd}%`,
  } as CSSProperties;

  const symptomDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    recentSymptoms.forEach(entry => counts.set(entry.symptom_type, (counts.get(entry.symptom_type) ?? 0) + 1));
    return [...counts.entries()]
      .map(([type, count]) => ({ type, label: symptomLabel(type), count }))
      .sort((a,b) => b.count - a.count);
  }, [recentSymptoms]);
  const symptomTotal = Math.max(1, recentSymptoms.length);
  const topSymptom = symptomDistribution[0] ?? null;
  const topPercent = topSymptom ? Math.round((topSymptom.count / symptomTotal) * 100) : 0;
  const second = symptomDistribution[1]?.count ?? 0;
  const topEnd = topPercent;
  const secondEnd = topEnd + Math.round((second / symptomTotal) * 100);
  const symptomDonutStyle = {
    '--rtpi-a': `${topEnd}%`,
    '--rtpi-b': `${secondEnd}%`,
  } as CSSProperties;

  return <section className="rtpi-root" aria-labelledby="rtpi-title">
    <header className="rtpi-header"><div><span className="rtpi-eyebrow">PATIENT PORTAL · INSIGHTS</span><h1 id="rtpi-title">My insights</h1>
      <p>A summary of the treatment, symptom and reminder records in your RTTRACK account.</p></div>
      <button type="button" className="rtpi-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={17}/> Refresh</button>
    </header>

    {error && <p className="rtpi-error" role="alert">{error}</p>}
    {loading ? <p role="status">Loading your insightsâ€¦</p> : <>
      <div className="rtpi-metrics">
        <article><CalendarDays size={21}/><span>Active treatment plans</span><strong>{activePlans.length}</strong></article>
        <article><CheckCircle2 size={21}/><span>Completed fractions</span><strong>{completed}</strong></article>
        <article><Clock3 size={21}/><span>Missed fractions</span><strong>{missed}</strong></article>
        <article><HeartPulse size={21}/><span>Symptoms logged · 7 days</span><strong>{recentSymptoms.length}</strong></article>
        <article><Bell size={21}/><span>Pending reminders</span><strong>{pendingReminders.length}</strong></article>
        <article><Activity size={21}/><span>Active-plan progress</span><strong>{progress}%</strong></article>
      </div>

      <div className="rtpi-grid">
        <section className="rtpi-card"><h2>Treatment progress</h2>
          {activePlans.length === 0 ? <p>No active treatment plan is recorded.</p> : <>
            <div className="rtpi-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{width:`${progress}%`}}/></div>
            <p><strong>{completedOnActive}</strong> of <strong>{prescribed}</strong> prescribed fractions are recorded as completed across active plans.</p>
            {upcoming[0] ? <div className="rtpi-next"><span>Next scheduled fraction</span><strong>#{upcoming[0].fraction_number} · {formatDateTime(upcoming[0].scheduled_for)}</strong><small>{upcoming[0].location || 'Location not recorded'}</small></div> :
              <p>No upcoming scheduled fraction is recorded.</p>}

            <div className="rtpi-analytic"><div className="rtpi-donut rtpi-treatment-donut" style={treatmentDonutStyle} aria-label="Fraction status distribution"><div><strong>{progress}%</strong><span>complete</span></div></div>
              <div className="rtpi-legend">{treatmentParts.map(part => <div key={part.label}><i className={part.className}/><span>{part.label}</span><strong>{part.value} · {Math.round((part.value/treatmentTotal)*100)}%</strong></div>)}</div></div>
          </>}
        </section>

        <section className="rtpi-card"><h2>Recent symptom activity</h2>
          {recentSymptoms.length === 0 ? <p>No symptom entries were logged in the last 7 days.</p> :
            <><p><strong>{recentSymptoms.length}</strong> entries in the last 7 days.</p>
              <div className="rtpi-analytic"><div className="rtpi-donut rtpi-symptom-donut" style={symptomDonutStyle} aria-label="Recent symptom distribution"><div><strong>{topPercent}%</strong><span>{topSymptom?.label ?? 'No entries'}</span></div></div>
                <div className="rtpi-legend">
                  {symptomDistribution.slice(0,5).map((item,index) => <div key={item.type}><i className={`rtpi-symptom-key rtpi-symptom-key-${Math.min(index+1,3)}`}/><span>{item.label}</span><strong>{item.count} · {Math.round((item.count/symptomTotal)*100)}%</strong></div>)}
                  {symptomDistribution.length > 5 && <small>+ {symptomDistribution.length - 5} more symptom types</small>}
                </div>
              </div>
              <p className="rtpi-insight-line">Highest recorded recent symptom activity: <strong>{topSymptom?.label}</strong> ({topPercent}%).</p></>}
        </section>
      </div>
    </>}
  </section>;
}

