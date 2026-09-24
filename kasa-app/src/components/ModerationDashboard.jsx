import React, { useState, useEffect } from 'react';
import { getSb, getModerationQueue, moderateReport, getPhotoUrl } from '../api/supabase';

export default function ModerationDashboard() {
  const [currentUser, setCurrentUser] = useState(null);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [email, setEmail] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [reports, setReports] = useState([]);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const sb = getSb();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await sb.auth.getSession();
      setCurrentUser(session?.user || null);
      setCheckedAuth(true);
      if (session?.user) loadQueue();
    };
    checkAuth();

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      setCurrentUser(session?.user || null);
      if (event === 'SIGNED_IN') loadQueue();
    });

    return () => sub?.subscription?.unsubscribe();
  }, []);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const data = await getModerationQueue();
      setReports(data?.reports || []);
      setClaims(data?.claims || []);
      setError(null);
    } catch (err) {
      // KASA_NOT_ADMIN means this account isn't in public.admins yet.
      setError(err.code === 'KASA_NOT_ADMIN'
        ? 'Your account is not a moderator. Ask an admin to add your user_id to the admins table.'
        : (err.message || 'Failed to load moderation queue'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const { error: err } = await sb.auth.signInWithOtp({ email });
      if (err) throw err;
      setLinkSent(true);
    } catch (err) {
      setError(err.message || 'Failed to send login link');
    }
  };

  const handleLogout = async () => {
    await sb.auth.signOut();
    setReports([]);
    setClaims([]);
  };

  const handleModerate = async (reportId, action) => {
    if (action === 'hide' && !confirm('Hide this report from the public map?')) return;
    try {
      await moderateReport(reportId, action);
      setReports(reports.filter(r => r.id !== reportId));
    } catch (err) {
      setError(err.message);
    }
  };

  if (!checkedAuth) {
    return <div style={{ padding: '2rem' }}>Loading…</div>;
  }

  if (!currentUser) {
    return (
      <div className="mod-login">
        <h1 className="mod-login-title">Moderator Login</h1>
        <p className="mod-login-sub">Enter your email to access the moderation dashboard.</p>
        {error && <div className="mod-error">{error}</div>}
        {linkSent ? (
          <p style={{ color: 'var(--amber)' }}>Check your email for a login link.</p>
        ) : (
          <form onSubmit={handleLogin}>
            <input
              type="email"
              className="mod-login-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              required
            />
            <button type="submit" className="mod-login-btn">Send Login Link</button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="mod-wrap">
      <div className="mod-header">
        <h1 className="mod-title">Moderation Dashboard</h1>
        <button type="button" className="mod-logout" onClick={handleLogout}>Sign Out</button>
      </div>

      {error && <div className="mod-error" style={{ margin: '1rem' }}>{error}</div>}

      <div className="mod-list">
        {loading ? (
          <div className="mod-loading">Loading queue…</div>
        ) : reports.length === 0 && claims.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-lo)', padding: '2rem' }}>
            Nothing pending review.
          </p>
        ) : (
          <>
            {reports.map(report => {
              const date = new Date(report.created_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
              });

              return (
                <div key={report.id} className="mod-item">
                  <div className="mod-item-head">
                    <div className="mod-item-meta">
                      <div className="mod-item-id">Report #{report.id}</div>
                      <div className="mod-item-desc">{report.description || '(no description)'}</div>
                      <div className="mod-item-details">
                        <span>{report.category}</span>
                        <span>Ward {report.ward_no}</span>
                        <span>{date}</span>
                        <span>{report.flags || 0} flags</span>
                      </div>
                      <span className={`mod-safety ${report.moderation_status === 'flagged' ? 'mod-safety-bad' : 'mod-safety-unchecked'}`}>
                        {report.moderation_status}
                      </span>
                    </div>
                    {report.photo_url && (
                      <img
                        className="mod-item-photo"
                        src={report.photo_url}
                        alt="Report"
                        onError={(e) => e.target.style.display = 'none'}
                      />
                    )}
                  </div>
                  <div className="mod-item-actions">
                    <button
                      className="mod-btn mod-btn-approve"
                      onClick={() => handleModerate(report.id, 'approve')}
                    >
                      Approve
                    </button>
                    <button
                      className="mod-btn mod-btn-delete"
                      onClick={() => handleModerate(report.id, 'hide')}
                    >
                      Hide
                    </button>
                  </div>
                </div>
              );
            })}

            {claims.map(claim => (
              <div key={claim.id} className="mod-item">
                <div className="mod-item-head">
                  <div className="mod-item-meta">
                    <div className="mod-item-id">Cleanup claim on report #{claim.report_id}</div>
                    <div className="mod-item-desc">{claim.description || '(no description)'}</div>
                    <div className="mod-item-details">
                      <span>{claim.category}</span>
                      <span>Ward {claim.ward_no}</span>
                      <span>{claim.verify_count || 0} verified / {claim.dispute_count || 0} disputed</span>
                    </div>
                    {claim.needs_attention && (
                      <span className="mod-safety mod-safety-bad">⚠ Needs review</span>
                    )}
                  </div>
                  {claim.photo_url && (
                    <img
                      className="mod-item-photo"
                      src={claim.photo_url}
                      alt="Cleanup claim"
                      onError={(e) => e.target.style.display = 'none'}
                    />
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
