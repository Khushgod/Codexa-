import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { getLanguage } from '../languages/index.js';

const MAX_PROTOCOL_LINE_BYTES = 2 * 1024 * 1024;
const DEFAULT_OUTPUT_BYTES = 256 * 1024;
const CONTAINER_STOP_TIMEOUT_MS = 2_000;
const DOCKER_COMMAND_TIMEOUT_MS = 15_000;

function runDockerCommand(binary, args) {
  return new Promise((resolve, reject) => {
    const command = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout;
    const finish = (error, output = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(output);
    };
    command.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-8192);
    });
    command.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8192);
    });
    command.once('error', (error) => finish(error));
    command.once('close', (code) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(`Docker command failed (${code}): ${stderr.slice(-1000)}`));
    });
    timeout = setTimeout(() => {
      command.kill('SIGKILL');
      finish(new Error(`Docker command timed out after ${DOCKER_COMMAND_TIMEOUT_MS} ms.`));
    }, DOCKER_COMMAND_TIMEOUT_MS);
  });
}

function dockerArgs(submissionId, memoryMb, pidsLimit, deadlineAt) {
  const name = `oj-judge-${submissionId}`;
  const args = [
    'run',
    '--rm',
    '--name',
    name,
    '--label',
    'oj-judge=1',
    '--label',
    `oj-submission=${submissionId}`,
    '--label',
    `oj-deadline=${deadlineAt}`,
    '--network',
    'none',
    '--memory',
    `${memoryMb}m`,
    '--memory-swap',
    `${memoryMb}m`,
    '--cpus',
    '1',
    ...(env.JUDGE_CPUSET ? ['--cpuset-cpus', env.JUDGE_CPUSET] : []),
    '--pids-limit',
    String(pidsLimit),
    '--read-only',
    '--tmpfs',
    '/tmp:size=64m,exec,nosuid,nodev',
    '--tmpfs',
    '/work:size=512m,exec,nosuid,nodev',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'SETUID',
    '--cap-add',
    'SETGID',
    '--cap-add',
    'FOWNER',
    '--security-opt',
    'no-new-privileges',
    '-i',
    env.JUDGE_IMAGE,
  ];
  return { name, args };
}

export class DockerSandboxRunner {
  constructor({ dockerBinary = 'docker' } = {}) {
    this.dockerBinary = dockerBinary;
    this.sessions = new Map();
  }

  async assertReady() {
    await runDockerCommand(this.dockerBinary, ['image', 'inspect', env.JUDGE_IMAGE]);
  }

