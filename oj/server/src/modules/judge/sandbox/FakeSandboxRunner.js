import { randomUUID } from 'node:crypto';

/**
 * Deterministic runner for unit/API tests. It never evaluates source code.
 */
export class FakeSandboxRunner {
  constructor({ compile = { ok: true }, runs = [] } = {}) {
    this.compileResult = compile;
    this.runs = runs;
    this.runIndex = 0;
  }

  async compile() {
    if (!this.compileResult.ok) return { ...this.compileResult };
    return { ...this.compileResult, artifactDir: randomUUID() };
  }

  async run() {
    const result = this.runs[this.runIndex] ?? {
      exit: 0,
      signal: null,
      cpuMs: 1,
      wallMs: 1,
      memKb: 1024,
      stdout: '',
      stderr: '',
      outputCapHit: false,
      oomKilled: false,
      cpuLimitHit: false,
      wallLimitHit: false,
    };
    this.runIndex += 1;
    return { ...result };
  }

  async cleanup() {}
}
