import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { Job } from '../../src/modules/judge/job.model.js';
import { Problem } from '../../src/modules/problems/problem.model.js';
import { seedProblems } from '../../src/modules/problems/seed.service.js';
import { judgeSubmission } from '../../src/modules/judge/judge.service.js';
import { FakeSandboxRunner } from '../../src/modules/judge/sandbox/FakeSandboxRunner.js';
import { MongoJobQueue } from '../../src/modules/judge/queue/MongoJobQueue.js';
import { Submission } from '../../src/modules/submissions/submission.model.js';
import { User } from '../../src/modules/auth/user.model.js';
import { useTestDb } from '../helpers/db.js';
import { newUser, signup } from '../helpers/auth.js';

useTestDb();

const app = createApp();
let fixture;

async function authorize() {
  const account = newUser();
  const created = await signup(app, account);
  expect(created.res.status).toBe(201);
  return {
    userId: created.res.body.data.user.id,
    headers: { Authorization: `Bearer ${created.res.body.data.accessToken}` },
  };
}

beforeAll(async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const fixturePath = fileURLToPath(
    new URL('../../seed/problems/pair-signal.json', import.meta.url),
  );
  fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
});

beforeEach(async () => {
  await seedProblems([{ ...fixture, problem: { ...fixture.problem, isPublished: true } }]);
});

