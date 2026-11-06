import { z } from 'zod';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);

const canarySchema = z.strictObject({
  phrase: z.string().trim().min(1).max(200),
  level: z.number().int().min(3).max(4),
});

export const problemBodySchema = z.strictObject({
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  tags: z.array(z.string().trim().min(1).max(50)).max(30),
  statementMd: z.string().trim().min(1).max(100_000),
  inputFormat: z.string().trim().min(1).max(20_000),
  outputFormat: z.string().trim().min(1).max(20_000),
  constraints: z.array(z.string().trim().min(1).max(2000)).max(100),
  timeLimitMs: z.number().int().min(1).max(60_000),
  memoryLimitMb: z.number().int().min(1).max(16_384),
  checker: z.strictObject({
    type: z.enum(['exact', 'token', 'float', 'custom']),
    epsilon: z.number().nonnegative().optional(),
  }),
  aiContext: z.strictObject({
    edgeCases: z.array(z.string().max(2000)).max(100),
    commonMistakes: z.array(z.string().max(2000)).max(100),
    directionHint: z.string().max(20_000),
    keyInsight: z.string().max(20_000),
    outline: z.string().max(20_000),
    canaries: z.array(canarySchema).max(100),
    reviewed: z.boolean(),
    lintWarnings: z.array(z.string().max(2000)).max(100),
  }),
  source: z.strictObject({
    type: z.enum(['original', 'scraped']),
    url: z.string().max(2048),
  }),
  isPublished: z.boolean(),
});

export const problemUpdateBodySchema = problemBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided.',
  });

export const aiNotesReviewBodySchema = z.strictObject({
  overrideWarnings: z.boolean().default(false),
});

export const testcaseBodySchema = z
  .strictObject({
    order: z.number().int().min(1),
    input: z.string().max(1_000_000).optional(),
    expectedOutput: z.string().max(1_000_000).optional(),
    fileRef: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine(
        (value) =>
          /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && !value.split(/[\\/]/).includes('..'),
        'must be a safe relative reference',
      )
      .optional(),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
    isSample: z.boolean(),
    category: z.string().trim().min(1).max(64),
    weight: z.number().nonnegative().max(1_000_000).default(1),
  })
  .refine(
    (testCase) =>
      (typeof testCase.input === 'string' &&
        typeof testCase.expectedOutput === 'string' &&
        !testCase.fileRef &&
        !testCase.sha256) ||
      (!testCase.input &&
        typeof testCase.fileRef === 'string' &&
        typeof testCase.sha256 === 'string' &&
        typeof testCase.expectedOutput === 'string' &&
        !testCase.isSample),
    {
      message: 'Provide inline input and expectedOutput, or fileRef and sha256.',
    },
  );

export const testcaseUpdateBodySchema = testcaseBodySchema;

export const listQuerySchema = z.strictObject({
  tag: z.string().trim().min(1).max(50).optional(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const objectIdParamsSchema = z.strictObject({
  id: z.string().regex(/^[a-f\d]{24}$/i),
});

export const testcaseParamsSchema = objectIdParamsSchema.extend({
  testCaseId: z.string().regex(/^[a-f\d]{24}$/i),
});

export const slugParamsSchema = z.strictObject({ slug: slugSchema });
