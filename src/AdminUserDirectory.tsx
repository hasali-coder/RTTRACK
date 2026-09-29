import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Download, FileText, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { addRttrackLogoToPdf } from './branding';
import { formatDate, formatDateTime } from './date-format';
import { supabase } from './supabase';
import './admin-user-directory.css';

type UserRole = 'all' | 'doctor' | 'patient' | 'administrator';
type UserStatus = 'all' | 'active' | 'not_activated' | 'pending' | 'approved' | 'rejected' | 'deactivated' | 'reapproval_requested';
type DirectoryUser = {
  user_id: string;
  full_name: string;
  email: string;
  user_role: Exclude<UserRole, 'all'>;
  account_status: Exclude<UserStatus, 'all'>;
  created_at: string;
  email_confirmed_at: string | null;
  registration_number: string | null;
  institution: string | null;
  total_count: number;
};
type DirectoryCounts = { total: number; doctors: number; patients: number; administrators: number; not_activated: number };
type InvitationEvent = { event_id: string; actor_email: string; target_email: string; user_role: string; event_type: string; occurred_at: string };
type InvitationRole = 'patient' | 'doctor';
const PAGE_SIZE = 50;
const MAX_EXPORT = 5000;
const emptyCounts: DirectoryCounts = { total: 0, doctors: 0, patients: 0, administrators: 0, not_activated: 0 };
const statusLabel = (value: string) => value === 'not_activated' ? 'Not activated' : value.replaceAll('_', ' ');