  async compile({ lang, source, limits, submissionId, containerMemoryMb }) {
    getLanguage(lang);
    if (!/^[a-f\d]{24}$/i.test(submissionId)) throw new Error('Invalid submission id');
    const previous = await runDockerCommand(this.dockerBinary, [
      'ps',
      '-aq',
      '--filter',
      'label=oj-judge=1',
      '--filter',
      `label=oj-submission=${submissionId}`,
    ]);
    for (const containerId of previous.split(/\r?\n/).filter(Boolean)) {
      await runDockerCommand(this.dockerBinary, ['rm', '-f', containerId]);
    }
    const deadlineMs = limits.deadlineMs ?? 120_000;
    const { name, args } = dockerArgs(
      submissionId,
      containerMemoryMb ?? limits.memoryMb,
      limits.pidsLimit,
      Date.now() + deadlineMs,
    );
    const child = spawn(this.dockerBinary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const sessionId = randomUUID();
    const session = {
      child,
      name,
      pending: [],
      stderr: '',
      closed: false,
      processClosed: false,
      sessionId,
      closedPromise: null,
      resolveClosed: null,
    };
    session.closedPromise = new Promise((resolve) => {
      session.resolveClosed = resolve;
    });
    this.sessions.set(sessionId, session);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      session.stderr = `${session.stderr}${chunk}`.slice(-8192);
    });
    child.stdin.on('error', (error) => this.#close(session, error));
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.#receiveLine(session, line));
    child.once('error', (error) => {
      this.#close(session, error);
      if (!child.pid) this.#markProcessClosed(session);
    });
    child.once('close', (code, signal) => {
      this.#markProcessClosed(session);
      const error = new Error(
        `Docker judge container exited unexpectedly (${signal ?? code ?? 'unknown'}).`,
      );
      this.#close(session, error);
    });

    session.deadline = setTimeout(() => {
      this.#killContainer(name).catch((error) => {
        logger.error(
          { event: 'judge.container_kill_failed', submissionId, err: error },
          'Could not stop expired judge container',
        );
      });
      this.#close(session, new Error('Judge submission exceeded its hard deadline.'));
    }, deadlineMs);
    session.deadline.unref();

    try {
      const response = await this.#request(session, {
        op: 'compile',
        language: lang,
        source: Buffer.from(source, 'utf8').toString('base64'),
        limits: limits.compile,
      });
      if (response.op === 'error')
        throw new Error(response.message ?? 'Judge supervisor rejected compilation.');
      if (response.op !== 'compile')
        throw new Error('Judge supervisor returned an invalid compile response.');
      if (response.ok) {
        return { ok: true, artifactDir: sessionId, log: '' };
      }
      await this.cleanup(sessionId);
      const verdict = response.outputCapHit
        ? 'OLE'
        : response.oomKilled
          ? 'MLE'
          : response.cpuLimitHit || response.wallLimitHit
            ? 'TLE'
            : 'CE';
      return {
        ok: false,
        verdict,
        log: Buffer.from(response.log ?? '', 'base64')
          .toString('utf8')
          .slice(0, 4096),
      };
    } catch (error) {
      await this.cleanup(sessionId);
      throw error;
    }
  }

  async run({ artifactDir, lang, input, limits }) {
    getLanguage(lang);
    const session = this.sessions.get(artifactDir);
    if (!session || session.closed)
      throw new Error('Judge sandbox session is no longer available.');
    await runDockerCommand(this.dockerBinary, [
      'update',
      '--memory',
      `${limits.memoryMb}m`,
      '--memory-swap',
      `${limits.memoryMb}m`,
      session.name,
    ]);
    const response = await this.#request(session, {
      op: 'run',
      input: Buffer.from(input, 'utf8').toString('base64'),
      limits: {
        timeMs: limits.timeMs,
        memoryMb: limits.memoryMb,
        outputBytes: limits.outputBytes ?? DEFAULT_OUTPUT_BYTES,
        pidsLimit: limits.pidsLimit,
      },
    });
    if (response.op === 'error')
      throw new Error(response.message ?? 'Judge supervisor failed to run a test.');
    if (response.op !== 'run')
      throw new Error('Judge supervisor returned an invalid run response.');
    return {
      exit: response.exit,
      signal: response.signal,
      cpuMs: response.cpuMs,
      wallMs: response.wallMs,
      memKb: response.memKb,
      stdout: Buffer.from(response.stdout ?? '', 'base64').toString('utf8'),
      stderr: Buffer.from(response.stderr ?? '', 'base64').toString('utf8'),
      outputCapHit: Boolean(response.outputCapHit),
      oomKilled: Boolean(response.oomKilled),
      javaOutOfMemory: Boolean(response.javaOutOfMemory),
      cpuLimitHit: Boolean(response.cpuLimitHit),
      wallLimitHit: Boolean(response.wallLimitHit),
    };
  }

  async cleanup(artifactDir) {
    const session = this.sessions.get(artifactDir);
    if (!session) return;
    clearTimeout(session.deadline);
    if (!session.closed) {
      try {
        await new Promise((resolve, reject) => {
          session.child.stdin.write('{"op":"shutdown"}\n', (error) => {
            if (error) reject(error);
            else {
              session.child.stdin.end();
              resolve();
            }
          });
        });
      } catch (error) {
        logger.warn(
          { event: 'judge.container_shutdown_failed', container: session.name, err: error },
          'Gracefully stopping judge container failed',
        );
      }
    }
    if (await this.#waitForClose(session, CONTAINER_STOP_TIMEOUT_MS)) return;
    try {
      await this.#killContainer(session.name);
    } catch (error) {
      if (await this.#waitForClose(session, CONTAINER_STOP_TIMEOUT_MS)) return;
      throw error;
    }
    if (!(await this.#waitForClose(session, CONTAINER_STOP_TIMEOUT_MS))) {
      throw new Error(`Judge container ${session.name} did not stop after being killed.`);
    }
  }

  #request(session, message) {
    if (session.closed) return Promise.reject(new Error('Judge sandbox is closed.'));
    return new Promise((resolve, reject) => {
      session.pending.push({ resolve, reject });
      const line = `${JSON.stringify(message)}\n`;
      if (Buffer.byteLength(line) > MAX_PROTOCOL_LINE_BYTES) {
        session.pending.pop();
        reject(new Error('Judge protocol message exceeds its size limit.'));
        return;
      }
      session.child.stdin.write(line, (error) => {
        if (!error) return;
        const pending = session.pending.pop();
        pending?.reject(error);
      });
    });
  }

  #receiveLine(session, line) {
    if (Buffer.byteLength(line) > MAX_PROTOCOL_LINE_BYTES) {
      this.#close(session, new Error('Judge supervisor response exceeded its size limit.'));
      this.#killContainer(session.name).catch((error) => {
        logger.error(
          { event: 'judge.container_kill_failed', container: session.name, err: error },
          'Could not stop malformed judge container',
        );
      });
      return;
    }
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      this.#close(session, new Error('Judge supervisor returned invalid protocol data.'));
      this.#killContainer(session.name).catch((error) => {
        logger.error(
          { event: 'judge.container_kill_failed', container: session.name, err: error },
          'Could not stop malformed judge container',
        );
      });
      return;
    }
    const pending = session.pending.shift();
    if (!pending) {
      this.#close(session, new Error('Judge supervisor returned an unexpected response.'));
      this.#killContainer(session.name).catch((error) => {
        logger.error(
          { event: 'judge.container_kill_failed', container: session.name, err: error },
          'Could not stop unexpected judge container',
        );
      });
      return;
    }
    pending.resolve(response);
  }

  #close(session, error) {
    if (session.closed) return;
    session.closed = true;
    clearTimeout(session.deadline);
    for (const pending of session.pending.splice(0)) pending.reject(error);
  }

  #markProcessClosed(session) {
    if (session.processClosed) return;
    session.processClosed = true;
    this.sessions.delete(session.sessionId);
    session.resolveClosed();
  }

  async #waitForClose(session, timeoutMs) {
    if (session.processClosed) return true;
    let timeout;
    const closed = await Promise.race([
      session.closedPromise.then(() => true),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    clearTimeout(timeout);
    return closed;
  }

  async #killContainer(name) {
    await runDockerCommand(this.dockerBinary, ['kill', name]);
  }
}
