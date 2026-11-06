import mongoose from 'mongoose';
import { AppError, notFound } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { Problem } from './problem.model.js';
import { TestCase } from './testCase.model.js';
import { problemBodySchema, testcaseBodySchema } from './problem.validation.js';
import { seedSchemas } from './seed.service.js';

const PUBLIC_LIST_FIELDS = 'slug title difficulty tags createdAt updatedAt';

const DUPLICATE_SLUG_ERROR = () =>
  new AppError('CONFLICT', 409, 'A problem with that slug already exists');

function isDuplicateKey(err) {
  return err?.code === 11000;
}

function normalizeProblemInput(input) {
  return {
    ...input,
    slug: input.slug.trim().toLowerCase(),
    source: input.source ?? { type: 'original', url: '' },
    isPublished: input.isPublished ?? false,
  };
}

function normalizeTestCase(input) {
  return {
    ...input,
    sha256: input.sha256?.toLowerCase(),
  };
}

/**
 * Public list. Only selected listing fields are projected.
 * @param {{tag?: string, difficulty?: string, page: number, limit: number}} query
 */
export async function listPublishedProblems({ tag, difficulty, page, limit }) {
  const filter = { isPublished: true };
  if (tag) filter.tags = tag;
  if (difficulty) filter.difficulty = difficulty;

  const [items, total] = await Promise.all([
    Problem.find(filter)
      .select(PUBLIC_LIST_FIELDS)
      .sort({ createdAt: -1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Problem.countDocuments(filter),
  ]);
  return {
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/** Public detail deliberately selects only sample test cases and safe problem fields. */
export async function getPublishedProblem(slug) {
  const problem = await Problem.findOne({ slug, isPublished: true })
    .select(
      'slug title difficulty tags statementMd inputFormat outputFormat constraints timeLimitMs memoryLimitMb checker createdAt updatedAt',
    )
    .lean();
  if (!problem) throw notFound('Problem not found');

  const sampleTestCases = await TestCase.find({ problemId: problem._id, isSample: true })
    .select('order input expectedOutput isSample category')
    .sort({ order: 1 })
    .lean();
  return { ...problem, sampleTestCases };
}

/** Tutor context intentionally excludes test cases and reference solutions. */
export async function getPublishedProblemForTutor(problemId) {
  if (!mongoose.isValidObjectId(problemId)) return null;
  const problem = await Problem.findOne({ _id: problemId, isPublished: true })
    .select('slug title statementMd inputFormat outputFormat constraints aiContext updatedAt')
    .lean();
  if (!problem) return null;
  const sampleTestCases = await TestCase.find({ problemId: problem._id, isSample: true })
    .select('order input expectedOutput')
    .sort({ order: 1 })
    .lean();
  return { ...problem, sampleTestCases };
}

export async function getProblemForJudging(problemId, { publishedOnly = false } = {}) {
  const filter = { _id: problemId };
  if (publishedOnly) filter.isPublished = true;
  const problem = await Problem.findOne(filter)
    .select('slug title timeLimitMs memoryLimitMb checker')
    .lean();
  if (!problem) return null;
  const testCases = await TestCase.find({ problemId: problem._id })
    .select('order input expectedOutput fileRef sha256 category isSample')
    .sort({ order: 1 })
    .lean();
  return { problem, testCases };
}

/** Admin listing includes drafts; private data is confined to this route. */
export async function listProblemsForAdmin({ tag, difficulty, page, limit }) {
  const filter = {};
  if (tag) filter.tags = tag;
  if (difficulty) filter.difficulty = difficulty;
  const [items, total] = await Promise.all([
    Problem.find(filter)
      .sort({ createdAt: -1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Problem.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function createProblem(input) {
  if (input.aiContext?.reviewed && input.aiContext.lintWarnings?.length) {
    throw new AppError(
      'AI_NOTES_LINT_FAILED',
      409,
      'Tutor notes with lint warnings must be resolved before review.',
    );
  }
  try {
    return await Problem.create(normalizeProblemInput(input));
  } catch (err) {
    if (isDuplicateKey(err)) throw DUPLICATE_SLUG_ERROR();
    throw err;
  }
}

export async function updateProblem(id, input) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Problem not found');
  const update = { ...input };
  if (update.aiContext?.reviewed && update.aiContext.lintWarnings?.length) {
    throw new AppError(
      'AI_NOTES_LINT_FAILED',
      409,
      'Tutor notes with lint warnings must be resolved before review.',
    );
  }
  if (update.slug) update.slug = update.slug.trim().toLowerCase();
  try {
    const problem = await Problem.findByIdAndUpdate(
      id,
      { $set: update },
      {
        returnDocument: 'after',
        runValidators: true,
      },
    );
    if (!problem) throw notFound('Problem not found');
    return problem;
  } catch (err) {
    if (isDuplicateKey(err)) throw DUPLICATE_SLUG_ERROR();
    throw err;
  }
}

export async function reviewAiNotes(id, { overrideWarnings }) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Problem not found');
  const problem = await Problem.findById(id);
  if (!problem) throw notFound('Problem not found');
  const warnings = problem.aiContext?.lintWarnings ?? [];
  if (warnings.length && !overrideWarnings) {
    throw new AppError(
      'AI_NOTES_LINT_FAILED',
      409,
      'Tutor notes with lint warnings must be resolved or explicitly overridden.',
    );
  }
  if (warnings.length && overrideWarnings) {
    logger.warn({
      event: 'ai.notes_lint_override',
      problemId: String(problem._id),
      warningCount: warnings.length,
    });
  }
  problem.aiContext.reviewed = true;
  await problem.save();
  return problem;
}

export async function unpublishProblem(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Problem not found');
  const problem = await Problem.findByIdAndUpdate(
    id,
    { $set: { isPublished: false } },
    { returnDocument: 'after', runValidators: true },
  );
  if (!problem) throw notFound('Problem not found');
  return problem;
}

export async function createTestCase(problemId, input) {
  const problem = await Problem.findById(problemId).select('_id');
  if (!problem) throw notFound('Problem not found');
  try {
    return await TestCase.create({ ...normalizeTestCase(input), problemId: problem._id });
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new AppError('CONFLICT', 409, 'A test case already uses that order');
    }
    throw err;
  }
}

export async function listTestCasesForAdmin(problemId) {
  const problem = await Problem.findById(problemId).select('_id');
  if (!problem) throw notFound('Problem not found');
  return TestCase.find({ problemId: problem._id }).sort({ order: 1 }).lean();
}

export async function updateTestCase(problemId, testCaseId, input) {
  if (!mongoose.isValidObjectId(problemId) || !mongoose.isValidObjectId(testCaseId)) {
    throw notFound('Test case not found');
  }
  try {
    const update = normalizeTestCase(input);
    const unset = {};
    for (const field of ['input', 'expectedOutput', 'fileRef', 'sha256']) {
      if (!Object.hasOwn(update, field)) unset[field] = 1;
    }
    const testCase = await TestCase.findOneAndUpdate(
      { _id: testCaseId, problemId },
      {
        $set: update,
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { returnDocument: 'after', runValidators: true },
    );
    if (!testCase) throw notFound('Test case not found');
    return testCase;
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new AppError('CONFLICT', 409, 'A test case already uses that order');
    }
    throw err;
  }
}

export async function deleteTestCase(problemId, testCaseId) {
  if (!mongoose.isValidObjectId(problemId) || !mongoose.isValidObjectId(testCaseId)) {
    throw notFound('Test case not found');
  }
  const testCase = await TestCase.findOneAndDelete({ _id: testCaseId, problemId });
  if (!testCase) throw notFound('Test case not found');
  return { deleted: true };
}

/**
 * Import external JSON through the same persistence service while forcing
 * imported content into an unpublished, scraped state.
 * @param {{problem: object, testCases?: object[]}} input
 */
export async function importProblem(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    !input.problem ||
    typeof input.problem !== 'object' ||
    (input.testCases !== undefined && !Array.isArray(input.testCases))
  ) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'Import JSON must contain a problem object and an optional testCases array.',
    );
  }
  const parsedProblem = problemBodySchema.parse({
    ...input.problem,
    source: { type: 'scraped', url: input.problem.source?.url ?? '' },
    isPublished: false,
  });
  const parsedTestCases = (input.testCases ?? []).map((testCase, index) => {
    if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
      throw new AppError('VALIDATION_ERROR', 400, 'Each imported testcase must be an object.');
    }
    const { order, ...testCaseInput } = testCase;
    const orderedTestCase = { ...testCaseInput, order: order ?? index + 1 };
    if (typeof testCase.fileRef === 'string') {
      return testcaseBodySchema.parse(orderedTestCase);
    }
    const { input: testcaseInput, ...parsedTestCase } =
      seedSchemas.testCaseSeedSchema.parse(testCaseInput);
    return testcaseBodySchema.parse({
      ...parsedTestCase,
      input: testcaseInput,
      order: order ?? index + 1,
    });
  });
  const problem = await createProblem(parsedProblem);
  if (parsedTestCases.length > 0) {
    try {
      await TestCase.insertMany(
        parsedTestCases.map((testCase) => ({
          ...normalizeTestCase(testCase),
          problemId: problem._id,
        })),
        { ordered: true },
      );
    } catch (err) {
      await TestCase.deleteMany({ problemId: problem._id });
      await Problem.deleteOne({ _id: problem._id });
      throw err;
    }
  }
  return { problem, testCaseCount: parsedTestCases.length };
}
