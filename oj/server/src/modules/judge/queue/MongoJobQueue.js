import { env } from '../../../config/env.js';
import { Job } from '../job.model.js';
import { Submission } from '../../submissions/submission.model.js';

const ACTIVE_STATES = ['COMPILING', 'RUNNING'];

export class MongoJobQueue {
  async enqueue(submissionId) {
    return Job.findOneAndUpdate(
      { submissionId },
      {
        $setOnInsert: { submissionId, type: 'judge', state: 'QUEUED' },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    ).lean();
  }

  async claim(workerId) {
    const now = new Date();
    await this.reapExpired();
    const job = await Job.findOneAndUpdate(
      {
        $or: [
          { state: 'QUEUED' },
          { state: { $in: ACTIVE_STATES }, leaseExpiresAt: { $lte: now } },
        ],
        attempts: { $lt: env.JUDGE_MAX_ATTEMPTS },
      },
      {
        $set: {
          state: 'COMPILING',
          lockedBy: workerId,
          leaseExpiresAt: new Date(now.getTime() + env.JUDGE_LEASE_SEC * 1000),
        },
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after' },
    ).lean();

    return job;
  }

  async heartbeat(jobId, workerId) {
    const result = await Job.updateOne(
      { _id: jobId, lockedBy: workerId, state: { $in: ACTIVE_STATES } },
      { $set: { leaseExpiresAt: new Date(Date.now() + env.JUDGE_LEASE_SEC * 1000) } },
    );
    return result.modifiedCount === 1;
  }

  async isOwned(jobId, workerId) {
    return Boolean(
      await Job.exists({ _id: jobId, lockedBy: workerId, state: { $in: ACTIVE_STATES } }),
    );
  }

  async setState(jobId, workerId, state) {
    return Job.findOneAndUpdate(
      { _id: jobId, lockedBy: workerId, state: { $in: ACTIVE_STATES } },
      {
        $set: {
          state,
          ...(state === 'RUNNING'
            ? { leaseExpiresAt: new Date(Date.now() + env.JUDGE_LEASE_SEC * 1000) }
            : {}),
        },
      },
      { returnDocument: 'after' },
    ).lean();
  }

  async finish(jobId, workerId, state) {
    return Job.findOneAndUpdate(
      { _id: jobId, lockedBy: workerId, state: { $in: ACTIVE_STATES } },
      {
        $set: {
          state,
          finishedAt: new Date(),
          leaseExpiresAt: null,
          lockedBy: null,
        },
      },
      { returnDocument: 'after' },
    ).lean();
  }

  async releaseForRetry(jobId, workerId) {
    const job = await Job.findOne({ _id: jobId, lockedBy: workerId }).lean();
    if (!job) return null;
    if (job.attempts >= env.JUDGE_MAX_ATTEMPTS) {
      return this.finish(jobId, workerId, 'ERROR');
    }
    return Job.findOneAndUpdate(
      { _id: jobId, lockedBy: workerId },
      {
        $set: {
          state: 'QUEUED',
          lockedBy: null,
          leaseExpiresAt: null,
        },
      },
      { returnDocument: 'after' },
    ).lean();
  }

  async reapExpired() {
    const now = new Date();
    const expiredJobs = await Job.find(
      {
        state: { $in: ACTIVE_STATES },
        leaseExpiresAt: { $lte: now },
        attempts: { $gte: env.JUDGE_MAX_ATTEMPTS },
      },
      { submissionId: 1 },
    ).lean();
    if (expiredJobs.length === 0) return;
    for (const job of expiredJobs) {
      const reaped = await Job.findOneAndUpdate(
        {
          _id: job._id,
          state: { $in: ACTIVE_STATES },
          leaseExpiresAt: { $lte: now },
          attempts: { $gte: env.JUDGE_MAX_ATTEMPTS },
        },
        {
          $set: {
            state: 'ERROR',
            finishedAt: now,
            leaseExpiresAt: null,
            lockedBy: null,
          },
        },
        { returnDocument: 'after' },
      ).lean();
      if (reaped) {
        await Submission.updateOne(
          {
            _id: reaped.submissionId,
            status: { $in: ['QUEUED', 'COMPILING', 'RUNNING'] },
          },
          { $set: { status: 'ERROR', verdict: 'ERROR', judgedAt: now } },
        );
      }
    }
  }

  async stats() {
    return Job.aggregate([{ $group: { _id: '$state', count: { $sum: 1 } } }]);
  }
}
