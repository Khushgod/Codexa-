import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { AiConversation } from '../../src/modules/ai/aiConversation.model.js';
import { Job } from '../../src/modules/judge/job.model.js';
import { Problem } from '../../src/modules/problems/problem.model.js';
import { seedProblems } from '../../src/modules/problems/seed.service.js';
import { TestCase } from '../../src/modules/problems/testCase.model.js';
import { Submission } from '../../src/modules/submissions/submission.model.js';
import { useTestDb } from '../helpers/db.js';

useTestDb();

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(currentDir, '../../seed/problems');
const seedRoot = path.resolve(currentDir, '../../seed');
let fixtures;

beforeAll(async () => {
  const files = (await readdir(seedDir)).filter((file) => file.endsWith('.json')).sort();
  fixtures = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(path.join(seedDir, file), 'utf8'))),
  );
});

describe('M3 MongoDB models', () => {
  it('registers the HLD collections and required indexes', async () => {
    expect(Problem.collection.collectionName).toBe('problems');
    expect(TestCase.collection.collectionName).toBe('testcases');
    expect(Submission.collection.collectionName).toBe('submissions');
    expect(Job.collection.collectionName).toBe('jobs');
    expect(AiConversation.collection.collectionName).toBe('aiConversations');

    const problemIndexes = await Problem.collection.indexes();
    const testcaseIndexes = await TestCase.collection.indexes();
    const submissionIndexes = await Submission.collection.indexes();
    const jobIndexes = await Job.collection.indexes();

    expect(problemIndexes).toContainEqual(
      expect.objectContaining({ key: { slug: 1 }, unique: true }),
    );
    expect(testcaseIndexes).toContainEqual(
      expect.objectContaining({ key: { problemId: 1, order: 1 }, unique: true }),
    );
    expect(submissionIndexes.map(({ key }) => key)).toEqual(
      expect.arrayContaining([
        { userId: 1, createdAt: -1 },
        { problemId: 1, verdict: 1 },
        { userId: 1, problemId: 1, codeHash: 1 },
      ]),
    );
    expect(jobIndexes).toContainEqual(
      expect.objectContaining({
        key: { finishedAt: 1 },
        expireAfterSeconds: 30 * 24 * 60 * 60,
      }),
    );
    expect(jobIndexes).toContainEqual(
      expect.objectContaining({ key: { state: 1, leaseExpiresAt: 1 } }),
    );
  });

  it('applies safe defaults and rejects invalid difficulty and hint levels', async () => {
    const problem = new Problem({
      slug: 'model-check',
      title: 'Model Check',
      difficulty: 'Easy',
      statementMd: 'A statement.',
      inputFormat: 'Input.',
      outputFormat: 'Output.',
      timeLimitMs: 1000,
      memoryLimitMb: 128,
    });
    await problem.validate();
    expect(problem.isPublished).toBe(false);
    expect(problem.aiContext.reviewed).toBe(false);
    expect(problem.source.type).toBe('original');

    const badProblem = new Problem({
      slug: 'bad',
      title: 'Bad',
      difficulty: 'Impossible',
      statementMd: 'A statement.',
      inputFormat: 'Input.',
      outputFormat: 'Output.',
      timeLimitMs: 1000,
      memoryLimitMb: 128,
      aiContext: { canaries: [{ phrase: 'not an allowed level', level: 2 }] },
    });
    await expect(badProblem.validate()).rejects.toThrow();
  });

  it('supports either inline testcase content or a hashed file reference', async () => {
    const problemId = new mongoose.Types.ObjectId();
    await expect(
      new TestCase({
        problemId,
        order: 1,
        input: '1\n',
        expectedOutput: '1\n',
        category: 'sample',
      }).validate(),
    ).resolves.toBeUndefined();

    await expect(
      new TestCase({
        problemId,
        order: 2,
        input: '',
        expectedOutput: 'YES\n',
        category: 'empty-input',
      }).validate(),
    ).resolves.toBeUndefined();

    await expect(
      new TestCase({
        problemId,
        order: 3,
        fileRef: 'cases/large-1',
        sha256: 'a'.repeat(64),
        expectedOutput: 'expected\n',
        category: 'large-case',
      }).validate(),
    ).resolves.toBeUndefined();

    await expect(
      new TestCase({
        problemId,
        order: 4,
        fileRef: 'cases/missing-hash',
        category: 'invalid-file-reference',
      }).validate(),
    ).rejects.toThrow();

    await expect(
      new TestCase({
        problemId,
        order: 6,
        fileRef: 'cases/missing-output',
        sha256: 'c'.repeat(64),
        category: 'missing-output',
      }).validate(),
    ).rejects.toThrow();

    await expect(
      new TestCase({
        problemId,
        order: 7,
        fileRef: 'cases/public-sample',
        sha256: 'd'.repeat(64),
        expectedOutput: 'sample\n',
        isSample: true,
        category: 'file-backed-sample',
      }).validate(),
    ).rejects.toThrow();

    await expect(
      new TestCase({
        problemId,
        order: 5,
        fileRef: '../outside-input',
        sha256: 'b'.repeat(64),
        category: 'unsafe-file-reference',
      }).validate(),
    ).rejects.toThrow();
  });

  it('validates submission tracking fields and level-tags tutor history', async () => {
    const userId = new mongoose.Types.ObjectId();
    const problemId = new mongoose.Types.ObjectId();
    const submission = new Submission({
      userId,
      problemId,
      language: 'python',
      code: 'print(1)',
      codeHash: 'a'.repeat(64),
    });
    await submission.validate();
    expect(submission.status).toBe('QUEUED');
    expect(submission.countsForHints).toBe(true);

    const job = new Job({ submissionId: submission._id });
    await job.validate();
    expect(job.state).toBe('QUEUED');
    expect(job.attempts).toBe(0);

    const conversation = new AiConversation({
      userId,
      problemId,
      messages: [{ role: 'assistant', content: 'Consider a small example.', level: 1 }],
      summary: { text: 'Discussed an edge case.', level: 1 },
    });
    await conversation.validate();
    expect(conversation.hintLevelUnlocked).toBe(1);

    conversation.messages[0].level = 5;
    await expect(conversation.validate()).rejects.toThrow();
  });
});

