import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { MAX_BODY_SIZE } from './config/constants.js';
import './models.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createProblemRouter } from './modules/problems/problem.routes.js';
import { createSubmissionRouter } from './modules/submissions/submission.routes.js';
import { createAiRouter } from './modules/ai/ai.routes.js';
import { isDbConnected } from './utils/db.js';

/**
 * Build the Express app without starting a server (tests import this).
 * @param {{ authRateLimit?: { max: number, windowMs: number } }} [options]
 * @returns {import('express').Express}
 */
export function createApp(options = {}) {
  const authRateLimit = options.authRateLimit ?? {
    max: env.AUTH_RATE_LIMIT_MAX,
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  };

  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(requestLogger);
  app.use(helmet());
  app.use(
    cors({
      // Requests without an Origin header (curl, same-origin) are allowed; browsers
      // from origins outside the allow-list get no CORS headers and are blocked.
      origin: (origin, callback) => callback(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: MAX_BODY_SIZE }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => {
    const db = isDbConnected();
    res.status(db ? 200 : 503).json({ ok: db, data: { status: db ? 'ok' : 'degraded', db } });
  });

  app.use('/api/auth', createAuthRouter({ rateLimit: authRateLimit }));
  app.use('/api/problems', createProblemRouter());
  app.use('/api/submissions', createSubmissionRouter());
  app.use('/api/ai', createAiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
