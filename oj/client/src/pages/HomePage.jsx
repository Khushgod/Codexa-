import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { PlatformLayout } from '../components/PlatformLayout.jsx';
import { SiteHeader } from '../components/SiteHeader.jsx';

export function HomePage() {
  const { user, startupError } = useAuth();

  return (
    <main className="page-shell">
      <SiteHeader />

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="status-dot" /> CODEXA · THINK. TRACE. TRANSFORM.
          </p>
          <h1>
            Think. Trace.
            <br />
            <span>Transform.</span>
          </h1>
          {user ? (
            <>
              <p className="hero-description">
                Welcome back, <strong>{user.username}</strong>. Choose a problem and start working
                through it at your own pace.
              </p>
              <div className="hero-actions">
                <Link className="button" to="/problems">
                  Browse problems <span aria-hidden="true">→</span>
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="hero-description">
                A smarter way to master algorithms. Codexa's AI tutor helps you reason through
                problems while keeping the key insight yours.
              </p>
              <div className="hero-actions">
                <Link className="button" to="/problems">
                  Browse problems <span aria-hidden="true">→</span>
                </Link>
                <Link className="button button-outline" to="/login">
                  I have an account
                </Link>
              </div>
            </>
          )}
        </div>
        <div className="code-card" aria-label="Sample code preview">
          <div className="code-card-header">
            <div className="window-dots">
              <i />
              <i />
              <i />
            </div>
            <span>solution.cpp</span>
            <span className="language-tag">C++</span>
          </div>
          <pre aria-hidden="true">
            <code>
              <span className="code-purple">class</span> <span className="code-blue">Solution</span>{' '}
              {'{'}
              {'\n'}
              {'  '}
              <span className="code-purple">public:</span>
              {'\n'}
              {'  '}
              <span className="code-blue">vector</span>&lt;<span className="code-blue">int</span>
              &gt; solve() {'{'}
              {'\n'}
              {'    '}
              <span className="code-comment">// one step at a time</span>
              {'\n'}
              {'    '}
              <span className="code-purple">return</span> answer;{'\n'}
              {'  }'}
              {'\n'}
              {'};'}
            </code>
          </pre>
          <div className="code-card-footer">
            <span>
              <i className="status-dot" /> Ready to run
            </span>
            <span>● &nbsp; C++17</span>
          </div>
        </div>
      </section>

      <section className="feature-grid" aria-label="Platform highlights">
        <article className="feature-card">
          <span className="feature-number">01</span>
          <h2>Practice with purpose</h2>
          <p>Build a steady problem-solving habit with a clear, distraction-free workspace.</p>
        </article>
        <article className="feature-card">
          <span className="feature-number">02</span>
          <h2>Guidance, not giveaways</h2>
          <p>Get nudges and edge-case prompts that help you find the approach yourself.</p>
        </article>
        <article className="feature-card">
          <span className="feature-number">03</span>
          <h2>See ideas come alive</h2>
          <p>Live algorithm visualizations are on Codexa's roadmap. For now, build intuition one trace at a time.</p>
        </article>
      </section>

      <footer className="page-footer">
        <span>
          CODEXA <span className="brand-dot">●</span> A better way to master algorithms.
        </span>
        {startupError && <span role="alert">{startupError}</span>}
      </footer>
    </main>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  return (
    <PlatformLayout>
      <main className="platform-main">
        <p className="eyebrow">YOUR SPACE</p>
        <h1>Welcome, {user.username}</h1>
        <p className="hero-description">
          Your practice area is ready. Browse a problem to open the code workspace.
        </p>
        <Link className="button" to="/problems">
          Browse problems
        </Link>
      </main>
    </PlatformLayout>
  );
}
