import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, ClipboardList, Link2, Users } from 'lucide-react';
import { supabase } from './supabase';
import './clinician-dashboard.css';

type Destination = 'Connections' | 'Treatment' | 'Symptoms' | 'Education';
type Link = {
  id: string;
  patient_id: string;
  patient_name: string;
  initiated_by: string;
  status: string;
  patient_consented_at: string | null;
};
type Plan = {
  plan_id: string;
  patient_id: string;
  patient_name: string;
  created_by: string;
  title: string;
  status: string;
  total_fractions: number;
  completed_fractions: number;
  next_session_at: string | null;
  next_session_location: string | null;
  next_fraction_number: number | null;
};
type Session = {
  session_id: string;
  status: string;
  completed_at: string | null;
};
type ChartState = 'loading' | 'ready' | 'error';

type DailyPoint = { day: string; label: string; count: number };

function localDayKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function dailyCompletedCounts(sessions: Session[], days = 14): DailyPoint[] {
  const today = new Date();
  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - index));
    return { day: localDayKey(date), label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), count: 0 };
  });
  const lookup = new Map(buckets.map((bucket, index) => [bucket.day, index]));
  for (const session of sessions) {
    if (session.status !== 'completed' || !session.completed_at) continue;
    const completed = new Date(session.completed_at);
    if (Number.isNaN(completed.getTime())) continue;
    const position = lookup.get(localDayKey(completed));
    if (position !== undefined) buckets[position].count++;
  }
  return buckets;
}

