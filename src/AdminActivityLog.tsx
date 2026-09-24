import { formatDateTime } from './date-format';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from './supabase';
import './admin-phase2.css';

type Activity = { event_key: string; actor_id: string; actor_label: string; action: string; subject: string; occurred_at: string };
const actions = ['doctor_approved','doctor_rejected','doctor_deactivated','doctor_reapproval_requested','doctor_reactivated','education_created','education_approved','education_archived'];
const label = (value: string) => value.replaceAll('_',' ').replace(/\b\w/g, s=>s.toUpperCase());
export default function AdminActivityLog() {
  const [rows,setRows] = useState<Activity[]>([]);
  const [from,setFrom] = useState('');
  const [to,setTo] = useState('');
  const [action,setAction] = useState('');
  const [actor,setActor] = useState('');
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const refresh = useCallback(async () => {
    if (!supabase) return;
    if (from && to && from>to) { setError('Start date must be on or before end date.'); return; }
    setLoading(true); setError('');
    const {data,error:queryError} = await supabase.rpc('rttrack_admin_activity', {
      p_from:from||null,p_to:to||null,p_action:action||null,p_actor:actor.trim()||null,
    });
    if (queryError) setError(queryError.message);
    else setRows((data??[]) as Activity[]);
    setLoading(false);
  },[from,to,action,actor]);
  useEffect(()=>{void refresh();},[refresh]);
  return <section className="rtp-page"><header className="rtp-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>Activity log</h1><p>Doctor decisions, access changes and Education Hub actions. Maximum 500 matching events.</p></div><button className="outline" type="button" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={16}/> Refresh</button></header>
    <div className="rtp-filters"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><label>Action<select value={action} onChange={e=>setAction(e.target.value)}><option value="">All actions</option>{actions.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label><label>Actor ID<input value={actor} onChange={e=>setActor(e.target.value)} placeholder="Optional UUID"/></label></div>
    {error && <p role="alert" className="rtp-error">{error}</p>}{loading ? <p role="status">Loading activity…</p> : <div className="rtp-table-wrap"><table className="rtp-table"><thead><tr><th>Date and time</th><th>Actor</th><th>Action</th><th>Subject</th></tr></thead><tbody>{rows.map(row=><tr key={row.event_key}><td>{formatDateTime(row.occurred_at)}</td><td>{row.actor_label}<small>{row.actor_id}</small></td><td>{label(row.action)}</td><td>{row.subject}</td></tr>)}</tbody></table>{rows.length===0 && !error && <p className="rtp-empty">No matching administrative activity.</p>}</div>}
  </section>;
}
