import { useCallback, useEffect, useState } from 'react';
import { Clock3, RefreshCw, ShieldCheck, Users, UserX, X } from 'lucide-react';
import { supabase } from './supabase';
import './admin-portal.css';

type Clinician = {
  user_id: string;
  full_name: string;
  email: string;
  registration_number: string;
  institution: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_at: string | null;
};
type Review = {
  id: number;
  application_user_id: string;
  decision: string;
  decided_at: string;
  evidence_note: string;
};

const date = (value: string) => new Date(value).toLocaleDateString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
});

export default function AdminPortal() {
  const [applications, setApplications] = useState<Clinician[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selected, setSelected] = useState('');
  const [note, setNote] = useState('');
  const [attested, setAttested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [applicationResult, reviewResult] = await Promise.all([
        supabase.from('clinician_applications')
          .select('user_id,full_name,email,registration_number,institution,status,submitted_at,reviewed_at')
          .order('submitted_at', { ascending: false }),
        supabase.from('rttrack_application_reviews')
          .select('id,application_user_id,decision,decided_at,evidence_note')
          .order('decided_at', { ascending: false }).limit(30),
      ]);
      if (applicationResult.error || reviewResult.error) {
        setError('Could not load applications or review history. Check migration 002 and administrator access.');
        return;
      }
      setApplications((applicationResult.data ?? []) as Clinician[]);
      setReviews((reviewResult.data ?? []) as Review[]);
    } catch {
      setError('Could not connect to Supabase. Check your network and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const application = applications.find((item) => item.user_id === selected);
  const pending = applications.filter((item) => item.status === 'pending').length;
  const approved = applications.filter((item) => item.status === 'approved').length;
  const rejected = applications.filter((item) => item.status === 'rejected').length;

  function viewApplication(userId: string) {
    setSelected(userId);
    setNote('');
    setAttested(false);
    setMessage('');
  }

  async function decide(decision: 'approved' | 'rejected') {
    if (!supabase || !application || application.status !== 'pending' || !attested ||
        note.trim().length < 15 || submitting) return;
    if (!window.confirm(`Confirm ${decision} for ${application.full_name}? This records an administrative decision.`)) return;

    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const { error: rpcError } = await supabase.rpc('rttrack_review_clinician', {
        p_user_id: application.user_id,
        p_decision: decision,
        p_evidence_note: note.trim(),
      });
      if (rpcError) {
        setError(rpcError.message);
      } else {
        setSelected('');
        setNote('');
        setAttested(false);
        await refresh();
        setMessage(`Application ${decision}. Review recorded.`);
      }
    } catch {
      setError('The review could not be completed. Check your connection and refresh before trying again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="admin-page">
    <div className="admin-intro">
      <div>
        <span className="eyebrow">RTTRACK · ADMINISTRATION CENTRE</span>
        <h1>Clinician verification</h1>
        <p className="muted">Review applications and document independent credential checks. Email confirmation alone is not professional verification.</p>
      </div>
      <button type="button" className="outline admin-refresh" disabled={loading || submitting}
        onClick={() => { void refresh(); }}>
        <RefreshCw size={17} aria-hidden="true" /> {loading ? 'Refreshing…' : 'Refresh applications'}
      </button>
    </div>

    <div className="admin-stats" aria-label="Application statistics">
      <div className="admin-stat-card">
        <div className="admin-stat-label"><Users size={19} aria-hidden="true" /><span>Applications</span></div>
        <strong>{applications.length}</strong>
      </div>
      <div className="admin-stat-card">
        <div className="admin-stat-label"><Clock3 size={19} aria-hidden="true" /><span>Pending review</span></div>
        <strong>{pending}</strong>
      </div>
      <div className="admin-stat-card">
        <div className="admin-stat-label"><ShieldCheck size={19} aria-hidden="true" /><span>Approved</span></div>
        <strong>{approved}</strong>
      </div>
      <div className="admin-stat-card">
        <div className="admin-stat-label"><UserX size={19} aria-hidden="true" /><span>Rejected</span></div>
        <strong>{rejected}</strong>
      </div>
    </div>

    {loading && <p role="status" className="admin-state">Loading applications…</p>}
    {error && <p className="alert error" role="alert">{error}</p>}
    {message && <p className="alert success" role="status">{message}</p>}

    {!loading && <section className="panel admin-section" aria-labelledby="admin-applications-heading">
      <div className="admin-section-heading">
        <div><h2 id="admin-applications-heading">Clinician applications</h2>
          <p className="muted">Select an application to view its details and review status.</p></div>
        <span className="admin-count">{applications.length} total</span>
      </div>
      {applications.length === 0
        ? <p className="admin-empty">No applications found.</p>
        : <div className="admin-table-wrap" tabIndex={0} aria-label="Scrollable clinician application table">
          <table className="admin-table">
            <thead><tr>
              <th scope="col">Applicant</th><th scope="col">Institution (self-reported)</th>
              <th scope="col">Status</th><th scope="col">Submitted</th><th scope="col">Action</th>
            </tr></thead>
            <tbody>{applications.map((item) => <tr key={item.user_id}>
              <td><span className="admin-applicant-name">{item.full_name}</span>
                <span className="admin-applicant-email">{item.email}</span></td>
              <td className="admin-institution">{item.institution}</td>
              <td><span className={`admin-status admin-status--${item.status}`}>{item.status}</span></td>
              <td className="admin-date">{date(item.submitted_at)}</td>
              <td><button type="button" className="outline admin-row-button"
                aria-label={`${item.status === 'pending' ? 'Review' : 'View'} application for ${item.full_name}`}
                aria-expanded={selected === item.user_id}
                onClick={() => { viewApplication(item.user_id); }}>
                {item.status === 'pending' ? 'Review' : 'View'}
              </button></td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>}

    {application && <section className="panel admin-section admin-review" aria-labelledby="admin-review-heading">
      <div className="admin-section-heading">
        <div>
          <span className="eyebrow">APPLICATION DETAILS</span>
          <h2 id="admin-review-heading">{application.full_name}</h2>
        </div>
        <button type="button" className="admin-icon-button" aria-label="Close application details" onClick={() => { setSelected(''); }}>
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      <dl className="admin-details">
        <div><dt>Email</dt><dd>{application.email}</dd></div>
        <div><dt>Professional registration (self-reported)</dt><dd>{application.registration_number}</dd></div>
        <div><dt>Institution (self-reported)</dt><dd>{application.institution}</dd></div>
        <div><dt>Status</dt><dd><span className={`admin-status admin-status--${application.status}`}>{application.status}</span></dd></div>
      </dl>
      {application.status === 'pending'
        ? <form onSubmit={(event) => { event.preventDefault(); void decide('approved'); }} className="review-form">
          <label>Verification evidence / review note (15–2000 characters)
            <textarea required minLength={15} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)}
              placeholder="Record the professional register, date checked, and institutional verification or reason for rejection. Do not paste sensitive documents." />
          </label>
          <label className="attestation"><input type="checkbox" checked={attested}
            onChange={(event) => setAttested(event.target.checked)} />
            I confirm I have independently reviewed the applicant's credentials or documented my reason for rejection.
          </label>
          <div className="review-buttons">
            <button type="submit" className="primary" disabled={submitting || !attested || note.trim().length < 15}>Approve clinician</button>
            <button type="button" className="outline" disabled={submitting || !attested || note.trim().length < 15}
              onClick={() => { void decide('rejected'); }}>Reject application</button>
            <button type="button" className="outline" onClick={() => { setSelected(''); }}>Cancel</button>
          </div>
        </form>
        : <p className="admin-review-finished">This application is already {application.status}. Only pending applications can be reviewed.</p>}
    </section>}

    <section className="panel admin-section" aria-labelledby="admin-history-heading">
      <div className="admin-section-heading"><div><h2 id="admin-history-heading">Recent review history</h2>
        <p className="muted">The latest decisions recorded by the administrator workflow.</p></div></div>
      {reviews.length === 0
        ? <p className="admin-empty">No decisions recorded by this portal yet. Earlier manual SQL approvals are not backfilled.</p>
        : <div className="admin-table-wrap" tabIndex={0} aria-label="Scrollable review history table">
          <table className="admin-table admin-history-table">
            <thead><tr><th scope="col">Date</th><th scope="col">Applicant ID</th><th scope="col">Decision</th><th scope="col">Evidence note</th></tr></thead>
            <tbody>{reviews.map((review) => <tr key={review.id}>
              <td>{new Date(review.decided_at).toLocaleString()}</td>
              <td className="admin-uuid">{review.application_user_id}</td>
              <td><span className={`admin-status admin-status--${review.decision}`}>{review.decision}</span></td>
              <td className="admin-evidence">{review.evidence_note}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
    <p className="fine-print admin-disclaimer">Development use only. No patient information is available in this milestone. Automated email delivery and patient–clinician linking are not yet implemented.</p>
  </div>;
}
