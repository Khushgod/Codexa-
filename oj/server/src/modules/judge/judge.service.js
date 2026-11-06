import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import * as submissionService from '../submissions/submission.service.js';
import { aggregateVerdict, resolveTestVerdict } from './verdict.js';
import { compareOutput } from './compare.js';
import { limitsFor } from './languages/index.js';

const SEED_ROOT = fileURLToPath(new URL('../../../seed/', import.meta.url));
const MAX_CASE_INPUT_BYTES = 1_000_000;

export async function loadTestInput(testCase) {
  if (typeof testCase.input === 'string') return testCase.input;
  if (!testCase.fileRef || !testCase.sha256) {
    throw new Error('Test case is missing its input source.');
  }
  const root = await realpath(SEED_ROOT);
  const requestedPath = path.resolve(root, testCase.fileRef);
  const resolvedPath = await realpath(requestedPath);
  const relativePath = path.relative(root, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Test case input reference resolves outside the seed directory.');
  }
  const fileInfo = await stat(resolvedPath);
  if (!fileInfo.isFile() || fileInfo.size > MAX_CASE_INPUT_BYTES) {
    throw new Error('Test case input file is missing or exceeds the supported size.');
  }
  const input = await readFile(resolvedPath);
  const actualHash = createHash('sha256').update(input).digest('hex');
  const expectedHash = Buffer.from(testCase.sha256.toLowerCase(), 'hex');
  const actualHashBytes = Buffer.from(actualHash, 'hex');
  if (
    expectedHash.length !== actualHashBytes.length ||
    !timingSafeEqual(expectedHash, actualHashBytes)
  ) {
    throw new Error('Test case input checksum does not match.');
  }
  return input.toString('utf8');
}

function temporaryInputPath(directory, name) {
  return path.join(directory, `${name}.txt`);
}

function safeRunResult(result, outputMatches) {
  return {
    ...result,
    outputMatches,
  };
}

export async function judgeSubmission(submissionId, { runner, queue, job, workerId }) {
  const bundle = await submissionService.getSubmissionForJudging(submissionId);
  if (!bundle?.problem) throw new Error('Submission or its problem no longer exists.');
  const { submission, problem, testCases } = bundle;
  if (submission.status === 'DONE' || submission.status === 'ERROR') {
    await queue.finish(job._id, workerId, submission.status);
    return;
  }
  if (!(await queue.isOwned(job._id, workerId))) {
    throw new Error('Worker lost its lease before judge execution.');
  }
  const selectedTests =
    submission.mode === 'run' ? testCases.filter((testCase) => testCase.isSample) : testCases;
  if (selectedTests.length === 0) throw new Error('No test cases are available for this job.');

  await submissionService.markSubmissionCompiling(submissionId);
  const limits = limitsFor(problem, submission.language);
  const hardDeadlineMs =
    limits.compile.timeMs * 2 + 2_000 + selectedTests.length * (limits.timeMs * 4 + 1_000) + 10_000;
  const artifact = await runner.compile({
    lang: submission.language,
    source: submission.code,
    submissionId: String(submission._id),
    limits: { ...limits, deadlineMs: hardDeadlineMs },
    containerMemoryMb: Math.max(limits.memoryMb, limits.compile.memoryMb),
  });
  if (!artifact.ok) {
    if (!(await queue.isOwned(job._id, workerId))) {
      throw new Error('Worker lost its lease before compile result persistence.');
    }
    const verdict = artifact.verdict ?? 'CE';
    await submissionService.finishSubmission(submissionId, {
      verdict,
      compileLog: artifact.log,
      perTest: [],
    });
    await queue.finish(job._id, workerId, 'DONE');
    return;
  }

  const activeJob = await queue.setState(job._id, workerId, 'RUNNING');
  if (!activeJob) throw new Error('Worker lost its lease before test execution.');
  await submissionService.markSubmissionRunning(submissionId);

  const resultDirectory = await mkdtemp(path.join(os.tmpdir(), 'oj-judge-results-'));
  const tested = [];
  const sampleResults = [];
  let runtimeMs = 0;
  let memoryKb = 0;
  try {
    for (let index = 0; index < selectedTests.length; index += 1) {
      const testCase = selectedTests[index];
      const input = await loadTestInput(testCase);
      if (typeof testCase.expectedOutput !== 'string') {
        throw new Error(`Test case ${testCase.order} has no expected output.`);
      }
      const runTest = () =>
        runner.run({
          artifactDir: artifact.artifactDir,
          lang: submission.language,
          input,
          limits: {
            timeMs: limits.timeMs,
            memoryMb: limits.memoryMb,
            outputBytes: limits.outputBytes,
            pidsLimit: limits.pidsLimit,
          },
        });
      let execution = await runTest();
      if (
        Number.isFinite(execution.cpuMs) &&
        execution.cpuMs >= limits.timeMs * 0.9 &&
        execution.cpuMs <= limits.timeMs * 1.1
      ) {
        const retry = await runTest();
        const successfulRuns = [execution, retry].filter(
          (result) =>
            result.exit === 0 &&
            !result.cpuLimitHit &&
            !result.wallLimitHit &&
            !result.outputCapHit &&
            !result.oomKilled,
        );
        if (successfulRuns.length > 0) {
          execution = successfulRuns.reduce((best, result) =>
            result.cpuMs < best.cpuMs ? result : best,
          );
        } else if (retry.cpuMs < execution.cpuMs) {
          execution = retry;
        }
      }
      runtimeMs += Number.isFinite(execution.cpuMs) ? execution.cpuMs : 0;
      memoryKb = Math.max(memoryKb, Number.isFinite(execution.memKb) ? execution.memKb : 0);

      const actualPath = temporaryInputPath(resultDirectory, `actual-${index}`);
      const expectedPath = temporaryInputPath(resultDirectory, `expected-${index}`);
      await Promise.all([
        writeFile(actualPath, execution.stdout ?? '', { mode: 0o600 }),
        writeFile(expectedPath, testCase.expectedOutput, { mode: 0o600 }),
      ]);
      const verdict = resolveTestVerdict({
        ...execution,
        outputMatches:
          execution.outputCapHit || execution.oomKilled || execution.wallLimitHit
            ? undefined
            : await compareOutput(problem.checker, actualPath, expectedPath),
      });
      tested.push({
        testIndex: index,
        category: testCase.category,
        result: safeRunResult(execution, verdict === 'AC'),
      });
      if (submission.mode === 'run') {
        sampleResults.push({
          testIndex: index,
          verdict,
          runtimeMs: Math.max(0, Math.round(execution.cpuMs ?? 0)),
          output: execution.stdout ?? '',
        });
      }
      if (verdict !== 'AC') break;
    }

    const aggregate = aggregateVerdict(tested);
    if (!(await queue.isOwned(job._id, workerId))) {
      throw new Error('Worker lost its lease before result persistence.');
    }
    await submissionService.finishSubmission(submissionId, {
      ...aggregate,
      runtimeMs,
      memoryKb,
      sampleResults: submission.mode === 'run' ? sampleResults : undefined,
    });
    await queue.finish(job._id, workerId, 'DONE');
  } finally {
    await rm(resultDirectory, { recursive: true, force: true });
    await runner.cleanup(artifact.artifactDir);
  }
}

