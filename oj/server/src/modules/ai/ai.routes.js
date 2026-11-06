import { rateLimit } from 'express-rate-limit';
import { Router } from 'express';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../utils/AppError.js';
import * as controller from './ai.controller.js';
import { chatBodySchema, feedbackBodySchema, problemQuerySchema } from './ai.validation.js';

const dailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: env.AI_DAILY_MESSAGE_LIMIT,
  keyGenerator: (req) => `${req.user.id}:${req.validated.body.problemId}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(new AppError('RATE_LIMITED', 429, 'Daily tutor limit reached for this problem.')),
});

export function createAiRouter() {
  const router = Router();
  router.use(requireAuth);
  router.get('/conversation', validate({ query: problemQuerySchema }), controller.conversation);
  router.post('/unlock', validate({ body: problemQuerySchema }), controller.unlock);
  router.post('/chat', validate({ body: chatBodySchema }), dailyLimiter, controller.chat);
  router.post('/feedback', validate({ body: feedbackBodySchema }), controller.feedback);
  return router;
}
