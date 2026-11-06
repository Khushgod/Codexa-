import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PlatformLayout } from '../components/PlatformLayout.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { listMySubmissions } from '../api/problems.js';

export function ProfilePage() {
  const { user } = useAuth();
  return (
    <PlatformLayout>
      <main className="platform-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR ACCOUNT</p>
            <h1>Profile</h1>
            <p>Account details and practice progress.</p>
          </div>
        </div>
        <section className="profile-card">
          <div className="profile-avatar" aria-hidden="true">
            {user.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2>{user.username}</h2>
            <p>{user.email}</p>
            <span className="tag-chip">{user.role}</span>
          </div>
          <dl className="profile-stats">
            <div>
              <dt>Solved</dt>
              <dd>{user.stats?.solved ?? 0}</dd>
            </div>
            <div>
              <dt>Attempts</dt>
              <dd>{user.stats?.attempts ?? 0}</dd>
            </div>
          </dl>
        </section>
        <p className="inline-note">
          Problem-level progress updates when judging is available in M6.
        </p>
      </main>
    </PlatformLayout>
  );
}

export function SubmissionsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['my-submissions'],
    queryFn: () => listMySubmissions({ limit: 50 }),
    enabled: !authLoading && Boolean(user),
  });

  const submissions = data?.items ?? [];

  return (
    <PlatformLayout>
      <main className="platform-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR PRACTICE</p>
            <h1>My submissions</h1>
            <p>Review your code attempts and problem verdicts.</p>
          </div>
        </div>

        {authLoading ? (
          <p className="route-status">Loading…</p>
        ) : !user ? (
          <div className="empty-state">
            <h2>Sign in to view your submissions</h2>
            <Link className="button button-outline" to="/login">Sign in</Link>
          </div>
        ) : isPending ? (
          <p className="route-status">Loading your submission history…</p>
        ) : isError ? (
          <p className="route-error" role="alert">
            {error.message || 'Could not load your submissions.'}
          </p>
        ) : submissions.length === 0 ? (
          <div className="empty-state">
            <span className="feature-number">0</span>
            <h2>No submissions yet</h2>
            <p>You haven't submitted any solutions yet. Pick a problem and run or submit your code!</p>
            <Link className="button button-outline" to="/problems">
              Browse problems
            </Link>
          </div>
        ) : (
          <div className="problem-table-wrap">
            <table className="problem-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Problem</th>
                  <th>Language</th>
                  <th>Type</th>
                  <th>Runtime</th>
                  <th>Memory</th>
                  <th>Submitted At</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub) => (
                  <tr key={sub._id}>
                    <td>
                      <span className={`verdict-badge verdict-${(sub.verdict || sub.status || 'unknown').toLowerCase()}`}>
                        {sub.verdict || sub.status}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="problem-title-link"
                        to={`/problems/${sub.problemId?.slug || ''}`}
                      >
                        {sub.problemId?.title || 'Problem'}
                      </Link>
                    </td>
                    <td>
                      <span className="tag-chip">{sub.language}</span>
                    </td>
                    <td>
                      <span className="tag-chip">{sub.mode}</span>
                    </td>
                    <td>{sub.runtimeMs !== undefined ? `${sub.runtimeMs} ms` : '—'}</td>
                    <td>{sub.memoryKb ? `${Math.round(sub.memoryKb / 1024)} MB` : '—'}</td>
                    <td>
                      {sub.createdAt ? new Date(sub.createdAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </PlatformLayout>
  );
}
