import { useEffect, useState, type FormEvent } from 'react';
import { Bell, CalendarDays, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { supabase } from './supabase';
import './reminders.css';
import './notification-preferences.css';

type EmailPreference = { notification_type: 'personal_reminder' | 'appointment'; enabled: boolean; updated_at: string };
type Reminder = { reminder_id: string; title: string; due_at: string; status: 'pending' | 'done' | 'cancelled'; created_at: string; finished_at: string | null };
type Plan = { plan_id: string; title: string; status: string; next_session_at: string | null; next_session_location: string | null; next_fraction_number: number | null };
type Appointment = { session_id: string; fraction_number: number; scheduled_for: string; location: string | null; status: string; title: string };
function readable(value: string): string { return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : 'The request could not be completed.'; }

export default function PatientReminders() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [emailPreferences, setEmailPreferences] = useState<EmailPreference[]>([]);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function refresh() {
    const client = supabase;
    if (!client) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [r, p, n] = await Promise.all([
        client.rpc('rttrack_list_personal_reminders'),
        client.rpc('rttrack_list_treatment_plans'),
        client.rpc('rttrack_list_email_preferences'),
      ]);
      if (r.error) throw r.error;
      if (p.error) throw p.error;
      if (n.error) throw n.error;
      setEmailPreferences((n.data ?? []) as EmailPreference[]);
      const plans = ((p.data ?? []) as Plan[]).filter(plan => plan.status === 'active');
      const sessionGroups = await Promise.all(plans.slice(0, 20).map(async plan => {
        const result = await client.rpc('rttrack_list_treatment_sessions', { p_plan_id: plan.plan_id });
        if (result.error) throw result.error;
        return ((result.data ?? []) as Omit<Appointment, 'title'>[]).filter(s => s.status === 'scheduled')
          .map(s => ({ ...s, title: plan.title }));
      }));
      setReminders((r.data ?? []) as Reminder[]);
      setAppointments(sessionGroups.flat().filter(s => new Date(s.scheduled_for).getTime() >= Date.now())
        .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)).slice(0, 30));
    } catch (caught) { setError(errorText(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = supabase;
    if (!client || busy) return;
    setError(''); setSuccess('');
    const cleaned = title.trim();
    const due = new Date(dueLocal);
    if (cleaned.length < 2 || cleaned.length > 100 || Number.isNaN(due.getTime()) || due.getTime() < Date.now()) {
      setError('Enter a title of 2–100 characters and select a future date and time.'); return;
    }
    setBusy(true);
    try {
      const result = await client.rpc('rttrack_create_personal_reminder', { p_title: cleaned, p_due_at: due.toISOString() });
      if (result.error) throw result.error;
      setTitle(''); setDueLocal(''); setSuccess('Reminder saved. If you opted in and server-side email delivery is active, an email may be sent when it is due.');
      await refresh();
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  async function changeStatus(id: string, status: 'done' | 'cancelled') {
    const client = supabase;
    if (!client || busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const result = await client.rpc('rttrack_set_personal_reminder_status', { p_reminder_id: id, p_status: status });
      if (result.error) throw result.error;
      if (result.data !== true) throw new Error('The reminder was already changed or is unavailable. Refresh and try again.');
      setSuccess(status === 'done' ? 'Marked completed.' : 'Reminder cancelled.');
      await refresh();
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  async function changeEmailPreference(kind: EmailPreference['notification_type'], enabled: boolean) {
    const client = supabase;
    if (!client || busy || preferenceBusy) return;
    setPreferenceBusy(true); setError(''); setSuccess('');
    try {
      const result = await client.rpc('rttrack_set_email_preference', { p_notification_type: kind, p_enabled: enabled });
      if (result.error) throw result.error;
      if (result.data !== true) throw new Error('Preference could not be saved.');
      setEmailPreferences(previous => {
        const rest = previous.filter(item => item.notification_type !== kind);
        return [...rest, { notification_type: kind, enabled, updated_at: new Date().toISOString() }];
      });
      setSuccess(enabled ? 'Email preference saved. Emails require the scheduled delivery service to be activated by your administrator.' : 'Email preference turned off.');
    } catch (caught) { setError(errorText(caught)); }
    finally { setPreferenceBusy(false); }
  }
  function preferenceEnabled(kind: EmailPreference['notification_type']): boolean {
    return emailPreferences.some(item => item.notification_type === kind && item.enabled);
  }
  const pending = reminders.filter(item => item.status === 'pending').sort((a, b) => a.due_at.localeCompare(b.due_at));
  const previous = reminders.filter(item => item.status !== 'pending');
  return <section className="rtr-root" aria-labelledby="rtr-heading">
    <div className="rtr-heading"><div><span className="rtr-kicker">RTTRACK · DAILY ADHERENCE</span><h2 id="rtr-heading">Reminders & appointments</h2><p>Keep track of appointments and personal care tasks.</p></div><button className="rtr-secondary" type="button" onClick={() => void refresh()} disabled={loading || busy}><RefreshCw size={16}/> Refresh</button></div>
    <div className="rtr-banner" role="note"><strong>Development notice:</strong> Emails are sent only if you opt in AND the administrator activates the scheduled email service. They may be delayed or fail. No SMS or emergency alerts are provided; clinicians do not monitor this screen. Follow your care team's instructions for medical decisions.</div>
    {error && <p className="rtr-alert rtr-error" role="alert">{error}</p>}
    {success && <p className="rtr-alert rtr-success" role="status">{success}</p>}
    <div className="rtr-grid"><article className="rtr-card"><h3><CalendarDays size={21}/> Scheduled radiotherapy sessions</h3>{loading ? <p>Loading appointments…</p> : appointments.length === 0 ? <p className="rtr-muted">No upcoming scheduled sessions in published plans.</p> : <ul className="rtr-list">{appointments.map(a => <li key={a.session_id}><span className="rtr-date">{readable(a.scheduled_for)}</span><strong>{a.title} · Fraction {a.fraction_number}</strong><small>{a.location || 'Location not entered'}</small></li>)}</ul>}<small className="rtr-note">These dates come from your published treatment records; only your care team can change them.</small></article>
    <article className="rtr-card"><h3><Clock3 size={21}/> Add a personal reminder</h3><p className="rtr-muted">For personal, non-emergency care tasks. This does not alter medication prescriptions or appointments.</p><form onSubmit={event => void create(event)} className="rtr-form"><label>Task name<input required minLength={2} maxLength={100} value={title} onChange={event => setTitle(event.target.value)} placeholder="For example, prepare for tomorrow's visit" disabled={busy}/></label><label>Date and time<input required type="datetime-local" value={dueLocal} onChange={event => setDueLocal(event.target.value)} disabled={busy}/></label><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save reminder'}</button></form></article></div>
    <article className="rtn-card" aria-labelledby="rtn-title">
      <h3 id="rtn-title"><Bell size={21}/> Email notification preferences</h3>
      <p className="rtn-offline"><strong>Development feature:</strong> Email delivery requires the administrator to deploy and activate RTTRACK's scheduled notification service. Enabling a preference alone does not prove delivery. No SMS or emergency alerts are available.</p>
      <label className="rtn-toggle"><span><strong>Personal reminder emails</strong><small>Receive a generic email when a personal reminder is due, if email delivery is active. Titles and health details are excluded.</small></span><input type="checkbox" checked={preferenceEnabled('personal_reminder')} disabled={loading || busy || preferenceBusy} onChange={event => void changeEmailPreference('personal_reminder', event.target.checked)}/></label>
      <label className="rtn-toggle"><span><strong>Appointment emails</strong><small>Receive a generic email approximately 24 hours before a scheduled fraction, if delivery is active. Dates and treatment details are excluded.</small></span><input type="checkbox" checked={preferenceEnabled('appointment')} disabled={loading || busy || preferenceBusy} onChange={event => void changeEmailPreference('appointment', event.target.checked)}/></label>
      <small className="rtn-status" role="status">{preferenceBusy ? 'Saving preference…' : 'SMS preferences are not yet available.'}</small>
    </article>
    <article className="rtr-card"><h3><CheckCircle2 size={21}/> My reminders</h3>{loading ? <p>Loading reminders…</p> : pending.length === 0 ? <p className="rtr-muted">No pending reminders. Add your first personal task above.</p> : <ul className="rtr-list rtr-task-list">{pending.map(item => <li key={item.reminder_id}><div><strong>{item.title}</strong><small className={new Date(item.due_at).getTime() < Date.now() ? 'rtr-overdue' : ''}>{readable(item.due_at)}{new Date(item.due_at).getTime() < Date.now() ? ' · Past due' : ''}</small></div><div className="rtr-buttons"><button type="button" disabled={busy} onClick={() => void changeStatus(item.reminder_id, 'done')}>Complete</button><button className="rtr-secondary" type="button" disabled={busy} onClick={() => void changeStatus(item.reminder_id, 'cancelled')}>Cancel</button></div></li>)}</ul>}{previous.length > 0 && <details className="rtr-history"><summary>Completed & cancelled ({previous.length})</summary><ul className="rtr-list">{previous.map(item => <li key={item.reminder_id}><strong>{item.title}</strong><small>{item.status === 'done' ? 'Completed' : 'Cancelled'} · {readable(item.due_at)}</small></li>)}</ul></details>}</article>
  </section>;
}
