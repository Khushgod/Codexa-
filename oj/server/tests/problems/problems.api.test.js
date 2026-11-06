import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setUserRoleByEmail } from '../../src/modules/auth/auth.service.js';
import { Problem } from '../../src/modules/problems/problem.model.js';
import { importProblem } from '../../src/modules/problems/problem.service.js';
import { seedProblems } from '../../src/modules/problems/seed.service.js';
import { TestCase } from '../../src/modules/problems/testCase.model.js';
import { createApp } from '../../src/app.js';
import { useTestDb } from '../helpers/db.js';
import { newUser, signup } from '../helpers/auth.js';

useTestDb();

const app = createApp();
let fixtures;

const problemInput = (overrides = {}) => ({
  slug: 'admin-created-problem',
  title: 'Admin Created Problem',
  difficulty: 'Easy',
  tags: ['arrays'],
  statementMd: 'Find the requested value.',
  inputFormat: 'One integer.',
  outputFormat: 'Print the integer.',
  constraints: ['0 <= n <= 10'],
  timeLimitMs: 1000,
  memoryLimitMb: 128,
  checker: { type: 'token' },
  aiContext: {
    edgeCases: [],
    commonMistakes: [],
    directionHint: '',
    keyInsight: '',
    outline: '',
    canaries: [],
    reviewed: false,
    lintWarnings: [],
  },
  source: { type: 'original', url: '' },
  isPublished: false,
  ...overrides,
});

async function createAdminAuthorization() {
  const account = newUser();
  const created = await signup(app, account);
  expect(created.res.status).toBe(201);
  await setUserRoleByEmail(account.email, 'admin');
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: account.email, password: account.password });
  expect(login.status).toBe(200);
  return `Bearer ${login.body.data.accessToken}`;
}

beforeAll(async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const seedDir = path.resolve(currentDir, '../../seed/problems');
  const files = (await readdir(seedDir)).filter((file) => file.endsWith('.json')).sort();
  fixtures = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(path.join(seedDir, file), 'utf8'))),
  );
});

beforeEach(async () => {
  await seedProblems(
    fixtures.map((fixture) => ({
      ...fixture,
      problem: { ...fixture.problem, isPublished: true },
    })),
  );
});

describe('public problem routes', () => {
  it('lists only published problems with difficulty/tag filters and pagination', async () => {
    await Problem.updateOne({ slug: 'bracket-check' }, { $set: { isPublished: false } });

    const first = await request(app).get('/api/problems?tag=arrays&difficulty=Easy&page=1&limit=1');
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.data.items).toHaveLength(1);
    expect(first.body.data.items[0].slug).toBe('pair-signal');
    expect(first.body.data.items[0]).not.toHaveProperty('aiContext');
    expect(first.body.data.items[0]).not.toHaveProperty('source');
    expect(first.body.data.pagination).toEqual({ page: 1, limit: 1, total: 2, pages: 2 });

    const second = await request(app).get(
      '/api/problems?tag=arrays&difficulty=Easy&page=2&limit=1',
    );
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].slug).toBe('first-marker');
    expect(second.body.data.items.every((problem) => problem.slug !== 'bracket-check')).toBe(true);
  });

  it('validates filters and pagination values', async () => {
    const badPage = await request(app).get('/api/problems?page=0');
    expect(badPage.status).toBe(400);
    expect(badPage.body.error.code).toBe('VALIDATION_ERROR');

    const badDifficulty = await request(app).get('/api/problems?difficulty=impossible');
    expect(badDifficulty.status).toBe(400);
  });

  it('returns sample tests only and never includes hidden input or expected output', async () => {
    const fixture = fixtures.find(({ problem }) => problem.slug === 'pair-signal');
    const hiddenInputs = fixture.testCases
      .filter(({ isSample }) => !isSample)
      .map(({ input, expectedOutput }) => [input, expectedOutput]);

    const list = await request(app).get('/api/problems');
    const listJson = JSON.stringify(list.body);
    for (const [input, output] of hiddenInputs) {
      expect(listJson).not.toContain(input);
      expect(listJson).not.toContain(output);
    }

    const detail = await request(app).get('/api/problems/pair-signal');
    expect(detail.status).toBe(200);
    expect(detail.body.data.sampleTestCases).toHaveLength(2);
    expect(detail.body.data.sampleTestCases.every(({ isSample }) => isSample)).toBe(true);
    expect(detail.body.data).not.toHaveProperty('aiContext');
    const detailJson = JSON.stringify(detail.body);
    for (const [input, output] of hiddenInputs) {
      expect(detailJson).not.toContain(input);
      expect(detailJson).not.toContain(output);
    }
  });

  it('does not expose drafts and returns 404 for unknown slugs', async () => {
    await Problem.updateOne({ slug: 'pair-signal' }, { $set: { isPublished: false } });
    const list = await request(app).get('/api/problems');
    expect(list.body.data.items.some(({ slug }) => slug === 'pair-signal')).toBe(false);

    const detail = await request(app).get('/api/problems/pair-signal');
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe('NOT_FOUND');
    expect((await request(app).get('/api/problems/no-such-problem')).status).toBe(404);
  });
});

