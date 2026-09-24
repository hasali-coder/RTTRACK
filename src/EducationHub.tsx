import { formatDate, formatDateTime } from './date-format';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, FileText, Languages, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { supabase } from './supabase';
import './education-hub.css';

type Resource = {
  resource_id: string; title: string; category: string; language_code: 'en' | 'sw';
  content: string; source_name: string; source_url: string; approved_at: string;
};
type AdminResource = Resource & {
  status: 'draft' | 'approved' | 'archived'; created_by: string; created_at: string;
  approved_by: string | null; review_note: string | null; archived_at: string | null;
  archive_reason: string | null;
};
const categories = ['Radiotherapy basics', 'Side effects', 'Nutrition', 'Emotional support', 'Caregiver support', 'Glossary'];
const langName = (code: string) => code === 'sw' ? 'Kiswahili' : 'English';
const errorMessage = (value: unknown) => value instanceof Error ? value.message : 'The request could not be completed.';
function trustedLink(url: string): string | null {
  try {
    const link = new URL(url);
    return link.protocol === 'https:' && !!link.hostname && !link.username && !link.password ? link.href : null;
  } catch { return null; }
}

/** Read-only, approved-resource library. Reader replaces the list instead of expanding below it. */
export default function EducationHub() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All topics');
  const [language, setLanguage] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const libraryScroll = useRef(0);
  const openingButton = useRef<HTMLButtonElement | null>(null);
  const readerHeading = useRef<HTMLHeadingElement | null>(null);
  const libraryHeading = useRef<HTMLHeadingElement | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('rttrack_list_education');
      if (rpcError) throw rpcError;
      setResources((data ?? []) as Resource[]);
    } catch (err) { setResources([]); setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const matching = useMemo(() => resources.filter(resource =>
    (category === 'All topics' || resource.category === category) &&
    (language === 'all' || resource.language_code === language) &&
    `${resource.title} ${resource.category} ${resource.content} ${resource.source_name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ), [resources, category, language, query]);
  // Resolve against the latest approved-only response, never a cached copy of article text.
  const selected = resources.find(resource => resource.resource_id === openId) ?? null;

  function openResource(id: string, event: MouseEvent<HTMLButtonElement>) {
    libraryScroll.current = window.scrollY;
    openingButton.current = event.currentTarget;
    setOpenId(id);
    requestAnimationFrame(() => {
      document.getElementById('rte-reader-top')?.scrollIntoView({ behavior: 'auto', block: 'start' });
      readerHeading.current?.focus({ preventScroll: true });
    });
  }
  function backToLibrary() {
    setOpenId(null);
    requestAnimationFrame(() => {
      window.scrollTo({ top: libraryScroll.current, behavior: 'auto' });
      if (openingButton.current?.isConnected) openingButton.current.focus({ preventScroll: true });
      else libraryHeading.current?.focus({ preventScroll: true });
    });
  }

  if (openId !== null) return <section className="rte-root rte-reading" id="rte-reader-top" aria-label="Education resource reader">
    <nav className="rte-reader-nav" aria-label="Education navigation">
      <button type="button" className="rte-secondary" onClick={backToLibrary}><ArrowLeft size={17}/> Back to library</button>
      <span className="rte-reader-context">Education Hub / Resource</span>
    </nav>
    {loading ? <p role="status">Loading approved resource…</p> : error ? <p className="rte-error" role="alert">Unable to load approved education resources: {error}</p> : !selected ? <div className="rte-empty"><h1 ref={readerHeading} tabIndex={-1}>Resource unavailable</h1><p>This resource is no longer available in the approved library.</p><button type="button" className="rte-primary" onClick={backToLibrary}>Return to library</button></div> : <article className="rte-reading-article">
      <div className="rte-reading-meta"><span><BookOpen size={16}/>{selected.category}</span><span><Languages size={16}/>{langName(selected.language_code)}</span></div>
      <h1 ref={readerHeading} tabIndex={-1}>{selected.title}</h1>
      <div className="rte-notice"><ShieldCheck size={19}/><p>Education only, not individual medical advice. For treatment questions, contact your clinical team. For urgent concerns, follow your facility’s emergency instructions.</p></div>
      <div className="rte-reading-body">{selected.content}</div>
      <div className="rte-source"><FileText size={18}/><div><strong>Source: {selected.source_name}</strong><p>Approved for RTTRACK display {formatDate(selected.approved_at)}.</p>{trustedLink(selected.source_url) ? <a href={trustedLink(selected.source_url)!} target="_blank" rel="noopener noreferrer">Open original source <ExternalLink size={15}/></a> : <span>Source link unavailable.</span>}</div></div>
      <div className="rte-reading-bottom"><button type="button" className="rte-secondary" onClick={backToLibrary}><ArrowLeft size={17}/> Back to library</button></div>
    </article>}
    <p className="rte-footnote">Prototype · Fictional accounts only. External source websites are independent of RTTRACK. No automatic diagnosis, dose adjustment or emergency monitoring is provided.</p>
  </section>;

  return <section className="rte-root rte-library" aria-label="Education Hub">
    <header className="rte-heading"><div><span className="rte-eyebrow">RTTRACK · EDUCATION</span><h1 ref={libraryHeading} tabIndex={-1}>Education Hub</h1><p>Select a title to read an approved resource on its own screen.</p></div><button className="rte-secondary" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={17}/> Refresh</button></header>
    <div className="rte-notice"><ShieldCheck size={19}/><p>Education only, not individual medical advice. If you have questions about your treatment, contact your clinical team. For urgent concerns, follow your facility’s emergency instructions.</p></div>
    <div className="rte-toolbar">
      <label className="rte-search"><Search size={17}/><span className="rte-sr">Search resources</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search approved resources…"/></label>
      <label>Topic<select value={category} onChange={event => setCategory(event.target.value)}><option>All topics</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Language<select value={language} onChange={event => setLanguage(event.target.value)}><option value="all">All languages</option><option value="en">English</option><option value="sw">Kiswahili</option></select></label>
    </div>
    {error && <p className="rte-error" role="alert">Unable to load approved education resources: {error}</p>}
    {loading ? <p role="status">Loading education resources…</p> : !error && matching.length === 0 ? <div className="rte-empty"><BookOpen size={27}/><h2>No approved resources found</h2><p>{resources.length === 0 ? 'No learning materials have passed RTTRACK’s review process yet. This is not a loading error.' : 'Try a different search, topic or language.'}</p></div> : null}
    {!loading && !error && matching.length > 0 && <>
      <p className="rte-count" role="status">{matching.length} reviewed {matching.length === 1 ? 'resource' : 'resources'}</p>
      <div className="rte-table-wrap" role="region" aria-label="Education resources" tabIndex={0}><table className="rte-resource-table">
        <thead><tr><th scope="col">Topic</th><th scope="col">Category</th><th scope="col">Language</th><th scope="col">Source</th><th scope="col">Action</th></tr></thead>
        <tbody>{matching.map(resource => <tr key={resource.resource_id}>
          <td data-label="Topic"><button type="button" className="rte-table-title" onClick={event => openResource(resource.resource_id,event)}>{resource.title}</button></td>
          <td data-label="Category">{resource.category}</td>
          <td data-label="Language">{langName(resource.language_code)}</td>
          <td data-label="Source">{resource.source_name}</td>
          <td data-label="Action"><button type="button" className="rte-secondary rte-read-button" onClick={event => openResource(resource.resource_id,event)}>Read <ArrowRight size={15}/></button></td>
        </tr>)}</tbody>
      </table></div>
    </>}
    <p className="rte-footnote">Prototype · Fictional accounts only. External source websites are independent of RTTRACK. No automatic diagnosis, dose adjustment or emergency monitoring is provided.</p>
  </section>;
}


/** Administrator review queue; only server-side RPCs can create/approve/archive records. */
export function EducationManager() {
  const [items, setItems] = useState<AdminResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uid, setUid] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [language, setLanguage] = useState<'en' | 'sw'>('en');
  const [content, setContent] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [attested, setAttested] = useState(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState('');

  const refresh = useCallback(async () => {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [identity, result] = await Promise.all([supabase.auth.getUser(), supabase.rpc('rttrack_list_education_admin')]);
      if (identity.error) throw identity.error;
      if (result.error) throw result.error;
      setUid(identity.data.user?.id ?? null);
      setItems((result.data ?? []) as AdminResource[]);
    } catch (err) { setItems([]); setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function createDraft(event: FormEvent) {
    event.preventDefault(); if (!supabase || busy) return;
    if (!trustedLink(sourceUrl)) { setError('Enter a valid HTTPS source URL without a username or password.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const { error: rpcError } = await supabase.rpc('rttrack_create_education_draft', { p_title: title, p_category: category, p_language_code: language, p_content: content, p_source_name: sourceName, p_source_url: sourceUrl });
      if (rpcError) throw rpcError;
      setTitle(''); setContent(''); setSourceName(''); setSourceUrl(''); setMessage('Draft saved. Another administrator must review and approve it.');
      await refresh();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function approve(id: string) {
    if (!supabase || busy || !attested || reviewNote.trim().length < 20) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { error: rpcError } = await supabase.rpc('rttrack_approve_education', { p_resource_id: id, p_review_note: reviewNote.trim() });
      if (rpcError) throw rpcError;
      setReviewId(null); setAttested(false); setReviewNote(''); setMessage('Resource approved and now visible to eligible RTTRACK users.');
      await refresh();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function archive(id: string) {
    if (!supabase || busy || archiveReason.trim().length < 15) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { error: rpcError } = await supabase.rpc('rttrack_archive_education', { p_resource_id: id, p_reason: archiveReason.trim() });
      if (rpcError) throw rpcError;
      setArchiveId(null); setArchiveReason(''); setMessage('Resource archived; the historical record is preserved.');
      await refresh();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <section className="rte-root rte-admin" aria-label="Education publishing management">
    <header className="rte-heading"><div><span className="rte-eyebrow">ADMINISTRATION · CONTENT REVIEW</span><h2>Education publishing</h2><p>Drafts are private. A different confirmed administrator must review each source and its language before publication.</p></div><button type="button" className="rte-secondary" onClick={() => void refresh()} disabled={loading || busy}><RefreshCw size={17}/> Refresh</button></header>
    <div className="rte-notice"><ShieldCheck size={19}/><p>Do not enter unverified clinical advice or real patient information. A translation must be reviewed independently; selecting Kiswahili does not translate text automatically.</p></div>
    {error && <p className="rte-error" role="alert">{error}</p>}{message && <p className="rte-success" role="status">{message}</p>}
    <form className="rte-editor" onSubmit={event => void createDraft(event)}><h3>Create an education draft</h3>
      <div className="rte-form-grid"><label>Resource title<input required minLength={4} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="Title from reviewed material" disabled={busy}/></label>
        <label>Topic<select value={category} onChange={e => setCategory(e.target.value)} disabled={busy}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Language<select value={language} onChange={e => setLanguage(e.target.value as 'en'|'sw')} disabled={busy}><option value="en">English</option><option value="sw">Kiswahili — reviewed text only</option></select></label>
        <label>Source / issuing organisation<input required minLength={4} maxLength={200} value={sourceName} onChange={e => setSourceName(e.target.value)} placeholder="Organisation and publication" disabled={busy}/></label>
        <label className="rte-wide">Original source HTTPS URL<input type="url" required maxLength={1000} value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://…" disabled={busy}/></label>
        <label className="rte-wide">Reviewed resource text<textarea required minLength={40} maxLength={12000} rows={6} value={content} onChange={e => setContent(e.target.value)} placeholder="Paste only source-verified text approved for review. Plain text only." disabled={busy}/></label>
      </div><button type="submit" className="rte-primary" disabled={busy}>{busy ? 'Saving…' : 'Save private draft'}</button>
    </form>
    <h3>Resource review queue</h3>
    {loading ? <p role="status">Loading resource queue…</p> : items.length === 0 ? <p className="rte-empty">No resources have been submitted yet.</p> :
      <div className="rte-admin-list">{items.map(item => <article className="rte-admin-item" key={item.resource_id}>
        <div className="rte-card-top"><span className="rte-category">{item.category} · {langName(item.language_code)}</span><span className={`rte-status rte-status-${item.status}`}>{item.status}</span></div>
        <h4>{item.title}</h4><p className="rte-body">{item.content}</p><p className="rte-source-inline">Source: {item.source_name} · {trustedLink(item.source_url) ? <a href={trustedLink(item.source_url)!} target="_blank" rel="noopener noreferrer">Open original source <ExternalLink size={13}/></a> : 'Invalid source URL'}</p>
        <small>Submitted {formatDateTime(item.created_at)} · {item.created_by === uid ? 'Created by you' : 'Created by another administrator'}</small>
        {item.review_note && <p className="rte-review-note">Approval note: {item.review_note}</p>}
        {item.archive_reason && <p className="rte-review-note">Archive reason: {item.archive_reason}</p>}
        {item.status === 'draft' && item.created_by !== uid && <div className="rte-action-area">
          {reviewId !== item.resource_id ? <button type="button" className="rte-secondary" onClick={() => {setReviewId(item.resource_id); setReviewNote(''); setAttested(false); setArchiveId(null);}}>Review for publication</button> :
          <div className="rte-review-form"><label>Clinical, source and translation review note<textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} minLength={20} maxLength={2000} rows={3} placeholder="Record what you checked (minimum 20 characters)." disabled={busy}/></label>
            <label className="rte-attest"><input type="checkbox" checked={attested} onChange={e=>setAttested(e.target.checked)} disabled={busy}/> I have independently checked the source, clinical suitability and language accuracy for this resource.</label>
            <div className="rte-buttons"><button type="button" className="rte-primary" disabled={busy || !attested || reviewNote.trim().length < 20} onClick={() => void approve(item.resource_id)}>{busy ? 'Publishing…' : 'Approve and publish'}</button><button type="button" className="rte-secondary" disabled={busy} onClick={()=>setReviewId(null)}>Cancel</button></div>
          </div>}</div>}
        {item.status === 'draft' && item.created_by === uid && <p className="rte-help">Waiting for another administrator. You cannot approve your own draft.</p>}
        {item.status === 'approved' && <div className="rte-action-area">{archiveId !== item.resource_id ? <button type="button" className="rte-secondary" onClick={()=>{setArchiveId(item.resource_id);setArchiveReason('');setReviewId(null);}}>Archive published resource</button> : <div className="rte-review-form"><label>Reason for withdrawal<textarea value={archiveReason} onChange={e=>setArchiveReason(e.target.value)} minLength={15} maxLength={2000} rows={2} disabled={busy}/></label><div className="rte-buttons"><button type="button" className="rte-primary" disabled={busy || archiveReason.trim().length < 15} onClick={()=>void archive(item.resource_id)}>Confirm archive</button><button type="button" className="rte-secondary" disabled={busy} onClick={()=>setArchiveId(null)}>Cancel</button></div></div>}</div>}
      </article>)}</div>}
    <p className="rte-footnote">M06A: plain-text learning resources and source links only. No document upload, media hosting, automatic translation or AI recommendations.</p>
  </section>;
}
