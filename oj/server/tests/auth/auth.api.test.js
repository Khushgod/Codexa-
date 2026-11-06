import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../src/app.js';
import { useTestDb } from '../helpers/db.js';
import { cookieHeader, newUser, refreshCookieFrom, signup } from '../helpers/auth.js';

useTestDb();

let app;
beforeAll(() => {
  app = createApp();
});

describe('GET /healthz', () => {
  it('reports ok when the database is connected', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { status: 'ok', db: true } });
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('POST /api/auth/signup', () => {
  it('creates a user, returns an access token and sets an httpOnly refresh cookie', async () => {
    const { res, payload } = await signup(app, newUser({ username: 'Alice_1' }));

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.user).toMatchObject({
      username: 'alice_1',
      email: payload.email,
      role: 'user',
    });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.expiresIn).toBe(900);

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('oj_rt='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it('never returns the password hash and stores an argon2id hash', async () => {
    const { res, payload } = await signup(app);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

    const stored = await mongoose.connection.db
      .collection('users')
      .findOne({ email: payload.email });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(payload.password);
  });

  it('stores only a hash of the refresh token', async () => {
    const { refreshToken } = await signup(app);
    const tokens = await mongoose.connection.db.collection('refreshTokens').find().toArray();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).not.toBe(refreshToken);
    expect(tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    const first = newUser();
    await signup(app, first);
    const { res } = await signup(app, newUser({ email: first.email.toUpperCase() }));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: expect.any(String) },
    });
  });

  it('rejects a duplicate username with 409', async () => {
    const first = newUser();
    await signup(app, first);
    const { res } = await signup(app, newUser({ username: first.username.toUpperCase() }));
    expect(res.status).toBe(409);
  });

  it.each([
    ['short password', { password: 'short' }],
    ['invalid email', { email: 'not-an-email' }],
    ['invalid username', { username: 'a b' }],
    ['unknown field', { role: 'admin' }],
  ])('rejects %s with 400', async (_name, override) => {
    const { res } = await signup(app, newUser(override));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON with 400 and no stack trace', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const { payload } = await signup(app);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(payload.email);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(refreshCookieFrom(res)).toBeTruthy();
  });

  it('rejects a bad password with a generic 401', async () => {
    const { payload } = await signup(app);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('gives the same response for an unknown email (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever-123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('rejects a missing password with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@example.com' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and returns a new access token', async () => {
    const { refreshToken } = await signup(app);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(refreshToken));
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));

    const rotated = refreshCookieFrom(res);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(refreshToken);

    const again = await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(rotated));
    expect(again.status).toBe(200);
  });

  it('reuse of a rotated token revokes the whole family', async () => {
    const { refreshToken: original } = await signup(app);
    const first = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(original));
    const current = refreshCookieFrom(first);

    // Attacker replays the old token.
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(original));
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_REFRESH_TOKEN');

    // The legitimate, newest token is now revoked too.
    const victim = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(current));
    expect(victim.status).toBe(401);
  });

  it('does not revoke other sessions of the same user on reuse', async () => {
    const { payload, refreshToken: sessionA } = await signup(app);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password });
    const sessionB = refreshCookieFrom(login);

    await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(sessionA));
    await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(sessionA)); // reuse

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(sessionB));
    expect(res.status).toBe(200);
  });

  it('rejects a missing or unknown token and clears the cookie', async () => {
    const missing = await request(app).post('/api/auth/refresh');
    expect(missing.status).toBe(401);

    const unknown = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader('nope'));
    expect(unknown.status).toBe(401);
    expect(unknown.headers['set-cookie'].join(';')).toMatch(/oj_rt=;/);
  });

  it('rejects an expired token', async () => {
    const { refreshToken } = await signup(app);
    await mongoose.connection.db
      .collection('refreshTokens')
      .updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(refreshToken));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const { refreshToken } = await signup(app);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(refreshToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { loggedOut: true } });
    expect(res.headers['set-cookie'].join(';')).toMatch(/oj_rt=;/);

    const after = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(refreshToken));
    expect(after.status).toBe(401);
  });

  it('is idempotent without a cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/auth/me (protected route)', () => {
  it('returns the current user with a valid access token', async () => {
    const { res: signupRes, payload } = await signup(app);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signupRes.body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(payload.email);
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a tampered token', async () => {
    const { res: signupRes } = await signup(app);
    const token = signupRes.body.data.accessToken;
    const tampered = `${token.slice(0, -2)}${token.endsWith('aa') ? 'bb' : 'aa'}`;
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it('does not accept a refresh token as an access token', async () => {
    const { refreshToken } = await signup(app);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${refreshToken}`);
    expect(res.status).toBe(401);
  });
});

describe('unknown routes', () => {
  it('return the error envelope with 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('CORS', () => {
  it('allows origins on the allow-list with credentials', async () => {
    const res = await request(app).get('/healthz').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sends no CORS headers to other origins', async () => {
    const res = await request(app).get('/healthz').set('Origin', 'http://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('security headers', () => {
  it('sets helmet headers and hides x-powered-by', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