describe('submission API', () => {
  it('requires authentication and validates source and language', async () => {
    const problem = await Problem.findOne({ slug: 'pair-signal' }).lean();
    const unauthenticated = await request(app)
      .post('/api/submissions')
      .send({ problemId: problem._id, language: 'cpp', code: 'int main(){}', mode: 'submit' });
    expect(unauthenticated.status).toBe(401);

    const { headers } = await authorize();
    const invalid = await request(app)
      .post('/api/submissions')
      .set(headers)
      .send({ problemId: problem._id, language: 'ruby', code: 'puts 1', mode: 'submit' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('queues an authenticated submit and never returns source code or hidden test data', async () => {
    const { headers, userId } = await authorize();
    const problem = await Problem.findOne({ slug: 'pair-signal' }).lean();
    const response = await request(app)
      .post('/api/submissions')
      .set(headers)
      .send({
        problemId: String(problem._id),
        language: 'cpp',
        code: '#include <iostream>\nint main() { return 0; }',
        mode: 'submit',
      });

    expect(response.status).toBe(202);
    expect(response.body.data.submission.status).toBe('QUEUED');
    expect(response.body.data.submission).not.toHaveProperty('code');
    expect(response.body.data.submission).not.toHaveProperty('codeHash');
    expect(response.body.data.statusUrl).toBe(
      `/api/submissions/${response.body.data.submission._id}`,
    );
    expect(await Job.countDocuments({ submissionId: response.body.data.submission._id })).toBe(1);

    const poll = await request(app).get(response.body.data.statusUrl).set(headers);
    expect(poll.status).toBe(200);
    expect(poll.body.data).not.toHaveProperty('code');
    expect(poll.body.data.userId).toBeUndefined();
    expect(poll.body.data.problemId.slug).toBe('pair-signal');
    expect(poll.body.data.perTest).toEqual([]);

    const history = await request(app).get('/api/submissions/mine?page=1&limit=5').set(headers);
    expect(history.status).toBe(200);
    expect(history.body.data.items).toHaveLength(1);
    expect(history.body.data.items[0]).not.toHaveProperty('code');

    const stored = await Submission.findById(response.body.data.submission._id).lean();
    expect(stored.userId.toString()).toBe(userId);
    expect(stored.code).toContain('#include');
  });

  it('runs samples only and does not return submissions belonging to another user', async () => {
    const owner = await authorize();
    const other = await authorize();
    const problem = await Problem.findOne({ slug: 'pair-signal' }).lean();
    const run = await request(app)
      .post('/api/submissions')
      .set(owner.headers)
      .send({
        problemId: String(problem._id),
        language: 'python',
        code: 'print(1)',
        mode: 'run',
      });

    expect(run.status).toBe(202);
    const stored = await Submission.findById(run.body.data.submission._id).lean();
    expect(stored.mode).toBe('run');
    expect(stored.status).toBe('QUEUED');

    const forbidden = await request(app).get(run.body.data.statusUrl).set(other.headers);
    expect(forbidden.status).toBe(404);
    const otherHistory = await request(app).get('/api/submissions/mine').set(other.headers);
    expect(otherHistory.body.data.items).toEqual([]);
  });

  it('judges Run against samples only and Submit against all cases', async () => {
    const { headers, userId } = await authorize();
    const problem = await Problem.findOne({ slug: 'pair-signal' }).lean();
    const queue = new MongoJobQueue();
    const run = await request(app)
      .post('/api/submissions')
      .set(headers)
      .send({
        problemId: String(problem._id),
        language: 'cpp',
        code: 'int main() {}',
        mode: 'run',
      });
    const runJob = await queue.claim('worker-run');
    const runRunner = new FakeSandboxRunner({
      runs: [
        { exit: 0, cpuMs: 950, memKb: 1024, stdout: '0 1\n' },
        { exit: 0, cpuMs: 500, memKb: 1024, stdout: '0 1\n' },
        { exit: 0, cpuMs: 2, memKb: 1024, stdout: '0 3\n' },
      ],
    });
    await judgeSubmission(run.body.data.submission._id, {
      runner: runRunner,
      queue,
      job: runJob,
      workerId: 'worker-run',
    });
    const runResult = await request(app).get(run.body.data.statusUrl).set(headers);
    expect(runRunner.runIndex).toBe(3);
    expect(runResult.body.data).toMatchObject({ status: 'DONE', verdict: 'AC' });
    expect(runResult.body.data.sampleResults).toHaveLength(2);
    expect(runResult.body.data.sampleResults[0].output).toBe('0 1\n');
    expect(runResult.body.data.perTest[0].runtimeMs).toBe(500);

    const submit = await request(app)
      .post('/api/submissions')
      .set(headers)
      .send({
        problemId: String(problem._id),
        language: 'cpp',
        code: 'int main() {}',
        mode: 'submit',
      });
    const submitJob = await queue.claim('worker-submit');
    const submitRunner = new FakeSandboxRunner({
      runs: fixture.testCases.map((testCase) => ({
        exit: 0,
        cpuMs: 2,
        memKb: 1024,
        stdout: testCase.expectedOutput,
      })),
    });
    await judgeSubmission(submit.body.data.submission._id, {
      runner: submitRunner,
      queue,
      job: submitJob,
      workerId: 'worker-submit',
    });
    const submitResult = await request(app).get(submit.body.data.statusUrl).set(headers);
    expect(submitRunner.runIndex).toBe(fixture.testCases.length);
    expect(submitResult.body.data).toMatchObject({ status: 'DONE', verdict: 'AC' });
    expect(submitResult.body.data.perTest).toHaveLength(fixture.testCases.length);
    expect(submitResult.body.data).not.toHaveProperty('code');
    expect(submitResult.body.data).not.toHaveProperty('expectedOutput');
    expect(submitResult.body.data).not.toHaveProperty('input');
    expect(await User.findById(userId).select('stats').lean()).toMatchObject({
      stats: { attempts: 1, solved: 1 },
    });
  });

  it('rejects submissions for unpublished problems', async () => {
    await Problem.updateOne({ slug: 'pair-signal' }, { $set: { isPublished: false } });
    const { headers } = await authorize();
    const problem = await Problem.findOne({ slug: 'pair-signal' }).lean();
    const response = await request(app)
      .post('/api/submissions')
      .set(headers)
      .send({
        problemId: String(problem._id),
        language: 'python',
        code: 'print(1)',
        mode: 'submit',
      });
    expect(response.status).toBe(404);
    expect(await Submission.countDocuments()).toBe(0);
  });
});
