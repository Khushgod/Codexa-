import { z } from 'zod';

export const createSubmissionSchema = z.strictObject({
  problemId: z.string().regex(/^[a-f\d]{24}$/i),
  language: z.enum(['cpp', 'python', 'java']),
  code: z
    .string()
    .min(1)
    .max(64 * 1024),
  mode: z.enum(['run', 'submit']).default('submit'),
});

export const submissionIdParamsSchema = z.strictObject({
  id: z.string().regex(/^[a-f\d]{24}$/i),
});

export const submissionListQuerySchema = z.strictObject({
  problemId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
