import request from 'supertest';

export const REFRESH_COOKIE = 'oj_rt';

let counter = 0;

/** Unique, valid signup payload. */
export function newUser(overrides = {}) {
  counter += 1;
  return {
    username: `user_${counter}`,
    email: `user${counter}@example.com`,
    password: 'correct-horse-battery',
    ...overrides,
  };
}

/** Extract the raw refresh token value from a Set-Cookie header. */
export function refreshCookieFrom(res) {
  const cookies = res.headers['set-cookie'] ?? [];
  const cookie = cookies.find((value) => value.startsWith(`${REFRESH_COOKIE}=`));
  if (!cookie) return null;
  return cookie.split(';')[0].slice(REFRESH_COOKIE.length + 1);
}

export const cookieHeader = (token) => `${REFRESH_COOKIE}=${token}`;

export async function signup(app, payload = newUser()) {
  const res = await request(app).post('/api/auth/signup').send(payload);
  return { res, payload, refreshToken: refreshCookieFrom(res) };
}
