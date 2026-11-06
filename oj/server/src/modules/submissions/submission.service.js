import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import * as authService from '../auth/auth.service.js';
import { enqueueJudgeJob } from '../judge/queue/queue.service.js';
import { AppError, notFound } from '../../utils/AppError.js';
import * as problemService from '../problems/problem.service.js';
import { Submission } from './submission.model.js';
import { HintAttempt } from './hintAttempt.model.js';
import { env } from '../../config/env.js';

function stripCommentsAndWhitespace(code, language) {
  let output = '';
  let state = 'code';
  let quoteEnd = '';
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    const next = code[index + 1];
    if (state === 'line-comment') {
      if (char === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 1;
      }
      continue;
    }
    if (state === 'string') {
      if (code.startsWith(quoteEnd, index)) {
        output += quoteEnd;
        index += quoteEnd.length - 1;
        state = 'code';
        continue;
      }
      output += char;
      if (char === '\\' && next) {
        output += next;
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      state = 'line-comment';
      index += 1;
    } else if (char === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
    } else if (language === 'python' && char === '#') {
      state = 'line-comment';
    } else if (char === '"' || char === "'" || char === '`') {
      quoteEnd =
        language === 'python' && code.slice(index, index + 3) === char.repeat(3)
          ? char.repeat(3)
          : char;
      state = 'string';
      output += quoteEnd;
      index += quoteEnd.length - 1;
    } else if (!/\s/.test(char)) {
      output += char;
    }
  }
  const tokens =
    output.match(
      /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_]\w*|\d+(?:\.\d+)?|(?:==|!=|<=|>=|&&|\|\||\+\+|--|->|::|\+=|-=|\*=|\/=|%=|<<|>>)|[^\s]/g,
    ) ?? [];
  return tokens.join('\u001f');
}

function hashCode(code, language) {
  return createHash('sha256').update(stripCommentsAndWhitespace(code, language)).digest('hex');
}

function toPublicSubmission(submission) {
  const value = typeof submission.toObject === 'function' ? submission.toObject() : submission;
  const safe = { ...value };
  delete safe.code;
  delete safe.codeHash;
  delete safe.userId;
  return safe;
}

export async function createSubmission(userId, input) {
  const bundle = await problemService.getProblemForJudging(input.problemId, {
    publishedOnly: true,
  });
  if (!bundle) throw notFound('Published problem not found');
  const { problem } = bundle;
  const testCases =
    input.mode === 'run'
      ? bundle.testCases.filter((testCase) => testCase.isSample)
      : bundle.testCases;
  if (testCases.length === 0) {
    throw new AppError(
      'NO_TEST_CASES',
      409,
      input.mode === 'run'
        ? 'This problem has no sample cases to run.'
        : 'This problem has no test cases configured.',
    );
  }

  const submission = await Submission.create({
    userId,
    problemId: problem._id,
    language: input.language,
    code: input.code,
    codeHash: hashCode(input.code, input.language),
    mode: input.mode,
    countsForHints: false,
  });

  try {
    await enqueueJudgeJob(submission._id);
  } catch (error) {
    await Submission.updateOne(
      { _id: submission._id },
      { $set: { status: 'ERROR', verdict: 'ERROR', judgedAt: new Date() } },
    );
    throw error;
  }

  return {
    submission: toPublicSubmission(submission),
    problem,
    testCases,
  };
}

export async function getSubmissionForUser(userId, submissionId) {
  if (!mongoose.isValidObjectId(submissionId)) throw notFound('Submission not found');
  const submission = await Submission.findOne({ _id: submissionId, userId })
    .populate({ path: 'problemId', select: 'slug title' })
    .lean();
  if (!submission) throw notFound('Submission not found');
  return toPublicSubmission(submission);
}

