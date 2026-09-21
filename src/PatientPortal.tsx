import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Bell, BookOpen, CalendarDays, CircleHelp, ClipboardList, HeartPulse, LayoutDashboard, LogOut, Menu, ShieldCheck, Sprout, X } from 'lucide-react';
import './patient-portal.css';
import './patient-profile.css';
import { supabase } from './supabase';
import ConnectionsPanel from './ConnectionsPanel';
import { TreatmentSummary, TreatmentTracker } from './TreatmentModule';
import { PatientSymptoms } from './SymptomModule';
import PatientReminders from './RemindersModule';
import EducationHub from './EducationHub';

type Props = { name: string; email: string; userId: string; onSignOut: () => Promise<void> };
type ProfileRow = { full_name: string; mobile_number: string | null };

const links = [
  { label: 'Dashboard', Icon: LayoutDashboard }, { label: 'My Profile', Icon: ShieldCheck }, { label: 'Connections', Icon: ShieldCheck }, { label: 'Treatment', Icon: CalendarDays },
  { label: 'Symptoms', Icon: HeartPulse }, { label: 'Reminders', Icon: Bell },
  { label: 'Education', Icon: BookOpen }, { label: 'Ask Zora', Icon: Sprout },
  { label: 'Community', Icon: ClipboardList }, { label: 'Insights', Icon: Activity },
];

function PatientProfile({ userId, email, initialName, onSaved }: { userId: string; email: string; initialName: string; onSaved: (name: string) => void }) {
  const [fullName, setFullName] = useState(initialName);
  const [mobile, setMobile] = useState('');
  const [original, setOriginal] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!supabase) { if (mounted) { setError('Supabase is not configured.'); setLoading(false); } return; }
      const { data, error: loadError } = await supabase.from('patient_profiles')
        .select('full_name,mobile_number').eq('user_id', userId).single();
      if (!mounted) return;
      if (loadError || !data) { setError(loadError?.message ?? 'Your profile could not be loaded.'); setLoading(false); return; }
      const row = data as ProfileRow;
      setOriginal(row); setFullName(row.full_name); setMobile(row.mobile_number ?? ''); setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [userId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !supabase || !original) return;
    setError(''); setSuccess('');
    const cleanedName = fullName.trim().replace(/\s+/g, ' ');
    const cleanedMobile = mobile.trim();
    if (cleanedName.length < 2 || cleanedName.length > 120) { setError('Name must contain 2–120 characters.'); return; }
    if (cleanedMobile && !/^\+[1-9][0-9]{7,14}$/.test(cleanedMobile)) {
      setError('Use international format, for example +254712345678, or leave the mobile number blank.'); return;
    }
    setSaving(true);
    try {
      const client = supabase;
      const { data, error: updateError } = await client.rpc('rttrack_update_patient_profile', {
        p_full_name: cleanedName, p_mobile_number: cleanedMobile || null,
      });
      if (updateError) throw updateError;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result || typeof result.full_name !== 'string') throw new Error('Profile update could not be verified. Please refresh and try again.');
      const saved = result as ProfileRow;
      setOriginal(saved); setFullName(saved.full_name); setMobile(saved.mobile_number ?? '');
      onSaved(saved.full_name); setSuccess('Your profile has been updated.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your profile.');
    } finally { setSaving(false); }
  }

  return <section className="rtp-card rtprofile-card" aria-labelledby="rtprofile-title">
    <div className="rtprofile-head"><div><span className="rtprofile-eyebrow">RTTRACK · ACCOUNT SETTINGS</span><h2 id="rtprofile-title">My profile</h2><p>Only your name and mobile number can be edited here.</p></div><ShieldCheck size={24} aria-hidden="true"/></div>
    {error && <p className="rtprofile-alert rtprofile-error" role="alert">{error}</p>}
    {success && <p className="rtprofile-alert rtprofile-success" role="status">{success}</p>}
    {loading ? <p role="status">Loading your profile…</p> : original && <form onSubmit={save} className="rtprofile-form">
      <label>Full name<input value={fullName} onChange={event => setFullName(event.target.value)} required minLength={2} maxLength={120} autoComplete="name" disabled={saving}/></label>
      <label>Mobile number <span className="rtprofile-optional">(optional)</span><input type="tel" value={mobile} onChange={event => setMobile(event.target.value)} placeholder="+254712345678" autoComplete="tel" inputMode="tel" maxLength={16} disabled={saving}/><small>Use the international format beginning with + and your country code. No SMS will be sent yet.</small></label>
      <div className="rtprofile-divider"><span>Read-only account information</span></div>
      <label>Email address<input type="email" value={email} disabled readOnly/><small>Changing email is not available in this milestone.</small></label>
      <label>Patient ID<input value={userId} disabled readOnly/></label>
      <label>Account type<input value="Patient" disabled readOnly/></label>
      <div className="rtprofile-actions"><button type="button" className="rtprofile-reset" disabled={saving || !original} onClick={() => { setFullName(original.full_name); setMobile(original.mobile_number ?? ''); setError(''); setSuccess(''); }}>Discard changes</button><button type="submit" className="rtprofile-save" disabled={saving || (fullName.trim() === original.full_name && mobile.trim() === (original.mobile_number ?? ''))}>{saving ? 'Saving…' : 'Save changes'}</button></div>
    </form>}
  </section>;
}

