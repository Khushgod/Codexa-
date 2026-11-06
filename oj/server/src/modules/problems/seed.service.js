import { z } from 'zod';
import { Problem } from './problem.model.js';
import { TestCase } from './testCase.model.js';

const canarySchema = z.strictObject({
  phrase: z.string().trim().min(1),
  level: z.number().int().min(3).max(4),
});

const problemSeedSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  tags: z.array(z.string().trim().min(1)),
  statementMd: z.string().min(1),
  inputFormat: z.string().min(1),
  outputFormat: z.string().min(1),
  constraints: z.array(z.string()),
  timeLimitMs: z.number().int().positive(),
  memoryLimitMb: z.number().int().positive(),
  checker: z.strictObject({
    type: z.enum(['exact', 'token', 'float', 'custom']),
    epsilon: z.number().nonnegative().optional(),
  }),
  aiContext: z.strictObject({
    edgeCases: z.array(z.string()),
    commonMistakes: z.array(z.string()),
    directionHint: z.string(),
    keyInsight: z.string(),
    outline: z.string(),
    canaries: z.array(canarySchema),
    reviewed: z.boolean(),
    lintWarnings: z.array(z.string()),
  }),
  source: z.strictObject({
    type: z.enum(['original', 'scraped']),
    url: z.string(),
  }),
  isPublished: z.boolean(),
});

const MAX_SEED_INPUT_LENGTH = 1_000_000;

const generatedInputPartSchema = z
  .strictObject({
    text: z.string().optional(),
    repeat: z
      .strictObject({
        text: z.string(),
        count: z.number().int().min(0).max(500_000),
      })
      .optional(),
  })
  .refine((part) => (part.text !== undefined) !== (part.repeat !== undefined));

const generatedInputSchema = z
  .strictObject({
    parts: z.array(generatedInputPartSchema).min(1).max(32),
  })
  .superRefine((input, context) => {
    const length = input.parts.reduce(
      (total, part) =>
        total +
        (part.text !== undefined ? part.text.length : part.repeat.text.length * part.repeat.count),
      0,
    );
    if (length > MAX_SEED_INPUT_LENGTH) {
      context.addIssue({
        code: 'custom',
        message: `Generated testcase input exceeds ${MAX_SEED_INPUT_LENGTH} characters.`,
      });
    }
  });

const testCaseSeedSchema = z
  .strictObject({
    input: z.string().max(MAX_SEED_INPUT_LENGTH).optional(),
    generatedInput: generatedInputSchema.optional(),
    expectedOutput: z.string(),
    isSample: z.boolean(),
    category: z.string().trim().min(1).max(64),
    weight: z.number().nonnegative().default(1),
  })
  .refine((testCase) => (testCase.input !== undefined) !== (testCase.generatedInput !== undefined))
  .transform(({ generatedInput, ...testCase }) => ({
    ...testCase,
    input:
      generatedInput?.parts
        .map((part) =>
          part.text !== undefined ? part.text : part.repeat.text.repeat(part.repeat.count),
        )
        .join('') ?? testCase.input,
  }))
  .refine((testCase) => testCase.input.length <= MAX_SEED_INPUT_LENGTH, {
    message: `Testcase input exceeds ${MAX_SEED_INPUT_LENGTH} characters.`,
  });

const seedEntrySchema = z.strictObject({
  problem: problemSeedSchema,
  testCases: z.array(testCaseSeedSchema).min(8).max(15),
  referenceSolutions: z.strictObject({
    cpp: z.string().min(1),
    python: z.string().min(1),
    wrong: z.string().min(1),
    slow: z.string().min(1),
  }),
});

/**
 * Validate and idempotently import problem fixtures. Existing seeded cases are
 * replaced by order so removed cases do not linger after a seed update.
 * @param {unknown[]} entries
 * @returns {Promise<{ problems: number, testCases: number }>}
 */
export async function seedProblems(entries) {
  const parsedEntries = entries.map((entry) => seedEntrySchema.parse(entry));
  const slugs = parsedEntries.map(({ problem }) => problem.slug);
  if (new Set(slugs).size !== slugs.length) {
    throw new Error('Seed files contain duplicate problem slugs.');
  }

  let testCaseCount = 0;
  for (const { problem, testCases } of parsedEntries) {
    const savedProblem = await Problem.findOneAndUpdate(
      { slug: problem.slug },
      { $set: problem },
      { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
    );

    await TestCase.bulkWrite(
      testCases.map((testCase, index) => ({
        replaceOne: {
          filter: { problemId: savedProblem._id, order: index + 1 },
          replacement: {
            ...testCase,
            problemId: savedProblem._id,
            order: index + 1,
          },
          upsert: true,
        },
      })),
      { ordered: true },
    );
    await TestCase.deleteMany({
      problemId: savedProblem._id,
      order: { $gt: testCases.length },
    });
    testCaseCount += testCases.length;
  }

  return { problems: parsedEntries.length, testCases: testCaseCount };
}

export const seedSchemas = Object.freeze({
  problemSeedSchema,
  seedEntrySchema,
  testCaseSeedSchema,
});
