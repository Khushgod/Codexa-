import { randomUUID } from 'node:crypto';
import { env } from '../src/config/env.js';
import { limitsFor } from '../src/modules/judge/languages/index.js';
import { DockerSandboxRunner } from '../src/modules/judge/sandbox/DockerSandboxRunner.js';

const LANGUAGE = 'cpp';
const SOURCE =
  '#include <cstdint>\nint main() { volatile std::uint64_t total = 0; for (std::uint64_t i = 0; i < 5000000; ++i) total += i; return total == 12499997500000ULL ? 0 : 1; }';

async function main() {
  const runner = new DockerSandboxRunner();
  const submissionId = randomUUID().replaceAll('-', '').slice(0, 24);
  const problemLimits = limitsFor({ timeLimitMs: 2000, memoryLimitMb: 256 }, LANGUAGE);
  let artifactDir;
  try {
    const artifact = await runner.compile({
      lang: LANGUAGE,
      source: SOURCE,
      submissionId,
      limits: { ...problemLimits, deadlineMs: 30_000 },
      containerMemoryMb: Math.max(problemLimits.memoryMb, problemLimits.compile.memoryMb),
    });
    if (!artifact.ok) throw new Error(`Calibration compile failed: ${artifact.log}`);
    artifactDir = artifact.artifactDir;

    const runs = [];
    for (let index = 0; index < 5; index += 1) {
      const result = await runner.run({
        artifactDir,
        lang: LANGUAGE,
        input: '',
        limits: problemLimits,
      });
      if (result.exit !== 0 || result.outputCapHit || result.oomKilled) {
        throw new Error(`Calibration run ${index + 1} failed.`);
      }
      runs.push(result.cpuMs);
    }
    runs.sort((left, right) => left - right);
    console.info(`Judge host calibration (${LANGUAGE}, CPU ms): ${runs.join(', ')}`);
    console.info(`Median: ${runs[Math.floor(runs.length / 2)]} ms`);
    if (process.platform === 'win32' || process.platform === 'darwin') {
      console.warn('Docker Desktop timing is not representative of native Linux workers.');
    }
    console.info(`Runtime image: ${env.JUDGE_IMAGE}`);
  } finally {
    if (artifactDir) await runner.cleanup(artifactDir);
  }
}

main().catch((error) => {
  console.error(`Judge calibration failed: ${error.message}`);
  process.exitCode = 1;
});
