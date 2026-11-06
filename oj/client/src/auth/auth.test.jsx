import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.jsx';

const user = {
  id: 'user-1',
  username: 'alice',
  email: 'alice@example.com',
  role: 'user',
  stats: { solved: 0, attempts: 0 },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderAt(path = '/') {
  window.history.pushState({}, '', path);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser authentication', () => {
  it('creates an account and displays the signed-in home page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired.' },
          },
          401,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { user, accessToken: 'access-1' } }, 201),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/signup');

    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-123' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/auth/signup',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('shows client validation errors and does not send an invalid signup', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { ok: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired.' } },
          401,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/signup');
    await screen.findByRole('heading', { name: 'Make room to grow' });

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ab' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'bad' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/use 3–30 letters/i)).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText(/password must be between 8 and 128/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows API validation errors on the form', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, error: { code: 'INVALID_REFRESH_TOKEN' } }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: {
              code: 'CONFLICT',
              message: 'An account with that email or username already exists',
            },
          },
          409,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/signup');
    await screen.findByRole('heading', { name: 'Make room to grow' });

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-123' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/);
  });

  it('logs in and displays the signed-in home page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired.' },
          },
          401,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { user, accessToken: 'access-2' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/login');

    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: user.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('restores a session on page load and protects the dashboard when signed out', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { ok: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired.' } },
          401,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });

  it('restores a signed-in session from the refresh cookie', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { user, accessToken: 'restored-access' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Welcome, alice' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });

  it('logs out, clears the in-memory session, and returns to the signed-out home page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { user, accessToken: 'restored-access' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { loggedOut: true } }));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('link', { name: /create account/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });
});