export async function handleJudgeFailure(submissionId, { job, queue, workerId, error }) {
  logger.error(
    { event: 'judge.job_failed', submissionId: String(submissionId), err: error },
    'Judge job failed internally',
  );
  const released = await queue.releaseForRetry(job._id, workerId);
  if (!released) return;
  if (released.state === 'ERROR') {
    await submissionService.markSubmissionError(submissionId);
  } else {
    await submissionService.requeueSubmission(submissionId);
  }
}

export async function removeStaleJudgeContainers({ dockerBinary = 'docker' } = {}) {
  const { spawn } = await import('node:child_process');
  const runDocker = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(dockerBinary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timeout;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(stdout);
      };
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        stdout = `${stdout}${chunk}`.slice(-1_000_000);
      });
      child.stderr.setEncoding('utf8').on('data', (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-8192);
      });
      child.once('error', (error) => finish(error));
      child.once('close', (code) => {
        if (code === 0) finish(null);
        else finish(new Error(`Docker command failed (${code}): ${stderr.slice(0, 1000)}`));
      });
      timeout = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new Error('Docker janitor command timed out after 15 seconds.'));
      }, 15_000);
    });

  const containerIds = await runDocker([
    'ps',
    '-aq',
    '--filter',
    'label=oj-judge=1',
  ]);
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const id of containerIds.split(/\r?\n/).filter(Boolean)) {
    const deadline = await runDocker([
      'inspect',
      '--format',
      '{{index .Config.Labels "oj-deadline"}}',
      id,
    ]);
    const deadlineText = deadline.trim();
    const deadlineAt = deadlineText ? Number(deadlineText) : Number.NaN;
    let stale = Number.isFinite(deadlineAt) && deadlineAt < Date.now();
    if (!Number.isFinite(deadlineAt)) {
      const created = await runDocker(['inspect', '--format', '{{.Created}}', id]);
      const createdAt = Date.parse(created.trim());
      stale = Number.isFinite(createdAt) && createdAt < cutoff;
    }
    if (stale) {
      await runDocker(['rm', '-f', id]);
      logger.warn(
        { event: 'judge.stale_container_removed', containerId: id },
        'Removed stale judge container',
      );
    }
  }
}