export default function PatientPortal({ name, email, userId, onSignOut }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState('Dashboard');
  const [displayName, setDisplayName] = useState(name);
  return <div className="rtp-shell">
    <aside className={`rtp-sidebar ${menuOpen ? 'rtp-sidebar-open' : ''}`}>
      <div className="rtp-logo">RTTRACK</div>
      <div className="rtp-identity"><div className="rtp-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</div><div><strong>{displayName}</strong><small>Patient · Development account</small></div></div>
      <nav aria-label="Patient navigation" className="rtp-nav">
        {links.map(({ label, Icon }) => <button key={label} type="button" className={`rtp-nav-item ${label === active ? 'rtp-active' : ''}`} aria-current={label === active ? 'page' : undefined} onClick={() => { setMenuOpen(false); if (label === 'Connections' || label === 'Dashboard' || label === 'Treatment' || label === 'My Profile' || label === 'Symptoms' || label === 'Reminders' || label === 'Education') {setActive(label); setNotice('');} else setNotice(`${label} will be connected in a later milestone. This feature is not connected yet.`); }}><Icon size={19}/>{label}</button>)}
      </nav>
      <div className="rtp-sidebar-footer"><button type="button" className="rtp-emergency" onClick={() => setNotice('Emergency reporting is NOT connected. If you need urgent help, contact your care team or local emergency services directly.')}>✱ &nbsp; Report Emergency</button><button type="button" className="rtp-signout" onClick={() => void onSignOut()}><LogOut size={17}/>Sign out</button><small>Prototype only · No emergency monitoring</small></div>
    </aside>
    <div className="rtp-main"><header className="rtp-topbar"><button type="button" className="rtp-menu" aria-label="Toggle patient navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X/> : <Menu/>}</button><strong>Patient Portal</strong><div className="rtp-top-actions"><Bell size={19} aria-label="Notifications not configured"/><CircleHelp size={19} aria-label="Help coming soon"/><span>Development account</span></div></header>
      <main className="rtp-content"><div className="rtp-welcome"><div><h1>Jambo, {displayName.split(/\s+/)[0]}</h1><p>Welcome to RTTRACK. Your account is ready.</p></div><span className="rtp-status">Status: Account created</span></div>
        {notice && <div className="rtp-notice" role="status">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={16}/></button></div>}
        {active === 'My Profile' ? <PatientProfile userId={userId} email={email} initialName={displayName} onSaved={setDisplayName}/> : active === 'Connections' ? <ConnectionsPanel role="patient" userId={userId}/> : active === 'Treatment' ? <TreatmentTracker userId={userId}/> : active === 'Symptoms' ? <PatientSymptoms userId={userId}/> : active === 'Reminders' ? <PatientReminders/> : active === 'Education' ? <EducationHub/> : <><TreatmentSummary userId={userId} onViewTreatment={() => { setActive('Treatment'); setNotice(''); }}/>
        <div className="rtp-secondary-grid"><section className="rtp-card rtp-review"><h2><HeartPulse size={22}/> Medical Review</h2><p>No medical review scheduled</p><small>We will not invent appointment dates or clinician details.</small><button type="button" disabled>Add to Calendar</button></section><section className="rtp-card rtp-actions"><h2>Quick Actions</h2><div className="rtp-action-grid">{[{label:'Log Symptom',Icon:HeartPulse},{label:'View Schedule',Icon:CalendarDays},{label:'Ask Zora',Icon:Sprout},{label:'Learn Side Effects',Icon:BookOpen}].map(({label,Icon})=><button type="button" key={label} onClick={()=>{ if (label==='View Schedule' || label==='Log Symptom' || label==='Learn Side Effects') { setActive(label === 'Log Symptom' ? 'Symptoms' : label === 'Learn Side Effects' ? 'Education' : 'Treatment'); setNotice(''); } else { setNotice(`${label} is not connected yet. We will enable it once its clinical safeguards and data workflow are ready.`); } }}><span><Icon size={23}/></span>{label}</button>)}</div></section></div>
        </>}<footer className="rtp-footer"><strong>RTTRACK Kenya</strong><p>Development prototype. Email/SMS delivery, clinical alerts and emergency reporting are not connected. Never enter real patient information yet.</p><small>Signed in as {email}</small></footer>
      </main>
    </div>
  </div>;
}
