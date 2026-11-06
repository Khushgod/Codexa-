import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { useTestDb } from '../helpers/db.js';

useTestDb();

describe('auth rate limiting', () => {
  it('limits login attempts per IP and returns the error envelope', async () => {
    const app = createApp({ authRateLimit: { max: 3, windowMs: 60_000 } });
    const attempt = (i) =>
      request(app)
        .post('/api/auth/login')
        .send({ email: `x${i}@example.com`, password: 'nope-nope' });

    for (let i = 0; i < 3; i += 1) {
      expect((await attempt(i)).status).toBe(401);
    }
    const blocked = await attempt(99);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', message: expect.any(String) },
    });
  });

  it('limits signup per IP', async () => {
    const app = createApp({ authRateLimit: { max: 1, windowMs: 60_000 } });
    await request(app).post('/api/auth/signup').send({});
    const res = await request(app).post('/api/auth/signup').send({});
    expect(res.status).toBe(429);
  });
});
