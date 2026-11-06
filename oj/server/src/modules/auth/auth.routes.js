import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { createEmailLimiter, createIpLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import { emptyBodySchema, loginSchema, signupSchema } from './auth.validation.js';

/**
 * @param {{ rateLimit: { max: number, windowMs: number } }} options
 */
export function createAuthRouter({ rateLimit }) {
  const router = Router();
  const ipLimiter = createIpLimiter(rateLimit);
  const emailLimiter = createEmailLimiter(rateLimit);

  router.post('/signup', ipLimiter, validate({ body: signupSchema }), controller.signup);
  router.post('/login', ipLimiter, emailLimiter, validate({ body: loginSchema }), controller.login);
  router.post('/refresh', validate({ body: emptyBodySchema }), controller.refresh);
  router.post('/logout', validate({ body: emptyBodySchema }), controller.logout);
  router.get('/me', requireAuth, controller.me);

  return router;
}
