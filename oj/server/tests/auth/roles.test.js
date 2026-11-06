import { beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { requireAuth, requireRole } from '../../src/middleware/auth.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { setUserRoleByEmail } from '../../src/modules/auth/auth.service.js';
import { useTestDb } from '../helpers/db.js';
import { cookieHeader, newUser, signup } from '../helpers/auth.js';

useTestDb();

let app;
let probe;
beforeAll(() => {
  app = createApp();
  // Minimal app exercising the real middleware; admin routes arrive in M4.
  probe = express();
  probe.get('/admin-only', requireAuth, requireRole('admin'), (_req, res) => {
    res.json({ ok: true, data: { secret: 'admin-area' } });
  });
  probe.use(errorHandler);
});

async function loginAs(payload) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, password: payload.password });
  return res.body.data.accessToken;
}

describe('requireRole("admin")', () => {
  it('returns 401 without a token', async () => {
    const res = await request(probe).get('/admin-only');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { res: signupRes } = await signup(app);
    const res = await request(probe)
      .get('/admin-only')
      .set('Authorization', `Bearer ${signupRes.body.data.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin', async () => {
    const payload = newUser();
    await signup(app, payload);
    await setUserRoleByEmail(payload.email, 'admin');
    const token = await loginAs(payload);

    const res = await request(probe).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.secret).toBe('admin-area');
  });

  it('role changes revoke existing refresh tokens', async () => {
    const payload = newUser();
    const { refreshToken } = await signup(app, payload);
    await setUserRoleByEmail(payload.email, 'admin');

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(refreshToken));
    expect(res.status).toBe(401);
  });

  it('cannot self-assign admin at signup', async () => {
    const { res } = await signup(app, newUser({ role: 'admin' }));
    expect(res.status).toBe(400);
  });
});
