import { formatDateTime } from './date-format';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from './supabase';
import './admin-doctor-approvals.css';
type Review = { id:number; application_user_id:string; decision:string; decided_at:string; evidence_note:string };
export default function AdminReviewHistory() {
  const [rows,setRows] = useState<Review[]>([]);
  const [search,setSearch] = useState('');
  const [decision,setDecision] = useState('all');
  const [from,setFrom] = useState('');
  const [to,setTo] = useState('');
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const refresh = useCallback(async () => {
    if (!supabase) {setError('Supabase is not configured.');setLoading(false);return;}
    setLoading(true);setError('');
    try {
      const {data,error:queryError}=await supabase.from('rttrack_application_reviews')
        .select('id,application_user_id,decision,decided_at,evidence_note').order('decided_at',{ascending:false}).limit(100);
      if(queryError) throw queryError;
      setRows((data??[]) as Review[]);
    } catch(caught){setError(caught instanceof Error?caught.message:'Unable to load review history.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  const filtered=useMemo(()=>rows.filter(r=>(decision==='all'||r.decision===decision)&&
    `${r.application_user_id} ${r.evidence_note}`.toLowerCase().includes(search.toLowerCase())&&
    (!from||r.decided_at.slice(0,10)>=from)&&(!to||r.decided_at.slice(0,10)<=to)),[rows,decision,search,from,to]);
  return <section className="rtda-root"><div className="rtda-head"><div><span className="rtda-eyebrow">ADMINISTRATION · REVIEWS</span><h1>Doctor review history</h1><p>Recorded doctor-application decisions only; this is not a system-wide audit log.</p></div><button className="rtda-outline" type="button" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={16}/> Refresh</button></div>
    {error&&<p className="rtda-alert" role="alert">{error}</p>}
    <div className="rtda-controls rtda-history-controls"><label><span>Search ID or note</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search reviews" type="search"/></label>
    <label><span>Decision</span><select value={decision} onChange={e=>setDecision(e.target.value)}><option value="all">All</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
    <label><span>From</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label><span>To</span><input type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)}/></label></div>
    <div className="rtda-panel"><div className="rtda-panel-head"><h2>Review decisions</h2><span>{filtered.length} shown</span></div>{loading?<p className="rtda-empty">Loading…</p>:filtered.length===0?<p className="rtda-empty">No recorded reviews match these filters. Historical manual SQL approvals may not appear.</p>:<div className="rtda-history-table"><table><thead><tr><th>Date</th><th>Doctor ID</th><th>Decision</th><th>Evidence note</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id}><td>{formatDateTime(r.decided_at)}</td><td>{r.application_user_id}</td><td>{r.decision}</td><td>{r.evidence_note}</td></tr>)}</tbody></table></div>}
    {rows.length>=100&&<p className="rtda-empty">The latest 100 review records were retrieved; this is not a complete history.</p>}</div>
  </section>;
}
