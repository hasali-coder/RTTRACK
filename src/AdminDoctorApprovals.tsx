import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { supabase } from './supabase';
import './admin-doctor-approvals.css';

type Doctor = {
  user_id: string; full_name: string; email: string; registration_number: string;
  institution: string; review_note: string | null; status: 'pending' | 'approved' | 'rejected' | 'deactivated' | 'reapproval_requested';
  submitted_at: string; reviewed_at: string | null;
};
type StatusFilter = 'all' | Doctor['status'];
type Props = { initialFilter?: StatusFilter };
const showDate = (s: string | null) => s ? new Date(s).toLocaleDateString() : '—';

export default function AdminDoctorApprovals({ initialFilter = 'all' }: Props) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>(initialFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [attested, setAttested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => setFilter(initialFilter), [initialFilter]);
  const refresh = useCallback(async () => {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const {data, error: queryError} = await supabase.from('clinician_applications')
        .select('user_id,full_name,email,registration_number,institution,status,submitted_at,reviewed_at,review_note')
        .order('submitted_at', {ascending:false});
      if (queryError) throw queryError;
      setDoctors((data ?? []) as Doctor[]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load doctor applications.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const matches = useMemo(() => doctors.filter(d => (filter === 'all' || d.status === filter) &&
    `${d.full_name} ${d.email} ${d.institution} ${d.registration_number}`.toLowerCase().includes(search.trim().toLowerCase())), [doctors, filter, search]);
  const selected = doctors.find(d => d.user_id === selectedId) ?? null;
  function close() { if (!saving) { setSelectedId(null); setNote(''); setAttested(false); } }
  async function changeAccess(action: 'deactivate' | 'reapprove') {
    if (!supabase || !selected || saving || note.trim().length < 15 || !attested) return;
    if (action === 'deactivate' && selected.status !== 'approved') return;
    if (action === 'reapprove' && selected.status !== 'reapproval_requested') return;
    if (!window.confirm(`${action === 'deactivate' ? 'Deactivate' : 'Reapprove'} ${selected.full_name}? This changes server-enforced access.`)) return;
    setSaving(true);setError('');setMessage('');
    try {
      const {error:rpcError} = action === 'deactivate'
        ? await supabase.rpc('rttrack_deactivate_doctor',{p_doctor_id:selected.user_id,p_reason:note.trim()})
        : await supabase.rpc('rttrack_reapprove_doctor',{p_doctor_id:selected.user_id,p_evidence_note:note.trim()});
      if(rpcError)throw rpcError;
      setSelectedId(null);setNote('');setAttested(false);
      await refresh();
      setMessage(action === 'deactivate' ? 'Doctor deactivated. Clinical access is suspended.' : 'Doctor reapproved. Clinical access restored.');
    } catch(caught){setError(caught instanceof Error?caught.message:'Access change failed.');}
    finally{setSaving(false);}
  }
  async function decide(decision: 'approved' | 'rejected') {
    if (!supabase || !selected || selected.status !== 'pending' || !attested || note.trim().length < 15 || saving) return;
    if (!window.confirm(`Confirm ${decision} for ${selected.full_name}?`)) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const {error: reviewError} = await supabase.rpc('rttrack_review_clinician', {
        p_user_id: selected.user_id, p_decision: decision, p_evidence_note: note.trim(),
      });
      if (reviewError) throw reviewError;
      close();
      setSelectedId(null); setNote(''); setAttested(false);
      await refresh();
      setMessage(`Doctor application ${decision}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Review could not be saved.'); }
    finally { setSaving(false); }
  }
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, saving]);
  return <section className="rtda-root" aria-label="Doctor approvals">
    <div className="rtda-head"><div><span className="rtda-eyebrow">ADMINISTRATION · DOCTORS</span><h1>Doctor approvals</h1><p>Review applications and find approved doctors.</p></div>
      <button type="button" className="rtda-outline" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw size={16} aria-hidden="true"/> Refresh</button></div>
    {error && <p className="rtda-alert" role="alert">{error}</p>}{message && <p className="rtda-notice" role="status">{message}</p>}
    <div className="rtda-controls"><label><span>Search doctors</span><div className="rtda-search"><Search size={17} aria-hidden="true"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, email, institution, registration" type="search"/></div></label>
      <label><span>Status</span><select value={filter} onChange={e=>setFilter(e.target.value as StatusFilter)}><option value="all">All</option><option value="pending">Pending review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="deactivated">Deactivated</option><option value="reapproval_requested">Reapproval requested</option></select></label></div>
    <div className="rtda-panel"><div className="rtda-panel-head"><h2>Doctors</h2><span>{loading ? 'Loading…' : `${matches.length} shown`}</span></div>
      {loading ? <p className="rtda-empty" role="status">Loading doctor applications…</p> : matches.length === 0 ? <p className="rtda-empty">No doctors match this search and status.</p> :
        <div className="rtda-list">{matches.map(d => <div className="rtda-row" key={d.user_id}><div className="rtda-person"><strong>{d.full_name}</strong><small>{d.email}</small><small>{d.institution}</small></div>
          <span className={`rtda-pill rtda-${d.status}`}>{d.status}</span><span className="rtda-date">{showDate(d.submitted_at)}</span>
          <button type="button" className="rtda-outline" onClick={()=>{setSelectedId(d.user_id);setNote('');setAttested(false);setMessage('');}}>{d.status === 'pending' ? 'Review' : 'View'}</button></div>)}</div>}
    </div>
    {selected && <div className="rtda-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section className="rtda-modal" role="dialog" aria-modal="true" aria-labelledby="rtda-dialog-title">
      <div className="rtda-modal-head"><div><span className="rtda-eyebrow">DOCTOR PROFILE</span><h2 id="rtda-dialog-title">{selected.full_name}</h2></div><button type="button" aria-label="Close doctor profile" className="rtda-outline" onClick={close} disabled={saving}><X size={18}/></button></div>
      <dl className="rtda-facts"><div><dt>Email</dt><dd>{selected.email}</dd></div><div><dt>Registration (self-reported)</dt><dd>{selected.registration_number}</dd></div><div><dt>Institution (self-reported)</dt><dd>{selected.institution}</dd></div><div><dt>Status</dt><dd>{selected.status}</dd></div><div><dt>Submitted</dt><dd>{showDate(selected.submitted_at)}</dd></div><div><dt>Reviewed</dt><dd>{showDate(selected.reviewed_at)}</dd></div>{selected.review_note && <div><dt>Latest account note</dt><dd>{selected.review_note}</dd></div>}</dl>
      {selected.status === 'pending' ? <form className="rtda-review" onSubmit={(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();void decide('approved');}}>
        <label>Verification evidence / decision reason<textarea value={note} onChange={e=>setNote(e.target.value)} required minLength={15} maxLength={2000} placeholder="Record checks performed or reason for rejection. Do not paste sensitive documents."/></label>
        <label className="rtda-attest"><input type="checkbox" checked={attested} onChange={e=>setAttested(e.target.checked)}/> I independently checked the credentials or documented the rejection reason.</label>
        <div className="rtda-actions"><button type="submit" disabled={saving || !attested || note.trim().length < 15}>Approve doctor</button><button type="button" className="rtda-outline" disabled={saving || !attested || note.trim().length < 15} onClick={()=>void decide('rejected')}>Reject</button><button type="button" className="rtda-outline" onClick={close} disabled={saving}>Cancel</button></div>
      </form> : selected.status === 'approved' || selected.status === 'reapproval_requested' ? <div className="rtda-review"><p className="rtda-notice">{selected.status === 'approved' ? 'Deactivation suspends clinical access without deleting records or ending patient connections.' : 'Review the doctor’s reapproval request and independently confirm eligibility before restoring access.'}</p><label>{selected.status === 'approved' ? 'Reason for deactivation' : 'Evidence for reapproval'}<textarea required minLength={15} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Record the reason and relevant verification (15–2000 characters)."/></label><label className="rtda-attest"><input type="checkbox" checked={attested} onChange={e=>setAttested(e.target.checked)}/> I have reviewed the account status and documented this decision.</label><div className="rtda-actions"><button type="button" disabled={saving || !attested || note.trim().length < 15} onClick={()=>void changeAccess(selected.status === 'approved' ? 'deactivate' : 'reapprove')}>{selected.status === 'approved' ? 'Deactivate doctor' : 'Reapprove doctor'}</button><button type="button" className="rtda-outline" onClick={close} disabled={saving}>Cancel</button></div></div> : <p className="rtda-notice">Status: {selected.status}. {selected.status === 'deactivated' ? 'The doctor may request reapproval from their account.' : 'There are no available approval actions.'}</p>}
    </section></div>}
  </section>;
}