// Keep spreadsheet software from interpreting downloaded names/emails as formulas.
function csvField(value: string | number | null | undefined) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const blob = new Blob(['\uFEFF', rows.map(row => row.map(csvField).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export default function AdminUserDirectory() {
  const [role, setRole] = useState<UserRole>('all');
  const [status, setStatus] = useState<UserStatus>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rows, setRows] = useState<DirectoryUser[]>([]);
  const [counts, setCounts] = useState<DirectoryCounts>(emptyCounts);
  const [activity, setActivity] = useState<InvitationEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<DirectoryUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<InvitationRole>('patient');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteInstitution, setInviteInstitution] = useState('');
  const [inviteRegistration, setInviteRegistration] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  useEffect(() => { setPage(0); }, [role, status, search]);

  useEffect(() => {
    let mounted = true;
    const timeout = window.setTimeout(async () => {
      const client = supabase;
      if (!client) {
        if (mounted) { setError('RTTRACK is not connected to Supabase.'); setLoading(false); }
        return;
      }
      setLoading(true);
      setError('');
      const [directoryResult, countsResult, activityResult] = await Promise.all([
        client.rpc('rttrack_admin_user_directory', {
          p_role: role, p_status: status, p_search: search.trim(), p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
        }),
        client.rpc('rttrack_admin_directory_counts'),
        client.rpc('rttrack_admin_invitation_activity', { p_limit: 100 }),
      ]);
      if (!mounted) return;
      if (directoryResult.error || countsResult.error || activityResult.error) {
        setError(directoryResult.error?.message || countsResult.error?.message || activityResult.error?.message || 'User Directory unavailable. Confirm migration 017 has been applied.');
        setRows([]);
        setTotal(0);
      } else {
        const next = (directoryResult.data ?? []) as DirectoryUser[];
        setRows(next);
        setTotal(next[0] ? Number(next[0].total_count) : 0);
        setCounts(((countsResult.data ?? []) as DirectoryCounts[])[0] ?? emptyCounts);
        setActivity((activityResult.data ?? []) as InvitationEvent[]);
      }
      setLoading(false);
    }, 230);
    return () => { mounted = false; window.clearTimeout(timeout); };
  }, [role, status, search, page, refreshKey]);

  async function fetchFilteredExport(): Promise<DirectoryUser[]> {
    if (!supabase) throw new Error('Supabase is not connected.');
    const client = supabase;
    const all: DirectoryUser[] = [];
    let offset = 0;
    for (;;) {
      const { data, error: rpcError } = await client.rpc('rttrack_admin_user_directory', {
        p_role: role, p_status: status, p_search: search.trim(), p_limit: 100, p_offset: offset,
      });
      if (rpcError) throw rpcError;
      const batch = (data ?? []) as DirectoryUser[];
      if (!batch.length) break;
      if (offset === 0 && Number(batch[0].total_count) > MAX_EXPORT) {
        throw new Error(`The export contains more than ${MAX_EXPORT} users. Narrow your filters before exporting.`);
      }
      all.push(...batch);
      offset += batch.length;
      if (batch.length < 100) break;
    }
    return all;
  }

  async function exportDirectory(kind: 'csv' | 'pdf') {
    if (loading || exporting || error) return;
    setExporting(true);
    setError('');
    try {
      const users = await fetchFilteredExport();
      const filename = `rttrack-user-directory-${role}-${status}`;
      if (kind === 'csv') {
        downloadCsv(`${filename}.csv`, [
          ['Name', 'Role', 'Email', 'Status', 'Created', 'Email verified', 'Institution', 'Professional registration'],
          ...users.map(user => [user.full_name, user.user_role, user.email, statusLabel(user.account_status), formatDate(user.created_at),
            user.email_confirmed_at ? formatDate(user.email_confirmed_at) : '', user.institution, user.registration_number]),
        ]);
      } else {
        const pdf = new jsPDF({ orientation: 'landscape' });
        await addRttrackLogoToPdf(pdf, 14, 10, 46);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
        pdf.text('Administrator User Directory', 14, 35);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
        pdf.text(`Filters: ${role} | ${status} | ${search.trim() || 'no search'}     Generated: ${formatDateTime(new Date().toISOString())}`, 14, 42);
        pdf.text(`${users.length} records. Administrative use only. No clinical records included.`, 14, 48);
        autoTable(pdf, {
          head: [['Name', 'Role', 'Email', 'Status', 'Created', 'Institution']],
          body: users.map(user => [user.full_name, user.user_role, user.email, statusLabel(user.account_status), formatDate(user.created_at), user.institution ?? '']),
          startY: 54, styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
          headStyles: { fillColor: [11,18,92] },
          didDrawPage: data => { pdf.setFontSize(8); pdf.text(`RTTRACK | Restricted administrative report  ·  Page ${data.pageNumber}`, 14, pdf.internal.pageSize.height - 8); },
        });
        pdf.save(`${filename}.pdf`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Export failed.');
    } finally { setExporting(false); }
  }

  function exportActivity() {
    downloadCsv('rttrack-account-invitation-activity.csv', [
      ['Date/time', 'Administrator', 'Account', 'Role', 'Activity'],
      ...activity.map(item => [formatDateTime(item.occurred_at), item.actor_email, item.target_email, item.user_role, item.event_type]),
    ]);
  }

  async function sendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || inviteBusy) return;
    setInviteBusy(true);
    setInviteError('');
    setNotice('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('rttrack-admin-invite', {
        body: { role: inviteRole, full_name: inviteName.trim(), email: inviteEmail.trim(),
          ...(inviteRole === 'doctor' ? { institution: inviteInstitution.trim(), registration_number: inviteRegistration.trim() } : {}) },
      });
      if (invokeError) {
        const response = (invokeError as { context?: Response }).context;
        const detail = response ? await response.clone().json().catch(() => null) as { error?: string } | null : null;
        throw new Error(detail?.error || invokeError.message);
      }
      if (data?.success !== true) throw new Error('The invitation could not be confirmed.');
      setNotice(`Activation invitation sent to ${inviteEmail.trim()}.`);
      setInviteOpen(false);
      setInviteName(''); setInviteEmail(''); setInviteInstitution(''); setInviteRegistration('');
      refresh();
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : 'Unable to invite the user.');
    } finally { setInviteBusy(false); }
  }

  const lastPage = page > 0 && rows.length === 0;
  return <section className="rtum-root" aria-label="Administrator User Management">
    <header className="rtum-heading"><div><span className="eyebrow">ADMINISTRATION · USER MANAGEMENT</span><h1>User Management</h1><p>Search and manage patient and doctor accounts. Only administrators can access this directory.</p></div>
      <div className="rtum-actions">
        <button type="button" className="rtum-outline" disabled={loading} onClick={refresh}><RefreshCw size={16}/> Refresh</button>
        <button type="button" className="rtum-primary" onClick={() => { setInviteError(''); setInviteOpen(true); }}><UserPlus size={16}/> Add user</button>
      </div>
    </header>
    {notice && <div role="status" className="rtum-success">{notice}</div>}
    {error && <div role="alert" className="rtum-error">{error}</div>}
    <div className="rtum-counts">
      <article><span>All accounts</span><strong>{counts.total}</strong></article>
      <article><span>Patients</span><strong>{counts.patients}</strong></article>
      <article><span>Doctors</span><strong>{counts.doctors}</strong></article>
      <article><span>Not activated</span><strong>{counts.not_activated}</strong></article>
    </div>
    <section className="rtum-card">
      <div className="rtum-tabs" role="group" aria-label="Account type filter">
        {(['all','patient','doctor','administrator'] as const).map(value =>
          <button key={value} type="button" aria-pressed={role === value} onClick={() => setRole(value)}>{value === 'all' ? 'All users' : value === 'doctor' ? 'Doctors' : value === 'patient' ? 'Patients' : 'Administrators'}</button>
        )}
      </div>
      <div className="rtum-filters">
        <label>Search accounts<div className="rtum-search"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} type="search" placeholder="Name, email, institution or registration" maxLength={120}/></div></label>
        <label>Status<select value={status} onChange={e => setStatus(e.target.value as UserStatus)}>
          {(['all','active','not_activated','pending','approved','rejected','deactivated','reapproval_requested'] as const).map(value =>
            <option key={value} value={value}>{value === 'all' ? 'All statuses' : statusLabel(value)}</option>
          )}
        </select></label>
      </div>
      <div className="rtum-section-bar"><strong>Account directory</strong>
        <div><span>{loading ? 'Loading…' : `${total} matching`}</span>
          <button type="button" disabled={loading || exporting || !!error} onClick={() => void exportDirectory('csv')} className="rtum-outline"><Download size={15}/> CSV</button>
          <button type="button" disabled={loading || exporting || !!error} onClick={() => void exportDirectory('pdf')} className="rtum-outline"><FileText size={15}/> PDF</button></div>
      </div>
      <div className="rtum-table-scroll"><table className="rtum-table"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Status</th><th>Registered</th><th>Action</th></tr></thead><tbody>
        {rows.map(user => <tr key={user.user_id}><td><strong>{user.full_name}</strong></td><td>{user.user_role}</td><td>{user.email}</td><td><span className={`rtum-pill rtum-${user.account_status}`}>{statusLabel(user.account_status)}</span></td><td>{formatDate(user.created_at)}</td><td><button type="button" className="rtum-outline" onClick={() => setSelected(user)}>View</button></td></tr>)}
      </tbody></table>
        {!loading && rows.length === 0 && <p className="rtum-empty">{lastPage ? 'No more matching accounts.' : 'No matching accounts.'}</p>}
        {loading && <p role="status" className="rtum-empty">Loading directory…</p>}
      </div>
      <div className="rtum-pagination"><span>Page {page + 1} · {total} matching accounts</span>
        <div><button type="button" className="rtum-outline" disabled={loading || page === 0} onClick={() => setPage(x => x - 1)}>Previous</button>
          <button type="button" className="rtum-outline" disabled={loading || (page + 1) * PAGE_SIZE >= total} onClick={() => setPage(x => x + 1)}>Next</button></div>
      </div>
    </section>
    <section className="rtum-card"><div className="rtum-section-bar"><div><strong>Account invitation activity</strong><small>Invitations and completed activations.</small></div><button type="button" className="rtum-outline" onClick={exportActivity} disabled={!activity.length}><Download size={15}/> Export activity CSV</button></div>
      <div className="rtum-table-scroll"><table className="rtum-table"><thead><tr><th>Date</th><th>Administrator</th><th>Account</th><th>Type</th><th>Activity</th></tr></thead><tbody>
        {activity.map((item, index) => <tr key={`${item.event_id}-${item.event_type}-${index}`}><td>{formatDateTime(item.occurred_at)}</td><td>{item.actor_email}</td><td>{item.target_email}</td><td>{item.user_role}</td><td>{item.event_type}</td></tr>)}
      </tbody></table>{!activity.length && <p className="rtum-empty">No account invitations recorded.</p>}</div>
    </section>

    {selected && <div className="rtum-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="rtum-dialog" role="dialog" aria-modal="true" aria-labelledby="rtum-user-title">
      <div className="rtum-modal-heading"><h2 id="rtum-user-title">{selected.full_name}</h2><button type="button" aria-label="Close account details" onClick={() => setSelected(null)} className="rtum-outline"><X size={17}/></button></div>
      <dl className="rtum-facts"><div><dt>Account role</dt><dd>{selected.user_role}</dd></div><div><dt>Status</dt><dd>{statusLabel(selected.account_status)}</dd></div><div><dt>Email</dt><dd>{selected.email}</dd></div><div><dt>Account ID</dt><dd>{selected.user_id}</dd></div><div><dt>Registered</dt><dd>{formatDate(selected.created_at)}</dd></div><div><dt>Email confirmed</dt><dd>{selected.email_confirmed_at ? formatDateTime(selected.email_confirmed_at) : 'Not yet'}</dd></div>
        {selected.registration_number && <div><dt>Professional registration</dt><dd>{selected.registration_number}</dd></div>}
        {selected.institution && <div><dt>Institution</dt><dd>{selected.institution}</dd></div>}
      </dl><p className="rtum-help">Professional approval and clinical access remain controlled by Doctor Approvals. This directory never overrides patient consent.</p>
    </section></div>}

    {inviteOpen && <div className="rtum-overlay" role="presentation"><section className="rtum-dialog" role="dialog" aria-modal="true" aria-labelledby="rtum-invite-title">
      <div className="rtum-modal-heading"><h2 id="rtum-invite-title">Invite a new user</h2><button type="button" className="rtum-outline" aria-label="Close invitation" disabled={inviteBusy} onClick={() => setInviteOpen(false)}><X size={17}/></button></div>
      <p className="rtum-help">RTTRACK sends a secure activation link. The recipient confirms their email and chooses their own password. A newly invited doctor still requires professional approval.</p>
      {inviteError && <p role="alert" className="rtum-error">{inviteError}</p>}
      <form onSubmit={e => void sendInvitation(e)} className="rtum-invite-form">
        <label>Account type<select value={inviteRole} onChange={e => setInviteRole(e.target.value as InvitationRole)}><option value="patient">Patient</option><option value="doctor">Doctor</option></select></label>
        <label>Full name<input required value={inviteName} minLength={2} maxLength={120} onChange={e => setInviteName(e.target.value)} autoComplete="off"/></label>
        <label>Email address<input required type="email" value={inviteEmail} maxLength={254} onChange={e => setInviteEmail(e.target.value)} autoComplete="off"/></label>
        {inviteRole === 'doctor' && <><label>Professional registration<input required value={inviteRegistration} maxLength={80} onChange={e => setInviteRegistration(e.target.value)}/></label>
          <label>Institution<input required value={inviteInstitution} maxLength={160} onChange={e => setInviteInstitution(e.target.value)}/></label></>}
        <div className="rtum-form-actions"><button type="button" disabled={inviteBusy} className="rtum-outline" onClick={() => setInviteOpen(false)}>Cancel</button><button type="submit" className="rtum-primary" disabled={inviteBusy}><UserPlus size={16}/>{inviteBusy ? 'Sending…' : 'Create and invite'}</button></div>
      </form>
    </section></div>}
  </section>;
}
