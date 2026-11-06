import { verifyAccessToken } from '../modules/auth/auth.service.js';
import { forbidden, unauthorized } from '../utils/AppError.js';

/**
 * Requires a valid "Authorization: Bearer <access token>" header.
 * Sets req.user = { id, role }.
 * @type {import('express').RequestHandler}
 */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    next(unauthorized());
    return;
  }
  req.user = verifyAccessToken(header.slice('Bearer '.length).trim());
  next();
}

/**
 * Must run after requireAuth.
 * @param {...string} roles allowed roles
 * @returns {import('express').RequestHandler}
 */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
}