export async function listSubmissionsForUser(userId, { problemId, page, limit }) {
  const filter = { userId };
  if (problemId) filter.problemId = problemId;
  const [items, total] = await Promise.all([
    Submission.find(filter)
      .select(
        'problemId language mode status verdict runtimeMs memoryKb failedTestIndex failedCategory compileLog sampleResults createdAt judgedAt',
      )
      .populate({ path: 'problemId', select: 'slug title' })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Submission.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function markSubmissionCompiling(submissionId) {
  return Submission.findByIdAndUpdate(
    submissionId,
    { $set: { status: 'COMPILING' } },
    { returnDocument: 'after' },
  );
}

export async function getSubmissionForJudging(submissionId) {
  const submission = await Submission.findById(submissionId).lean();
  if (!submission) return null;
  const problemBundle = await problemService.getProblemForJudging(submission.problemId);
  return { submission, ...problemBundle };
}

export async function requeueSubmission(submissionId) {
  return Submission.updateOne(
    { _id: submissionId, status: { $in: ['COMPILING', 'RUNNING'] } },
    { $set: { status: 'QUEUED' } },
  );
}

export async function markSubmissionRunning(submissionId) {
  return Submission.findByIdAndUpdate(
    submissionId,
    { $set: { status: 'RUNNING' } },
    { returnDocument: 'after' },
  );
}

export async function finishSubmission(submissionId, result) {
  const update = {
    status: result.internalError ? 'ERROR' : 'DONE',
    verdict: result.verdict,
    perTest: result.perTest ?? [],
    judgedAt: new Date(),
  };
  if (Number.isFinite(result.runtimeMs)) update.runtimeMs = result.runtimeMs;
  if (Number.isFinite(result.memoryKb)) update.memoryKb = result.memoryKb;
  if (Number.isInteger(result.failedTestIndex)) update.failedTestIndex = result.failedTestIndex;
  if (result.failedCategory) update.failedCategory = result.failedCategory;
  if (typeof result.compileLog === 'string') update.compileLog = result.compileLog.slice(0, 4096);
  if (Array.isArray(result.sampleResults)) update.sampleResults = result.sampleResults;
  const submission = await Submission.findOneAndUpdate(
    { _id: submissionId, status: { $in: ['QUEUED', 'COMPILING', 'RUNNING'] } },
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  );
  if (!submission) return Submission.findById(submissionId);
  if (
    submission.mode === 'submit' &&
    ['WA', 'TLE', 'MLE', 'RE', 'OLE'].includes(result.verdict) &&
    stripCommentsAndWhitespace(submission.code, submission.language).replaceAll('\u001f', '')
      .length >= env.AI_MIN_ATTEMPT_CHARS
  ) {
    try {
      await HintAttempt.create({
        userId: submission.userId,
        problemId: submission.problemId,
        submissionId: submission._id,
        codeHash: submission.codeHash,
      });
      await Submission.updateOne({ _id: submission._id }, { $set: { countsForHints: true } });
      submission.countsForHints = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  if (submission.mode === 'submit' && !result.internalError) {
    await authService.recordSubmissionOutcome(
      String(submission.userId),
      String(submission.problemId),
      result.verdict,
    );
  }
  return submission;
}

export async function getTutorSubmissionContext(userId, problemId) {
  const [countedAttemptRows, legacyAttempts, latest] = await Promise.all([
    HintAttempt.find({ userId, problemId }).populate('submissionId', 'code language'),
    Submission.find({
      userId,
      problemId,
      mode: 'submit',
      countsForHints: true,
      verdict: { $in: ['WA', 'TLE', 'MLE', 'RE', 'OLE'] },
    }).select('codeHash code'),
    Submission.findOne({ userId, problemId, mode: 'submit' })
      .where({ status: { $in: ['DONE', 'ERROR'] } })
      .select('code verdict status failedCategory')
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  const eligibleHashes = new Set();
  for (const attempt of countedAttemptRows) {
    const submission = attempt.submissionId;
    if (
      submission &&
      stripCommentsAndWhitespace(submission.code, submission.language).replaceAll('\u001f', '')
        .length >= env.AI_MIN_ATTEMPT_CHARS
    ) {
      eligibleHashes.add(stripCommentsAndWhitespace(submission.code, submission.language));
    }
  }
  for (const submission of legacyAttempts) {
    if (
      stripCommentsAndWhitespace(submission.code, submission.language).replaceAll('\u001f', '')
        .length >= env.AI_MIN_ATTEMPT_CHARS
    ) {
      eligibleHashes.add(stripCommentsAndWhitespace(submission.code, submission.language));
    }
  }
  return {
    countedAttempts: eligibleHashes.size,
    lastVerdict:
      latest?.status === 'DONE' ? latest.verdict : latest?.status === 'ERROR' ? 'ERROR' : '',
    failedCategory: latest?.status === 'DONE' ? (latest.failedCategory ?? '') : '',
    latestCode: latest?.code ?? '',
  };
}

export async function markSubmissionError(submissionId) {
  return finishSubmission(submissionId, { internalError: true, verdict: 'ERROR' });
}