describe('admin problem and testcase routes', () => {
  it('requires admin authorization for every write route', async () => {
    const payload = problemInput();
    expect((await request(app).post('/api/problems').send(payload)).status).toBe(401);

    const user = newUser();
    const signedUp = await signup(app, user);
    const token = `Bearer ${signedUp.res.body.data.accessToken}`;
    const problemId = (await Problem.findOne({ slug: 'pair-signal' }))._id.toString();
    const testCaseId = (await TestCase.findOne({ problemId }))._id.toString();

    const forbiddenCreate = await request(app)
      .post('/api/problems')
      .set('Authorization', token)
      .send(payload);
    expect(forbiddenCreate.status).toBe(403);

    expect(
      (
        await request(app)
          .put(`/api/problems/${problemId}`)
          .set('Authorization', token)
          .send({ title: 'Changed' })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).delete(`/api/problems/${problemId}`).set('Authorization', token)).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/api/problems/${problemId}/testcases`).set('Authorization', token))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/problems/${problemId}/testcases`)
          .set('Authorization', token)
          .send({
            order: 20,
            input: '1\n',
            expectedOutput: '1\n',
            isSample: false,
            category: 'private-test',
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put(`/api/problems/${problemId}/testcases/${testCaseId}`)
          .set('Authorization', token)
          .send({
            order: 1,
            input: '1\n',
            expectedOutput: '1\n',
            isSample: true,
            category: 'sample',
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete(`/api/problems/${problemId}/testcases/${testCaseId}`)
          .set('Authorization', token)
      ).status,
    ).toBe(403);
  });

  it('creates a draft, rejects duplicate slugs, updates it, and unpublishes on delete', async () => {
    const authorization = await createAdminAuthorization();
    const created = await request(app)
      .post('/api/problems')
      .set('Authorization', authorization)
      .send(problemInput({ isPublished: true }));
    expect(created.status).toBe(201);
    expect(created.body.data.problem.slug).toBe('admin-created-problem');

    const duplicate = await request(app)
      .post('/api/problems')
      .set('Authorization', authorization)
      .send(problemInput());
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    const updated = await request(app)
      .put(`/api/problems/${created.body.data.problem._id}`)
      .set('Authorization', authorization)
      .send({ title: 'Updated title' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.problem.title).toBe('Updated title');

    const adminList = await request(app)
      .get('/api/problems/admin/list?tag=arrays&limit=2')
      .set('Authorization', authorization);
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.pagination.total).toBeGreaterThan(0);

    const removed = await request(app)
      .delete(`/api/problems/${created.body.data.problem._id}`)
      .set('Authorization', authorization);
    expect(removed.status).toBe(200);
    expect(removed.body.data.problem.isPublished).toBe(false);
    expect(await Problem.countDocuments({ slug: 'admin-created-problem' })).toBe(1);
  });

  it('validates create/update payloads and object identifiers', async () => {
    const authorization = await createAdminAuthorization();
    const invalidBody = await request(app)
      .post('/api/problems')
      .set('Authorization', authorization)
      .send({ ...problemInput(), isPublished: 'yes', injected: true });
    expect(invalidBody.status).toBe(400);
    expect(invalidBody.body.error.code).toBe('VALIDATION_ERROR');

    const invalidId = await request(app)
      .put('/api/problems/not-an-id')
      .set('Authorization', authorization)
      .send({ title: 'Changed' });
    expect(invalidId.status).toBe(400);
  });

  it('creates, lists, updates and deletes admin-only test cases', async () => {
    const authorization = await createAdminAuthorization();
    const problemId = (await Problem.findOne({ slug: 'pair-signal' }))._id.toString();
    const created = await request(app)
      .post(`/api/problems/${problemId}/testcases`)
      .set('Authorization', authorization)
      .send({
        order: 20,
        input: '1\n',
        expectedOutput: '1\n',
        isSample: false,
        category: 'admin-added',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.testCase.weight).toBe(1);

    const duplicateOrder = await request(app)
      .post(`/api/problems/${problemId}/testcases`)
      .set('Authorization', authorization)
      .send({
        order: 20,
        input: 'duplicate\n',
        expectedOutput: 'duplicate\n',
        isSample: false,
        category: 'duplicate-order',
      });
    expect(duplicateOrder.status).toBe(409);

    const listed = await request(app)
      .get(`/api/problems/${problemId}/testcases`)
      .set('Authorization', authorization);
    expect(listed.status).toBe(200);
    expect(listed.body.data.testCases).toHaveLength(10);
    expect(
      listed.body.data.testCases.find(({ category }) => category === 'admin-added'),
    ).toBeTruthy();

    const updated = await request(app)
      .put(`/api/problems/${problemId}/testcases/${created.body.data.testCase._id}`)
      .set('Authorization', authorization)
      .send({
        order: 20,
        input: '2\n',
        expectedOutput: '2\n',
        isSample: false,
        category: 'admin-updated',
        weight: 2,
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.testCase.category).toBe('admin-updated');

    const deleted = await request(app)
      .delete(`/api/problems/${problemId}/testcases/${created.body.data.testCase._id}`)
      .set('Authorization', authorization);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toBe(true);

    const fileBacked = await request(app)
      .post(`/api/problems/${problemId}/testcases`)
      .set('Authorization', authorization)
      .send({
        order: 21,
        fileRef: 'cases/large-input',
        sha256: 'a'.repeat(64),
        expectedOutput: 'expected\n',
        isSample: false,
        category: 'large-file',
      });
    expect(fileBacked.status).toBe(201);

    const missingFileOutput = await request(app)
      .post(`/api/problems/${problemId}/testcases`)
      .set('Authorization', authorization)
      .send({
        order: 22,
        fileRef: 'cases/missing-output',
        sha256: 'c'.repeat(64),
        isSample: false,
        category: 'missing-output',
      });
    expect(missingFileOutput.status).toBe(400);

    const switchedToInline = await request(app)
      .put(`/api/problems/${problemId}/testcases/${fileBacked.body.data.testCase._id}`)
      .set('Authorization', authorization)
      .send({
        order: 21,
        input: '',
        expectedOutput: 'OK\n',
        isSample: false,
        category: 'inline-empty-input',
      });
    expect(switchedToInline.status).toBe(200);
    expect(switchedToInline.body.data.testCase.fileRef).toBeUndefined();
    expect(switchedToInline.body.data.testCase.input).toBe('');

    const switchedToFile = await request(app)
      .put(`/api/problems/${problemId}/testcases/${fileBacked.body.data.testCase._id}`)
      .set('Authorization', authorization)
      .send({
        order: 21,
        fileRef: 'cases/another-input',
        sha256: 'b'.repeat(64),
        expectedOutput: 'expected\n',
        isSample: false,
        category: 'large-file',
      });
    expect(switchedToFile.status).toBe(200);
    expect(switchedToFile.body.data.testCase.input).toBeUndefined();
  });

  it('imports fixture-shaped JSON as unpublished scraped content', async () => {
    const fixture = fixtures[0];
    const result = await importProblem({
      ...fixture,
      problem: { ...fixture.problem, slug: 'imported-scraped-problem' },
    });
    expect(result.problem.source.type).toBe('scraped');
    expect(result.problem.isPublished).toBe(false);
    expect(result.testCaseCount).toBe(fixture.testCases.length);
    expect(await TestCase.countDocuments({ problemId: result.problem._id })).toBe(
      fixture.testCases.length,
    );
  });

  it('rejects malformed import documents before creating a problem', async () => {
    await expect(importProblem({ testCases: [] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      httpStatus: 400,
    });
    expect(await Problem.countDocuments({ slug: 'undefined' })).toBe(0);
  });
});
