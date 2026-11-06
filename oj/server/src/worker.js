import os from 'node:os';
import { env } from './config/env.js';
import './models.js';
import { DockerSandboxRunner } from './modules/judge/sandbox/DockerSandboxRunner.js';
import { FakeSandboxRunner } from './modules/judge/sandbox/FakeSandboxRunner.js';
import { MongoJobQueue } from './modules/judge/queue/MongoJobQueue.js';
import {
  handleJudgeFailure,
  judgeSubmission,
  removeStaleJudgeContainers,
} from './modules/judge/judge.service.js';
import { connectDb, disconnectDb } from './utils/db.js';
import { logger } from './utils/logger.js';

const workerId = `${os.hostname()}-${process.pid}`;
const queue = new MongoJobQueue();
const runner =
  env.SANDBOX_DRIVER === 'docker' ? new DockerSandboxRunner() : new FakeSandboxRunner();
let stopping = false;
let activeJobs = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processJob(job) {
  const heartbeat = setInterval(
    () => {
      queue
        .heartbeat(job._id, workerId)
        .then((alive) => {
          if (!alive) {
            logger.error(
              { event: 'judge.lease_lost', jobId: String(job._id) },
              'Judge worker no longer owns its job lease',
            );
          }
        })
        .catch((error) => {
          logger.error(
            { event: 'judge.heartbeat_failed', jobId: String(job._id), err: error },
            'Job heartbeat failed',
          );
        });
    },
    Math.max(1000, Math.floor((env.JUDGE_LEASE_SEC * 1000) / 3)),
  );
  heartbeat.unref();
  try {
    await judgeSubmission(job.submissionId, { runner, queue, job, workerId });
  } catch (error) {
    try {
      await handleJudgeFailure(job.submissionId, { job, queue, workerId, error });
    } catch (recoveryError) {
      logger.fatal(
        {
          event: 'judge.recovery_failed',
          jobId: String(job._id),
          submissionId: String(job.submissionId),
          err: recoveryError,
        },
        'Could not recover failed judge job',
      );
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function workerLoop() {
  while (!stopping) {
    if (activeJobs >= env.JUDGE_CONCURRENCY) {
      await sleep(100);
      continue;
    }
    const job = await queue.claim(workerId);
    if (!job) {
      await sleep(750);
      continue;
    }
    activeJobs += 1;
    processJob(job)
      .catch((error) => {
        logger.fatal(
          { event: 'judge.unhandled_job_error', jobId: String(job._id), err: error },
          'Unhandled judge job error',
        );
      })
      .finally(() => {
        activeJobs -= 1;
      });
  }
  while (activeJobs > 0) await sleep(100);
}

async function main() {
  await connectDb(env.MONGODB_URI);
  if (env.SANDBOX_DRIVER === 'docker') {
    await runner.assertReady();
    await removeStaleJudgeContainers();
    const janitor = setInterval(
      () => {
        removeStaleJudgeContainers().catch((error) => {
          logger.error(
            { event: 'judge.janitor_failed', err: error },
            'Judge container janitor failed',
          );
        });
      },
      3 * 60 * 1000,
    );
    janitor.unref();
  }

  logger.info(
    {
      event: 'judge.worker_started',
      workerId,
      concurrency: env.JUDGE_CONCURRENCY,
      driver: env.SANDBOX_DRIVER,
    },
    'Judge worker started',
  );
  const shutdown = (signal) => {
    logger.info({ event: 'judge.worker_shutdown', signal }, 'Stopping judge worker');
    stopping = true;
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await workerLoop();
  await disconnectDb();
}

main().catch(async (error) => {
  logger.fatal(
    { event: 'judge.worker_startup_failed', err: error },
    'Judge worker failed to start',
  );
  await disconnectDb();
  process.exitCode = 1;
});