describe('M3 seed data', () => {
  it('contains five original problems with edge-rich tests, canaries, and reference variants', async () => {
    expect(fixtures).toHaveLength(5);
    for (const fixture of fixtures) {
      expect(fixture.testCases.length).toBeGreaterThanOrEqual(8);
      expect(fixture.testCases.length).toBeLessThanOrEqual(15);
      expect(fixture.testCases.every((testCase) => testCase.category)).toBe(true);
      expect(fixture.testCases.some((testCase) => testCase.isSample)).toBe(true);
      expect(
        fixture.testCases.some((testCase) =>
          ['large-n', 'large-nesting', 'large-values'].includes(testCase.category),
        ),
      ).toBe(true);
      expect(fixture.problem.source.type).toBe('original');
      expect(fixture.problem.isPublished).toBe(false);
      expect(fixture.problem.aiContext.reviewed).toBe(false);
      expect(fixture.problem.aiContext.canaries).toHaveLength(2);
      expect(fixture.problem.aiContext.canaries.map(({ level }) => level)).toEqual([3, 4]);
      expect(fixture.problem.aiContext.keyInsight).toContain(
        fixture.problem.aiContext.canaries[0].phrase,
      );
      expect(fixture.problem.aiContext.outline).toContain(
        fixture.problem.aiContext.canaries[1].phrase,
      );

      for (const relativePath of Object.values(fixture.referenceSolutions)) {
        const absolutePath = path.resolve(seedRoot, relativePath);
        expect(absolutePath.startsWith(`${seedRoot}${path.sep}`)).toBe(true);
        await expect(readFile(absolutePath)).resolves.toBeInstanceOf(Buffer);
      }
    }
  });

  it('seeds and re-seeds problems and test cases without duplicates', async () => {
    const first = await seedProblems(fixtures);
    expect(first).toEqual({ problems: 5, testCases: 44 });

    const second = await seedProblems(fixtures);
    expect(second).toEqual(first);
    expect(await Problem.countDocuments()).toBe(5);
    expect(await TestCase.countDocuments()).toBe(44);
    expect(await Problem.countDocuments({ isPublished: true })).toBe(0);
    expect(await TestCase.countDocuments({ category: 'large-n' })).toBe(3);
    const expandedStressCase = await TestCase.findOne({ category: 'large-n' });
    expect(expandedStressCase.input.length).toBeGreaterThan(30_000);
  });

  it('rejects duplicate seed slugs before writing any data', async () => {
    const duplicateFixtures = [...fixtures, fixtures[0]];
    await expect(seedProblems(duplicateFixtures)).rejects.toThrow(/duplicate problem slugs/i);
    expect(await Problem.countDocuments()).toBe(0);
  });
});
