import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Brand } from './Brand.jsx';

const THEME_KEY = 'oj-theme';

function initialTheme() {
  return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

export function SiteHeader() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState(initialTheme);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  async function handleLogout() {
    setError('');
    try {
      await logout();
    } catch (logoutError) {
      setError(logoutError.message || 'Could not log out.');
    }
  }

  return (
    <>
      <header className="app-header">
        <Brand />
        <nav className="app-nav" aria-label="Main navigation">
          <NavLink to="/problems">Problems</NavLink>
          {user && <NavLink to="/submissions">Submissions</NavLink>}
          {user && <NavLink to="/profile">Profile</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="header-actions">
          <button
            className="button button-quiet theme-toggle"
            type="button"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          {user ? (
            <>
              <span className="user-chip">{user.username}</span>
              <button className="button button-quiet" onClick={handleLogout} type="button">
                Log out
              </button>
            </>
          ) : (
            <>
              <Link className="nav-link" to="/login">
                Log in
              </Link>
              <Link className="button button-small" to="/signup">
                Create account
              </Link>
            </>
          )}
        </div>
      </header>
      {error && (
        <p className="header-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
