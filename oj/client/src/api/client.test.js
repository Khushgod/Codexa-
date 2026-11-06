import { describe, expect, it, vi } from 'vitest';
import { apiRequest, login } from './client.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('API client', () => {
  it('shares one refresh request between concurrent 401 responses', async () => {
    let initialRequests = 0;
    let refreshRequests = 0;
    let retriedWithFreshToken = 0;
    const fetchMock = vi.fn(async (url, options) => {
      if (url === '/api/auth/login') {
        return jsonResponse({
          ok: true,
          data: { user: { id: '1' }, accessToken: 'expired-token' },
        });
      }
      if (url === '/api/auth/refresh') {
        refreshRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse({ ok: true, data: { user: { id: '1' }, accessToken: 'fresh-token' } });
      }
      if (
        url === '/api/auth/me' &&
        options.headers.get('Authorization') === 'Bearer expired-token'
      ) {
        initialRequests += 1;
        return jsonResponse(
          { ok: false, error: { code: 'UNAUTHORIZED', message: 'Expired' } },
          401,
        );
      }
      if (url === '/api/auth/me' && options.headers.get('Authorization') === 'Bearer fresh-token') {
        retriedWithFreshToken += 1;
      }
      return jsonResponse({ ok: true, data: { user: { id: '1' } } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await login({ email: 'alice@example.com', password: 'password-123' });

    const responses = await Promise.all([
      apiRequest('/api/auth/me'),
      apiRequest('/api/auth/me'),
      apiRequest('/api/auth/me'),
    ]);

    expect(initialRequests).toBe(3);
    expect(refreshRequests).toBe(1);
    expect(retriedWithFreshToken).toBe(3);
    expect(responses).toHaveLength(3);
  });
});
