import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { JWT_AUDIENCE, JWT_ISSUER, ROLES } from '../../config/constants.js';
import { AppError, notFound, unauthorized } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { RefreshToken } from './refreshToken.model.js';
import { User } from './user.model.js';

/**
 * @typedef {{ id: string, username: string, email: string, role: string,
 *             stats: { solved: number, attempts: number }, createdAt: Date }} PublicUser
 * @typedef {{ user: PublicUser, accessToken: string, expiresIn: number,
 *             refreshToken: string, refreshExpiresAt: Date }} AuthResult
 */

const ARGON2_OPTIONS = { type: argon2.argon2id };
const DAY_MS = 24 * 60 * 60 * 1000;

const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password');
const invalidRefresh = () =>
  new AppError('INVALID_REFRESH_TOKEN', 401, 'Session expired. Please log in again.');

// Verified against when the email is unknown, so response time does not reveal
// whether an account exists.
const dummyHashPromise = argon2.hash(randomBytes(16).toString('hex'), ARGON2_OPTIONS);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** @returns {PublicUser} */
function toPublicUser(doc) {
  return {
    id: doc._id.toString(),
    username: doc.username,
    email: doc.email,
    role: doc.role,
    stats: { solved: doc.stats?.solved ?? 0, attempts: doc.stats?.attempts ?? 0 },
    createdAt: doc.createdAt,
  };
}

function signAccessToken(user) {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: user._id.toString(),
    expiresIn: env.JWT_ACCESS_TTL_SEC,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

async function createRefreshToken(userId, familyId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS);
  await RefreshToken.create({ userId, tokenHash: sha256(token), familyId, expiresAt });
  return { token, tokenHash: sha256(token), expiresAt };
}

/** @returns {Promise<AuthResult>} */
async function issueSession(user, familyId = randomUUID()) {
  const refresh = await createRefreshToken(user._id, familyId);
  return {
    user: toPublicUser(user),
    accessToken: signAccessToken(user),
    expiresIn: env.JWT_ACCESS_TTL_SEC,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

async function revokeFamily(familyId) {
  await RefreshToken.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });
}

const isDuplicateKeyError = (err) => err?.code === 11000;

/**
 * @param {{ username: string, email: string, password: string }} input
 * @returns {Promise<AuthResult>}
 */
export async function signup({ username, email, password }) {
  const conflict = () =>
    new AppError('CONFLICT', 409, 'An account with that email or username already exists');

  const existing = await User.exists({ $or: [{ email }, { username }] });
  if (existing) throw conflict();

  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
  let user;
  try {
    user = await User.create({ username, email, passwordHash });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict(); // lost a race with a concurrent signup
    throw err;
  }
  logger.info({ event: 'auth.signup', userId: user._id.toString() }, 'User signed up');
  return issueSession(user);
}

/**
 * @param {{ email: string, password: string }} input
 * @returns {Promise<AuthResult>}
 */
export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) {
    await argon2.verify(await dummyHashPromise, password);
    throw invalidCredentials();
  }
  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) throw invalidCredentials();
  return issueSession(user);
}

/**
 * Rotate a refresh token. Reusing a rotated or revoked token revokes its family.
 * @param {string | undefined} rawToken
 * @returns {Promise<AuthResult>}
 */
export async function refresh(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) throw invalidRefresh();

  const tokenHash = sha256(rawToken);
  const stored = await RefreshToken.findOne({ tokenHash });
  if (!stored) throw invalidRefresh();

  if (stored.revokedAt) {
    await revokeFamily(stored.familyId);
    logger.warn(
      { event: 'auth.refresh_reuse', userId: stored.userId.toString(), familyId: stored.familyId },
      'Refresh token reuse detected; family revoked',
    );
    throw invalidRefresh();
  }
  if (stored.expiresAt.getTime() <= Date.now()) throw invalidRefresh();

  const user = await User.findById(stored.userId);
  if (!user) {
    await revokeFamily(stored.familyId);
    throw invalidRefresh();
  }

  const session = await issueSession(user, stored.familyId);

  // Atomic claim: if another request rotated this token first, treat it as reuse.
  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: stored._id, revokedAt: null },
    { revokedAt: new Date(), replacedByHash: sha256(session.refreshToken) },
  );
  if (!claimed) {
    await revokeFamily(stored.familyId);
    throw invalidRefresh();
  }
  return session;
}

/**
 * Revoke the session (the whole token family). Idempotent.
 * @param {string | undefined} rawToken
 */
export async function logout(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return;
  const stored = await RefreshToken.findOne({ tokenHash: sha256(rawToken) });
  if (stored) await revokeFamily(stored.familyId);
}

/**
 * @param {string} token
 * @returns {{ id: string, role: string }}
 */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof payload !== 'object' || typeof payload.sub !== 'string') throw unauthorized();
    return { id: payload.sub, role: payload.role };
  } catch {
    throw unauthorized();
  }
}

/**
 * @param {string} id
 * @returns {Promise<PublicUser>}
 */
export async function getUserById(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('User not found');
  const user = await User.findById(id);
  if (!user) throw notFound('User not found');
  return toPublicUser(user);
}

/**
 * Record one completed judge submission without exposing the user model.
 * @param {string} userId
 * @param {string} problemId
 * @param {string} verdict
 */
export async function recordSubmissionOutcome(userId, problemId, verdict) {
  await User.updateOne({ _id: userId }, { $inc: { 'stats.attempts': 1 } });
  if (verdict === 'AC') {
    await User.findOneAndUpdate(
      { _id: userId, solvedProblemIds: { $ne: problemId } },
      {
        $addToSet: { solvedProblemIds: problemId },
        $inc: { 'stats.solved': 1 },
      },
    );
  }
}

/**
 * Admin bootstrap helper (used by scripts/promote-admin.js).
 * @param {string} email
 * @param {string} role
 * @returns {Promise<PublicUser>}
 */
export async function setUserRoleByEmail(email, role) {
  if (!Object.values(ROLES).includes(role)) {
    throw new AppError('VALIDATION_ERROR', 400, `role must be one of ${Object.values(ROLES)}`);
  }
  const user = await User.findOneAndUpdate(
    { email: email.trim().toLowerCase() },
    { role },
    { returnDocument: 'after' },
  );
  if (!user) throw notFound('User not found');
  // Existing sessions keep the old role in their access token for up to 15 minutes;
  // revoking refresh tokens forces a fresh login with the new role.
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  return toPublicUser(user);
}
