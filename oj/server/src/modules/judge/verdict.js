const PRECEDENCE = ['ERROR', 'CE', 'OLE', 'MLE', 'TLE', 'RE', 'WA', 'AC'];

export function resolveTestVerdict(result) {
  const candidates = new Set();
  if (result.infrastructureError) candidates.add('ERROR');
  if (result.compileError) candidates.add('CE');
  if (result.outputCapHit) candidates.add('OLE');
  if (result.oomKilled || result.javaOutOfMemory) candidates.add('MLE');
  if (result.cpuLimitHit || result.wallLimitHit) candidates.add('TLE');
  if (result.exit !== 0 || result.signal) candidates.add('RE');
  if (result.outputMatches === false) candidates.add('WA');
  if (candidates.size === 0) candidates.add('AC');
  return PRECEDENCE.find((verdict) => candidates.has(verdict));
}

/**
 * Stop at the first failing test and preserve only safe, non-input metadata.
 * @param {Array<{testIndex: number, category: string, result: object}>} tests
 */
export function aggregateVerdict(tests) {
  const perTest = [];
  for (const { testIndex, category, result } of tests) {
    const verdict = resolveTestVerdict(result);
    perTest.push({
      testIndex,
      verdict,
      ...(Number.isFinite(result.cpuMs)
        ? { runtimeMs: Math.max(0, Math.round(result.cpuMs)) }
        : {}),
      ...(Number.isFinite(result.memKb) ? { memoryKb: Math.max(0, Math.round(result.memKb)) } : {}),
      category,
    });
    if (verdict !== 'AC') {
      return {
        verdict,
        perTest,
        failedTestIndex: testIndex,
        failedCategory: category,
      };
    }
  }
  return { verdict: 'AC', perTest };
}

export const verdictPrecedence = Object.freeze([...PRECEDENCE]);
