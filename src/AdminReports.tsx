import { formatDate } from './date-format';
import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { supabase } from './supabase';
import './admin-phase2.css';
type Metric = { metric:string; value:number;kind:'snapshot'|'period' };
type Trend = { day:string;doctor_reviews:number;education_actions:number;access_actions:number };
const iso = (d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const daysAgo = (days:number)=>{const d=new Date();d.setDate(d.getDate()-days);return iso(d);};
const csvCell=(value:string|number)=>`"${String(value).replaceAll('"','""')}"`;
export default function AdminReports(){
  const [from,setFrom]=useState(()=>daysAgo(29));
  const [to,setTo]=useState(()=>daysAgo(0));
  const [metrics,setMetrics]=useState<Metric[]>([]);
  const [trends,setTrends]=useState<Trend[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const refresh=useCallback(async()=>{
    if(!supabase)return;
    if(!from||!to||from>to){setError('Choose a valid date range.');return;}
    setLoading(true);setError('');
    const [m,t]=await Promise.all([
      supabase.rpc('rttrack_admin_report_metrics',{p_from:from,p_to:to}),
      supabase.rpc('rttrack_admin_report_trends',{p_from:from,p_to:to}),
    ]);
    if(m.error||t.error){setError(m.error?.message||t.error?.message||'Unable to load reports.');setMetrics([]);setTrends([]);}
    else{setMetrics((m.data??[]) as Metric[]);setTrends((t.data??[]) as Trend[]);}
    setLoading(false);
  },[from,to]);
  useEffect(()=>{void refresh();},[refresh]);
  function exportCsv(){
    if(!metrics.length||loading||error)return;
    const lines=[['Report type','Metric or date','Value','Doctor reviews','Education actions','Doctor access actions'].map(csvCell).join(',')];
    metrics.forEach(m=>lines.push([m.kind,m.metric,m.value,'','',''].map(csvCell).join(',')));
    trends.forEach(t=>lines.push(['Daily trend',formatDate(t.day),'',t.doctor_reviews,t.education_actions,t.access_actions].map(csvCell).join(',')));
    const blob=new Blob(['\uFEFF',lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`rttrack-admin-report-${from}-to-${to}.csv`;a.click();URL.revokeObjectURL(url);
  }
  const max=Math.max(1,...trends.map(t=>Number(t.doctor_reviews)+Number(t.education_actions)+Number(t.access_actions)));
  return <section className="rtp-page"><header className="rtp-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>Reports</h1><p>Administrative workload and doctor/education counts. No patient-level data is exported.</p></div><div className="rtp-toolbar"><button type="button" className="outline" disabled={loading} onClick={()=>void refresh()}><RefreshCw size={16}/> Refresh</button><button type="button" className="primary" disabled={loading||!!error||!metrics.length} onClick={exportCsv}><Download size={16}/> Export CSV</button></div></header>
    <div className="rtp-filters"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
    {error&&<p className="rtp-error" role="alert">{error}</p>}{loading&&<p role="status">Loading report…</p>}
    {!loading&&!error&&<><h2>Key figures</h2><div className="rtp-metrics">{metrics.map(m=><article className="rtp-metric" key={m.metric}><small>{m.kind==='snapshot'?'Current snapshot':'Selected period'}</small><strong>{m.value}</strong><span>{m.metric}</span></article>)}</div>
    <section className="rtp-trends"><h2>Daily administrative activity</h2><p>Doctor reviews, education actions and access changes by day.</p><div className="rtp-chart" role="img" aria-label="Daily administrative event totals">{trends.map(t=><div className="rtp-bar-item" key={t.day} title={`${formatDate(t.day)}: ${Number(t.doctor_reviews)+Number(t.education_actions)+Number(t.access_actions)} actions`}><div className="rtp-bar" style={{height:`${Math.max(2,(Number(t.doctor_reviews)+Number(t.education_actions)+Number(t.access_actions))/max*100)}%`}}/><span>{formatDate(t.day)}</span></div>)}</div></section>
    <div className="rtp-table-wrap"><table className="rtp-table"><thead><tr><th>Date</th><th>Doctor reviews</th><th>Education actions</th><th>Access changes</th></tr></thead><tbody>{trends.map(t=><tr key={t.day}><td>{formatDate(t.day)}</td><td>{t.doctor_reviews}</td><td>{t.education_actions}</td><td>{t.access_actions}</td></tr>)}</tbody></table></div></>}
  </section>;
}
