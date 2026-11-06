import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../../src/config/env.js';
import { compareOutput } from '../../../src/modules/judge/compare.js';
import { DockerSandboxRunner } from '../../../src/modules/judge/sandbox/DockerSandboxRunner.js';
import { getLanguage } from '../../../src/modules/judge/languages/index.js';
import { resolveTestVerdict } from '../../../src/modules/judge/verdict.js';

const dockerCheck = spawnSync('docker', ['image', 'inspect', env.JUDGE_IMAGE], {
  encoding: 'utf8',
  timeout: 10_000,
});
const dockerAvailable = dockerCheck.status === 0;
const activeSubmissions = new Set();

if (!dockerAvailable) {
  process.stdout.write(
    `Skipping Docker torture tests: Docker image "${env.JUDGE_IMAGE}" is unavailable. Build it with npm run build:judge-image.\n`,
  );
}

async function evaluate({
  lang = 'cpp',
  source,
  input = '',
  expectedOutput,
  timeMs = 1000,
  memoryMb = 256,
  outputBytes = 4096,
}) {
  const runner = new DockerSandboxRunner();
  const submissionId = randomUUID().replaceAll('-', '').slice(0, 24);
  activeSubmissions.add(submissionId);
  const language = getLanguage(lang);
  const limits = {
    timeMs,
    memoryMb,
    outputBytes,
    pidsLimit: language.pidsLimit,
    compile: language.compileLimits,
    deadlineMs: 30_000,
  };
  let artifactDir;
  try {
    const artifact = await runner.compile({
      lang,
      source,
      submissionId,
      limits,
      containerMemoryMb: Math.max(memoryMb, limits.compile.memoryMb),
    });
    if (!artifact.ok) return { verdict: artifact.verdict, compileLog: artifact.log };
    artifactDir = artifact.artifactDir;
    const result = await runner.run({ artifactDir, lang, input, limits });
    let outputMatches = true;
    if (expectedOutput !== undefined) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'oj-torture-result-'));
      try {
        const actualPath = path.join(directory, 'actual');
        const expectedPath = path.join(directory, 'expected');
        await Promise.all([
          writeFile(actualPath, result.stdout),
          writeFile(expectedPath, expectedOutput),
        ]);
        outputMatches = await compareOutput({ type: 'exact' }, actualPath, expectedPath);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    return { ...result, verdict: resolveTestVerdict({ ...result, outputMatches }) };
  } finally {
    if (artifactDir) await runner.cleanup(artifactDir);
  }
}

function assertNoSandboxContainers(submissionId) {
  const result = spawnSync(
    'docker',
    ['ps', '-aq', '--filter', `label=oj-submission=${submissionId}`],
    { encoding: 'utf8', timeout: 10_000 },
  );
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('');
}

afterEach(() => {
  for (const submissionId of activeSubmissions) assertNoSandboxContainers(submissionId);
  activeSubmissions.clear();
});

describe.skipIf(!dockerAvailable)('Docker sandbox torture tests', () => {
  it('runs valid C++ and reports compile, runtime, and wrong-answer outcomes', async () => {
    const accepted = await evaluate({
      source: '#include <iostream>\nint main() { std::cout << 42; }',
      expectedOutput: '42\n',
    });
    expect(accepted.verdict).toBe('AC');

    const wrongAnswer = await evaluate({
      source: '#include <iostream>\nint main() { std::cout << 41; }',
      expectedOutput: '42\n',
    });
    expect(wrongAnswer.verdict).toBe('WA');

    const compileError = await evaluate({ source: 'int main( {' });
    expect(compileError.verdict).toBe('CE');

    const runtimeError = await evaluate({ source: 'int main() { return 7; }' });
    expect(runtimeError.verdict).toBe('RE');
  });

  it('kills CPU loops and bounds process creation and output', async () => {
    const infinite = await evaluate({ source: 'int main() { for (;;) {} }', timeMs: 100 });
    expect(infinite.verdict).toBe('TLE');

    const forkBomb = await evaluate({
      source: '#include <unistd.h>\nint main() { while (fork() >= 0) {} }',
      timeMs: 100,
    });
    expect(['TLE', 'RE']).toContain(forkBomb.verdict);

    const outputBomb = await evaluate({
      source: '#include <iostream>\nint main() { for (;;) std::cout << "xxxxxxxx"; }',
      outputBytes: 1024,
    });
    expect(outputBomb.verdict).toBe('OLE');
  });

  it('constrains Java memory and removes the sandbox after the run', async () => {
    const memoryBomb = await evaluate({
      lang: 'java',
      source:
        'public class Main { public static void main(String[] args) { byte[] data = new byte[1073741824]; System.out.println(data.length); } }',
      memoryMb: 192,
    });
    expect(memoryBomb.verdict).toBe('MLE');
  });

  it('runs without network access', async () => {
    const networkProbe = await evaluate({
      lang: 'python',
      source:
        'import socket\ns = socket.socket()\ntry:\n s.settimeout(1)\n s.connect(("1.1.1.1", 53))\n print("connected")\nexcept OSError:\n print("blocked")',
    });
    expect(networkProbe.verdict).toBe('AC');
    expect(networkProbe.stdout).toContain('blocked');
  });
});
