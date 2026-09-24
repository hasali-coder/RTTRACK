import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, CheckCircle2, X } from 'lucide-react';
import { supabase } from './supabase';
import { formatDateTime } from './date-format';
import './patient-topbar-tools.css';

type Reminder = { reminder_id: string; title: string; due_at: string; status: 'pending' | 'done' | 'cancelled' };
type Plan = { plan_id: string; title: string; status: string };
type Session = { session_id: string; fraction_number: number; scheduled_for: string; location: string | null; status: string };
type Appointment = Session & { title: string };

export default function PatientNotifications({ open, onClose, onNavigate }: {
  open: boolean;
  onClose: () => void;
  onNavigate: (destination: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const client = supabase;
    if (!client) { setError('Supabase is not configured.'); return; }
    setLoading(true); setError('');
    try {
      const [reminderResult, planResult] = await Promise.all([
        client.rpc('rttrack_list_personal_reminders'),
        client.rpc('rttrack_list_treatment_plans'),
      ]);
      if (reminderResult.error) throw reminderResult.error;
      if (planResult.error) throw planResult.error;
      const plans = ((planResult.data ?? []) as Plan[]).filter(plan => plan.status === 'active');
      const groups = await Promise.all(plans.slice(0, 20).map(async plan => {
        const result = await client.rpc('rttrack_list_treatment_sessions', { p_plan_id: plan.plan_id });
        if (result.error) throw result.error;
        return ((result.data ?? []) as Session[])
          .filter(session => session.status === 'scheduled' && new Date(session.scheduled_for).getTime() >= Date.now())
          .map(session => ({ ...session, title: plan.title }));
      }));
      setReminders(((reminderResult.data ?? []) as Reminder[]).filter(item => item.status === 'pending')
        .sort((a,b) => a.due_at.localeCompare(b.due_at)).slice(0, 8));
      setAppointments(groups.flat().sort((a,b) => a.scheduled_for.localeCompare(b.scheduled_for)).slice(0, 8));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load notifications.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) { dialog.showModal(); void refresh(); }
    if (!open && dialog.open) dialog.close();
  }, [open, refresh]);

  return <dialog ref={dialogRef} className="rtpt-dialog" aria-labelledby="rtpt-notifications-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="rtpt-shell">
      <div className="rtpt-head"><div><span>RTTRACK</span><h2 id="rtpt-notifications-title"><Bell size={20}/> Notifications</h2></div>
        <button type="button" aria-label="Close notifications" onClick={onClose}><X size={19}/></button></div>
      {error && <p className="rtpt-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading notifications…</p> : <>
        <section className="rtpt-section"><div className="rtpt-section-head"><h3><CalendarDays size={18}/> Upcoming treatment</h3>
          <button type="button" onClick={() => { onClose(); onNavigate('Treatment'); }}>View treatment</button></div>
          {appointments.length === 0 ? <p>No upcoming treatment sessions are recorded.</p> :
            <ul>{appointments.map(item => <li key={item.session_id}><strong>{item.title} · Fraction {item.fraction_number}</strong><span>{formatDateTime(item.scheduled_for)}</span><small>{item.location || 'Location not recorded'}</small></li>)}</ul>}
        </section>
        <section className="rtpt-section"><div className="rtpt-section-head"><h3><CheckCircle2 size={18}/> Personal reminders</h3>
          <button type="button" onClick={() => { onClose(); onNavigate('Reminders'); }}>Open reminders</button></div>
          {reminders.length === 0 ? <p>No pending personal reminders.</p> :
            <ul>{reminders.map(item => <li key={item.reminder_id}><strong>{item.title}</strong><span>{formatDateTime(item.due_at)}</span></li>)}</ul>}
        </section>
      </>}
    </div>
  </dialog>;
}
