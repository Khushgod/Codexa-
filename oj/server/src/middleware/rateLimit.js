import { rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

const rateLimitedHandler = (_req, _res, next) =>
  next(new AppError('RATE_LIMITED', 429, 'Too many requests. Please wait and try again.'));

/**
 * Per-IP limiter. Create one per app instance so tests do not share counters.
 * @param {{ max: number, windowMs: number }} opts
 */
export function createIpLimiter({ max, windowMs }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rateLimitedHandler,
  });
}

/**
 * Per-email limiter for login (slows credential stuffing against one account
 * from many IPs). Requests without a string email are left to validation.
 * @param {{ max: number, windowMs: number }} opts
 */
export function createEmailLimiter({ max, windowMs }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => typeof req.body?.email !== 'string',
    keyGenerator: (req) => `email:${req.body.email.trim().toLowerCase()}`,
    handler: rateLimitedHandler,
  });
}
