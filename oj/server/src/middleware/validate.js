import { AppError } from '../utils/AppError.js';

/**
 * Validate request parts with zod schemas. Parsed values are stored on
 * req.validated.{body,query,params} (Express 5 makes req.query read-only).
 * Use strict object schemas so unknown fields are rejected.
 *
 * @param {{ body?: import('zod').ZodType, query?: import('zod').ZodType, params?: import('zod').ZodType }} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.validated = req.validated ?? {};
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        const message = result.error.issues
          .map((issue) => `${issue.path.join('.') || part}: ${issue.message}`)
          .join('; ');
        next(new AppError('VALIDATION_ERROR', 400, message));
        return;
      }
      req.validated[part] = result.data;
    }
    next();
  };
}
