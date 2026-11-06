import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

export const chatBodySchema = z.strictObject({
  problemId: objectId,
  message: z.string().max(2000),
  editorCode: z.string().max(100_000).optional(),
});

export const problemQuerySchema = z.strictObject({ problemId: objectId });

export const feedbackBodySchema = z.strictObject({
  problemId: objectId,
  messageIndex: z.number().int().min(0).max(100),
  rating: z.enum(['up', 'down']),
});