/** Read-only counts of clinician-recorded completions, never a clinical outcome or adherence score. */
function CompletedFractionsChart({ sessions }: { sessions: Session[] }) {
  const days = dailyCompletedCounts(sessions);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const highest = Math.max(...days.map(day => day.count));
  const ceiling = Math.max(4, Math.ceil(highest / 4) * 4);
  const left = 47;
  const right = 752;
  const top = 23;
  const bottom = 187;
  const x = (index: number) => left + index / Math.max(1, days.length - 1) * (right - left);
  const y = (count: number) => bottom - count / ceiling * (bottom - top);
  const path = days.map((day, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(day.count).toFixed(1)}`).join(' ');
  return <>
    <div className="rtcd-chart-summary"><div><strong>{total}</strong><span>recorded completed fractions in this period</span></div>
      <span className="rtcd-chart-legend"><i aria-hidden="true" /> Daily recorded completions</span></div>
    {total === 0 ? <p className="rtcd-empty">No completed fractions were recorded in the last 14 calendar days.</p> :
      <div className="rtcd-chart-viewport">
        <svg viewBox="0 0 800 235" role="img" aria-label={`Line chart of recorded completed fractions over the last 14 calendar days. Total ${total}; maximum ${highest} on a day.`}>
          <title>Daily recorded completed fractions — last 14 days</title>
          {[0, 1, 2, 3, 4].map(step => {
            const value = ceiling / 4 * step;
            return <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#e1e8f7" strokeWidth="1" />
              <text x={left - 12} y={y(value) + 4} textAnchor="end" fontSize="12" fill="#536380">{value}</text></g>;
          })}
          <path d={path} fill="none" stroke="#0b125c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {days.map((day, index) => <circle key={day.day} cx={x(index)} cy={y(day.count)} r="4.5" stroke="#0b125c" strokeWidth="2" fill="#fff">
            <title>{`${day.label}: ${day.count} recorded completed fraction${day.count === 1 ? '' : 's'}`}</title></circle>)}
          {[0, 3, 6, 9, 13].map(index => <text key={days[index].day} x={x(index)} y="216" textAnchor={index === 0 ? 'start' : index === 13 ? 'end' : 'middle'} fontSize="12" fill="#536380">{days[index].label}</text>)}
        </svg>
      </div>}
    {total > 0 && <p className="rtcd-chart-swipe">Swipe the chart horizontally to see all dates.</p>}
    <details className="rtcd-chart-data"><summary>View daily counts as a table</summary>
      <div className="rtcd-chart-data-scroll"><table><thead><tr><th scope="col">Date</th><th scope="col">Recorded completions</th></tr></thead>
        <tbody>{days.map(day => <tr key={day.day}><td>{day.label}</td><td>{day.count}</td></tr>)}</tbody></table></div>
    </details>
    <p className="rtcd-hint">Counts use the date a fraction was marked completed, not the scheduled treatment date. Data is limited to plans you can currently access. This is a record-keeping summary, not an adherence or clinical outcome measure.</p>
  </>;
}

type Props = {
  userId: string;
  clinicianName: string;
  onNavigate: (destination: Destination) => void;
};

function formatAppointment(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : parsed.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function ClinicianDashboard({ userId, clinicianName, onNavigate }: Props) {
  const [links, setLinks] = useState<Link[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [linksError, setLinksError] = useState('');
  const [plansError, setPlansError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [chartSessions, setChartSessions] = useState<Session[]>([]);
  const [chartStatus, setChartStatus] = useState<ChartState>('loading');
  const [chartError, setChartError] = useState('');

  useEffect(() => {
    let current = true;
    setLinks([]);
    setPlans([]);
    setLinksError('');
    setPlansError('');
    setLoading(true);
    const load = async () => {
      if (!supabase) {
        if (current) { setLinksError('Supabase is not configured.'); setPlansError('Supabase is not configured.'); setLoading(false); }
        return;
      }
      const client = supabase;
      // Existing SQL functions enforce clinician approval, connection and sharing consent.
      // Never query the protected treatment/connection tables directly from the browser.
      const [linkResult, planResult] = await Promise.allSettled([
        client.rpc('rttrack_list_my_links'),
        client.rpc('rttrack_list_treatment_plans'),
      ]);
      if (!current) return;
      if (linkResult.status === 'rejected') {
        setLinksError('Unable to load your connections. Please retry.');
      } else if (linkResult.value.error) {
        setLinksError(linkResult.value.error.message);
      } else {
        setLinks((linkResult.value.data ?? []) as Link[]);
      }
      if (planResult.status === 'rejected') {
        setPlansError('Unable to load shared treatment plans. Please retry.');
      } else if (planResult.value.error) {
        setPlansError(planResult.value.error.message);
      } else {
        setPlans((planResult.value.data ?? []) as Plan[]);
      }
      setLoading(false);
    };
    void load();
    return () => { current = false; };
  }, [userId, refreshKey]);

  useEffect(() => {
    let current = true;
    setChartSessions([]);
    setChartError('');
    if (loading) { setChartStatus('loading'); return () => { current = false; }; }
    if (plansError || !supabase) {
      setChartStatus('error');
      setChartError('Treatment data could not be loaded.');
      return () => { current = false; };
    }
    // Plans and their sessions are returned only by existing permission-checked RPCs.
    // Limit simultaneous requests rather than issuing one request per plan at once.
    // Existing RPCs cap the plan list at 100 and each session list at 1000.
    // Avoid presenting a potentially incomplete chart as an account-wide total.
    if (plans.length >= 100 || plans.some(plan => Number(plan.completed_fractions) >= 1000)) {
      setChartStatus('error');
      setChartError('The existing treatment service has reached its record limit. The chart cannot show a complete summary.');
      return () => { current = false; };
    }
    const eligible = plans.filter(plan => plan.status !== 'draft' && Number(plan.completed_fractions) > 0);
    if (eligible.length === 0) { setChartStatus('ready'); return () => { current = false; }; }
    setChartStatus('loading');
    const client = supabase;
    const load = async () => {
      const received: Session[] = [];
      let next = 0;
      const worker = async () => {
        while (next < eligible.length && current) {
          const plan = eligible[next++];
          const result = await client.rpc('rttrack_list_treatment_sessions', { p_plan_id: plan.plan_id });
          if (result.error) throw new Error(result.error.message);
          received.push(...((result.data ?? []) as Session[]));
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(4, eligible.length) }, () => worker()));
        if (current) { setChartSessions(received); setChartStatus('ready'); }
      } catch {
        if (current) { setChartSessions([]); setChartError('Daily records could not be loaded. Refresh to try again.'); setChartStatus('error'); }
      }
    };
    void load();
    return () => { current = false; };
  }, [plans, plansError, loading, userId]);

  const connected = useMemo(() => new Set(links.filter(link => link.status === 'active' && link.patient_consented_at)
    .map(link => link.patient_id)).size, [links]);
  const incoming = useMemo(() => links.filter(link => link.status === 'pending' && link.initiated_by !== userId).length, [links, userId]);
  const activePlans = useMemo(() => plans.filter(plan => plan.status === 'active'), [plans]);
  const ownDrafts = useMemo(() => plans.filter(plan => plan.status === 'draft' && plan.created_by === userId), [plans, userId]);
  const upcoming = useMemo(() => activePlans.filter(plan => plan.next_session_at &&
    new Date(plan.next_session_at).getTime() >= Date.now())
    .sort((a, b) => new Date(a.next_session_at!).getTime() - new Date(b.next_session_at!).getTime()), [activePlans]);

  const metrics = [
    { label: 'Connected patients', value: linksError ? '—' : String(connected), detail: 'Active, consented care connections', Icon: Users, destination: 'Connections' as const, disabled: !!linksError },
    { label: 'Requests to respond to', value: linksError ? '—' : String(incoming), detail: 'Incoming connection requests', Icon: Link2, destination: 'Connections' as const, disabled: !!linksError },
    { label: 'Active plans', value: plansError ? '—' : String(activePlans.length), detail: 'Treatment plans shared with you', Icon: ClipboardList, destination: 'Treatment' as const, disabled: !!plansError },
    { label: 'My draft plans', value: plansError ? '—' : String(ownDrafts.length), detail: 'Not yet published to patients', Icon: CalendarDays, destination: 'Treatment' as const, disabled: !!plansError },
  ];


  return <div className="rtcd-root">
    <div className="rtcd-header">
      <div><span className="rtcd-eyebrow">CLINICIAN PORTAL · DASHBOARD</span>
        <h1>Welcome back, {clinicianName}</h1>
        
      </div>
      <button type="button" className="rtcd-outline" onClick={() => setRefreshKey(key => key + 1)} disabled={loading}>
        <span aria-hidden="true">↻</span>
      </button>
    </div>
    
    {(linksError || plansError) && <div className="rtcd-error" role="alert">
      <strong>Some information could not be loaded.</strong>
      {linksError && <p>Connections: {linksError}</p>}
      {plansError && <p>Treatment: {plansError}</p>}
      <button type="button" className="rtcd-outline" disabled={loading} onClick={() => setRefreshKey(key => key + 1)}>Retry loading</button>
    </div>}

    <section className="rtcd-metrics" aria-label="Your workspace summary">
      {metrics.map(({ label, value, detail, Icon, destination, disabled }) => <article className="rtcd-metric" key={label}>
        <div className="rtcd-metric-top"><span>{label}</span><Icon size={19} aria-hidden="true" /></div>
        <strong className="rtcd-metric-number" aria-label={`${label}: ${loading ? 'Loading' : value}`}>{loading ? '…' : value}</strong>
        <p>{detail}</p>
        <button type="button" className="rtcd-text-button" disabled={disabled || loading} onClick={() => onNavigate(destination)}>
          View {destination.toLowerCase()} <ArrowRight size={15} aria-hidden="true" />
        </button>
      </article>)}
    </section>

    <div className="rtcd-main-grid">
      <section className="rtcd-card" aria-labelledby="rtcd-upcoming-title">
        <div className="rtcd-section-head"><div><span className="rtcd-eyebrow">NEXT RECORDED SESSIONS</span>
          <h2 id="rtcd-upcoming-title">Upcoming appointments</h2></div>
          <button type="button" className="rtcd-text-button" onClick={() => onNavigate('Treatment')}>Treatment <ArrowRight size={15} aria-hidden="true" /></button>
        </div>
        <p className="rtcd-hint">Shows the earliest upcoming scheduled fraction for each accessible active plan—not the complete appointment calendar.</p>
        {loading ? <p role="status" className="rtcd-empty">Loading appointments…</p> : plansError ?
          <p className="rtcd-empty">Appointments unavailable while treatment records cannot be loaded.</p> : upcoming.length === 0 ?
          <p className="rtcd-empty">No upcoming sessions are returned for your accessible active plans. Open Treatment to check the full records.</p> :
          <div className="rtcd-appointment-list">{upcoming.slice(0, 5).map(plan => <article className="rtcd-appointment" key={plan.plan_id}>
            <span className="rtcd-date"><CalendarDays size={18} aria-hidden="true" />
              <time dateTime={plan.next_session_at!}>{formatAppointment(plan.next_session_at!)}</time></span>
            <strong>{plan.patient_name}</strong><span className="rtcd-wrap">{plan.title} · Fraction {plan.next_fraction_number ?? 'not specified'}</span>
            {plan.next_session_location && <small>Location: {plan.next_session_location}</small>}
          </article>)}</div>}
        {!loading && !plansError && upcoming.length > 5 && <p className="rtcd-hint">Showing the first five upcoming plan sessions. Open Treatment for more.</p>}
      </section>

      <section className="rtcd-card" aria-labelledby="rtcd-plans-title">
        <div className="rtcd-section-head"><div><span className="rtcd-eyebrow">TREATMENT OVERVIEW</span><h2 id="rtcd-plans-title">Active treatment plans</h2></div>
          <button type="button" className="rtcd-text-button" onClick={() => onNavigate('Treatment')}>All plans <ArrowRight size={15} aria-hidden="true" /></button>
        </div>
        {loading ? <p role="status" className="rtcd-empty">Loading treatment plans…</p> : plansError ?
          <p className="rtcd-empty">Treatment plans could not be loaded.</p> : activePlans.length === 0 ?
          <p className="rtcd-empty">No active treatment plans are currently shared with you.</p> :
          <div className="rtcd-plan-list">{activePlans.slice(0, 4).map(plan => {
            const done = Number(plan.completed_fractions) || 0;
            const total = Number(plan.total_fractions) || 0;
            const percent = total > 0 ? Math.max(0, Math.min(100, done / total * 100)) : 0;
            return <article className="rtcd-plan" key={plan.plan_id}>
              <div className="rtcd-plan-top"><div className="rtcd-wrap"><strong>{plan.patient_name}</strong><small>{plan.title}</small></div>
                <span className="rtcd-status">Active</span></div>
              <div className="rtcd-progress-label"><span>Fractions recorded completed</span><strong>{done} / {total}</strong></div>
              <div className="rtcd-progress" role="progressbar" aria-label={`${plan.patient_name}: fractions recorded completed`}
                aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={Math.min(done, Math.max(total, 1))}>
                <span style={{ width: `${percent}%` }} /></div>
            </article>;
          })}</div>}
        {!loading && !plansError && activePlans.length > 4 && <p className="rtcd-hint">Showing four plans. Open Treatment to view the others.</p>}
      </section>
    </div>

    <section className="rtcd-card rtcd-analytics" aria-labelledby="rtcd-analytics-title">
      <div className="rtcd-section-head"><div><span className="rtcd-eyebrow">RECORD ACTIVITY · LAST 14 DAYS</span>
        <h2 id="rtcd-analytics-title">Recorded fraction completions</h2></div>
        <button type="button" className="rtcd-text-button" onClick={() => onNavigate('Treatment')}>View treatment <ArrowRight size={15} aria-hidden="true" /></button>
      </div>
      {chartStatus === 'loading' ? <p className="rtcd-empty" role="status">Loading recorded activity…</p> :
       chartStatus === 'error' ? <p className="rtcd-empty" role="alert">{chartError}</p> :
       <CompletedFractionsChart sessions={chartSessions} />}
    </section>
    {(links.length >= 100 || plans.length >= 100) && !loading && <p className="rtcd-hint">Summary counts reflect up to 100 records returned by each existing service; larger totals may not be represented.</p>}
  </div>;
}
