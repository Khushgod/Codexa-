import { isProduction } from '../../config/env.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../../config/constants.js';
import * as authService from './auth.service.js';

const baseCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
});

/** Send the session: refresh token as httpOnly cookie, access token in the body. */
function sendSession(res, status, session) {
  res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, {
    ...baseCookieOptions(),
    expires: session.refreshExpiresAt,
  });
  res.status(status).json({
    ok: true,
    data: { user: session.user, accessToken: session.accessToken, expiresIn: session.expiresIn },
  });
}

export async function signup(req, res) {
  sendSession(res, 201, await authService.signup(req.validated.body));
}

export async function login(req, res) {
  sendSession(res, 200, await authService.login(req.validated.body));
}

export async function refresh(req, res) {
  try {
    sendSession(res, 200, await authService.refresh(req.cookies?.[REFRESH_COOKIE_NAME]));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE_NAME, baseCookieOptions());
    throw err;
  }
}

export async function logout(req, res) {
  await authService.logout(req.cookies?.[REFRESH_COOKIE_NAME]);
  res.clearCookie(REFRESH_COOKIE_NAME, baseCookieOptions());
  res.status(200).json({ ok: true, data: { loggedOut: true } });
}

export async function me(req, res) {
  res.status(200).json({ ok: true, data: { user: await authService.getUserById(req.user.id) } });
}
