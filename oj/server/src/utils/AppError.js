/**
 * Expected, client-facing error. The message is safe to show to users.
 * Anything that is not an AppError is reported to clients as INTERNAL_ERROR.
 */
export class AppError extends Error {
  /**
   * @param {string} code machine-readable code, e.g. "VALIDATION_ERROR"
   * @param {number} httpStatus
   * @param {string} message human-readable, safe for clients
   */
  constructor(code, httpStatus, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const unauthorized = (message = 'Authentication required') =>
  new AppError('UNAUTHORIZED', 401, message);

export const forbidden = (message = 'You do not have permission to do that') =>
  new AppError('FORBIDDEN', 403, message);

export const notFound = (message = 'Not found') => new AppError('NOT_FOUND', 404, message);
