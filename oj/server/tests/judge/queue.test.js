import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Job } from '../../src/modules/judge/job.model.js';
import { MongoJobQueue } from '../../src/modules/judge/queue/MongoJobQueue.js';
import { Submission } from '../../src/modules/submissions/submission.model.js';
import { useTestDb } from '../helpers/db.js';

useTestDb();

describe('MongoJobQueue', () => {
  it('enqueues idempotently and claims a job with a lease', async () => {
    const queue = new MongoJobQueue();
    const submissionId = new Types.ObjectId();
    const first = await queue.enqueue(submissionId);
    const second = await queue.enqueue(submissionId);
    expect(first._id.toString()).toBe(second._id.toString());

    const claimed = await queue.claim('worker-a');
    expect(claimed.state).toBe('COMPILING');
    expect(claimed.lockedBy).toBe('worker-a');
    expect(claimed.attempts).toBe(1);
    expect(claimed.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not let another worker heartbeat or finish a claimed job', async () => {
    const queue = new MongoJobQueue();
    const job = await queue.enqueue(new Types.ObjectId());
    const claimed = await queue.claim('worker-a');
    expect(await queue.heartbeat(claimed._id, 'worker-a')).toBe(true);
    expect(await queue.heartbeat(claimed._id, 'worker-b')).toBe(false);
    expect(await queue.finish(claimed._id, 'worker-b', 'DONE')).toBeNull();
    expect(await queue.finish(claimed._id, 'worker-a', 'DONE')).toMatchObject({ state: 'DONE' });
    expect(await Job.findById(job._id).lean()).toMatchObject({ state: 'DONE', lockedBy: null });
  });

  it('atomically grants a queued job to only one concurrent worker', async () => {
    const queue = new MongoJobQueue();
    await queue.enqueue(new Types.ObjectId());
    const claims = await Promise.all([queue.claim('worker-a'), queue.claim('worker-b')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('reclaims expired leases and increments attempt count', async () => {
    const queue = new MongoJobQueue();
    const created = await queue.enqueue(new Types.ObjectId());
    const claimed = await queue.claim('worker-crashed');
    await Job.updateOne(
      { _id: created._id },
      { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } },
    );
    const retried = await queue.claim('worker-retry');
    expect(retried._id.toString()).toBe(claimed._id.toString());
    expect(retried.attempts).toBe(2);
    expect(retried.lockedBy).toBe('worker-retry');
  });

  it('marks exhausted expired jobs and their submissions as internal errors', async () => {
    const queue = new MongoJobQueue();
    const submission = await Submission.create({
      userId: new Types.ObjectId(),
      problemId: new Types.ObjectId(),
      language: 'cpp',
      code: 'int main() {}',
      codeHash: 'a'.repeat(64),
      mode: 'submit',
    });
    const job = await queue.enqueue(submission._id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimed = await queue.claim('worker-retrying');
      expect(claimed._id.toString()).toBe(job._id.toString());
      if (attempt < 2) await queue.releaseForRetry(claimed._id, 'worker-retrying');
    }
    await Job.updateOne(
      { _id: job._id },
      { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } },
    );

    await queue.reapExpired();

    expect(await Job.findById(job._id).lean()).toMatchObject({ state: 'ERROR', lockedBy: null });
    expect(await Submission.findById(submission._id).lean()).toMatchObject({
      status: 'ERROR',
      verdict: 'ERROR',
    });
  });
});
