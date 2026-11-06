import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Shared pino logger. Redaction is a safety net; callers must still never log
 * passwords, tokens, API keys, or full submitted code.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'oj-server' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[redacted]',
  },
});
