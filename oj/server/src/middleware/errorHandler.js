import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/** 404 for any route nobody handled. */
export function notFoundHandler(req, _res, next) {
  next(new AppError('NOT_FOUND', 404, `Route ${req.method} ${req.path} not found`));
}

/** Map body-parser failures to client errors instead of 500s. */
function fromBodyParser(err) {
  if (err?.type === 'entity.too.large') {
    return new AppError('PAYLOAD_TOO_LARGE', 413, 'Request body is too large');
  }
  if (err?.type === 'entity.parse.failed') {
    return new AppError('INVALID_JSON', 400, 'Request body is not valid JSON');
  }
  return null;
}

/**
 * Central error handler. Never leaks stack traces or internal details.
 * @type {import('express').ErrorRequestHandler}
 */
export function errorHandler(err, req, res, _next) {
  const appError = err instanceof AppError ? err : fromBodyParser(err);

  if (appError) {
    res.status(appError.httpStatus).json({
      ok: false,
      error: { code: appError.code, message: appError.message },
    });
    return;
  }

  (req.log ?? logger).error({ err, event: 'http.unhandled_error' }, 'Unhandled error');
  res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
  });
}
