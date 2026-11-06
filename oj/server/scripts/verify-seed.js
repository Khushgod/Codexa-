import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareOutput } from '../src/modules/judge/compare.js';
import { loadTestInput } from '../src/modules/judge/judge.service.js';
import { limitsFor } from '../src/modules/judge/languages/index.js';
import { DockerSandboxRunner } from '../src/modules/judge/sandbox/DockerSandboxRunner.js';
import { resolveTestVerdict } from '../src/modules/judge/verdict.js';
import { seedSchemas } from '../src/modules/problems/seed.service.js';

const SERVER_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SEED_ROOT = path.join(SERVER_ROOT, 'seed');
const PROBLEMS_ROOT = path.join(SEED_ROOT, 'problems');

function languageFromFile(filePath) {
  const extension = path.extname(filePath);
  if (extension === '.cpp') return 'cpp';
  if (extension === '.py') return 'python';
  if (extension === '.java') return 'java';
  throw new Error(`Unsupported reference solution extension: ${extension}`);
}

async function loadSolution(referencePath) {
  const resolvedPath = path.resolve(SEED_ROOT, referencePath);
  const relativePath = path.relative(SEED_ROOT, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Reference path escapes the seed directory: ${referencePath}`);
  }
  return readFile(resolvedPath, 'utf8');
}

async function judgeSource({ entry, source, language, outputDirectory, key }) {
  const runner = new DockerSandboxRunner();
  const submissionId = createHash('sha256')
    .update(`${randomUUID()}-${key}`)
    .digest('hex')
    .slice(0, 24);
  const limits = limitsFor(entry.problem, language);
  const deadlineMs =
    limits.compile.timeMs * 2 + 2_000 + entry.testCases.length * (limits.timeMs * 2 + 500) + 10_000;
  const outputs = [];
  let artifactDir;
  try {
    const artifact = await runner.compile({
      lang: language,
      source,
      submissionId,
      limits: { ...limits, deadlineMs },
      containerMemoryMb: Math.max(limits.memoryMb, limits.compile.memoryMb),
    });
    if (!artifact.ok) {
      return { verdict: artifact.verdict, outputs, compileLog: artifact.log };
    }
    artifactDir = artifact.artifactDir;

    for (let index = 0; index < entry.testCases.length; index += 1) {
      const testCase = entry.testCases[index];
      const execution = await runner.run({
        artifactDir,
        lang: language,
        input: await loadTestInput(testCase),
        limits,
      });
      const verdict = resolveTestVerdict({ ...execution, outputMatches: true });
      if (verdict !== 'AC') return { verdict, outputs };

      const actualPath = path.join(outputDirectory, `${key}-${index}.actual`);
      const expectedPath = path.join(outputDirectory, `${key}-${index}.expected`);
      await Promise.all([
        writeFile(actualPath, execution.stdout, { mode: 0o600 }),
        writeFile(expectedPath, testCase.expectedOutput, { mode: 0o600 }),
      ]);
      outputs.push(actualPath);
      if (!(await compareOutput(entry.problem.checker, actualPath, expectedPath))) {
        return { verdict: 'WA', outputs };
      }
    }
    return { verdict: 'AC', outputs };
  } finally {
    if (artifactDir) await runner.cleanup(artifactDir);
  }
}

async function verifyEntry(filePath, outputDirectory) {
  const rawEntry = JSON.parse(await readFile(filePath, 'utf8'));
  const entry = seedSchemas.seedEntrySchema.parse(rawEntry);
  const slug = entry.problem.slug;
  const cpp = await judgeSource({
    entry,
    source: await loadSolution(entry.referenceSolutions.cpp),
    language: 'cpp',
    outputDirectory,
    key: `${slug}-cpp`,
  });
  const python = await judgeSource({
    entry,
    source: await loadSolution(entry.referenceSolutions.python),
    language: 'python',
    outputDirectory,
    key: `${slug}-python`,
  });
  if (cpp.verdict !== 'AC' || python.verdict !== 'AC') {
    throw new Error(`${slug}: references failed (C++ ${cpp.verdict}, Python ${python.verdict}).`);
  }
  for (let index = 0; index < entry.testCases.length; index += 1) {
    if (!(await compareOutput(entry.problem.checker, cpp.outputs[index], python.outputs[index]))) {
      throw new Error(`${slug}: C++ and Python reference output differs on test ${index + 1}.`);
    }
  }

  const wrongPath = entry.referenceSolutions.wrong;
  const wrong = await judgeSource({
    entry,
    source: await loadSolution(wrongPath),
    language: languageFromFile(wrongPath),
    outputDirectory,
    key: `${slug}-wrong`,
  });
  if (wrong.verdict !== 'WA') {
    throw new Error(`${slug}: deliberately wrong solution produced ${wrong.verdict}, expected WA.`);
  }

  const slowPath = entry.referenceSolutions.slow;
  const slow = await judgeSource({
    entry,
    source: await loadSolution(slowPath),
    language: languageFromFile(slowPath),
    outputDirectory,
    key: `${slug}-slow`,
  });
  if (slow.verdict !== 'TLE') {
    throw new Error(`${slug}: deliberately slow solution produced ${slow.verdict}, expected TLE.`);
  }
  console.info(`${slug}: references AC; C++/Python agree; wrong=WA; slow=TLE`);
}

async function main() {
  const files = (await readdir(PROBLEMS_ROOT))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(PROBLEMS_ROOT, name));
  if (files.length === 0) throw new Error('No seed problem JSON files were found.');

  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'oj-verify-seed-'));
  try {
    for (const filePath of files) await verifyEntry(filePath, outputDirectory);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Seed verification failed: ${error.message}`);
  process.exitCode = 1;
});
