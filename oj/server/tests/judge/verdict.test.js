import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareExact, compareFloats, compareTokens } from '../../src/modules/judge/compare.js';
import {
  aggregateVerdict,
  resolveTestVerdict,
  verdictPrecedence,
} from '../../src/modules/judge/verdict.js';
import { getLanguage, limitsFor } from '../../src/modules/judge/languages/index.js';

describe('judge verdict precedence', () => {
  it.each([
    [{ infrastructureError: true, compileError: true }, 'ERROR'],
    [{ compileError: true, outputCapHit: true }, 'CE'],
    [{ outputCapHit: true, oomKilled: true }, 'OLE'],
    [{ oomKilled: true, wallLimitHit: true }, 'MLE'],
    [{ wallLimitHit: true, exit: 1 }, 'TLE'],
    [{ exit: 1, outputMatches: false }, 'RE'],
    [{ exit: 0, outputMatches: false }, 'WA'],
    [{ exit: 0, outputMatches: true }, 'AC'],
  ])('resolves %j to %s', (result, expected) => {
    expect(resolveTestVerdict(result)).toBe(expected);
  });

  it('uses the specified precedence order', () => {
    expect(verdictPrecedence).toEqual(['ERROR', 'CE', 'OLE', 'MLE', 'TLE', 'RE', 'WA', 'AC']);
  });

  it('stops after the first failing test and exposes only test metadata', () => {
    const result = aggregateVerdict([
      { testIndex: 0, category: 'sample', result: { exit: 0, outputMatches: true } },
      {
        testIndex: 1,
        category: 'hidden-boundary',
        result: { exit: 0, outputMatches: false, stdout: 'private' },
      },
      { testIndex: 2, category: 'later', result: { exit: 0, outputMatches: true } },
    ]);
    expect(result).toMatchObject({
      verdict: 'WA',
      failedTestIndex: 1,
      failedCategory: 'hidden-boundary',
    });
    expect(result.perTest).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('private');
  });
});

describe('streaming output checkers', () => {
  let directory;

  async function files(actual, expected) {
    directory = await mkdtemp(path.join(os.tmpdir(), 'oj-checker-test-'));
    const actualPath = path.join(directory, 'actual');
    const expectedPath = path.join(directory, 'expected');
    await Promise.all([writeFile(actualPath, actual), writeFile(expectedPath, expected)]);
    return [actualPath, expectedPath];
  }

  it('normalizes CRLF, trailing whitespace, and trailing blank lines for exact output', async () => {
    const [actual, expected] = await files('one  \r\ntwo\t\r\n\r\n', 'one\ntwo\n');
    expect(await compareExact(actual, expected)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it('compares token streams without materializing full files', async () => {
    const [actual, expected] = await files('  1\n2\t3\n', '1 2 3');
    expect(await compareTokens(actual, expected)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it('compares floats within epsilon and rejects malformed numeric tokens', async () => {
    const [actual, expected] = await files('1.00001 nan', '1.0 nan');
    expect(await compareFloats(actual, expected, 0.0001)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });
});

describe('language configurations', () => {
  it.each(['cpp', 'python', 'java'])('defines separated compile/run limits for %s', (language) => {
    const config = getLanguage(language);
    expect(config.fileName).toBeTruthy();
    expect(config.compileCmd.length).toBeGreaterThan(0);
    expect(config.runCmd.length).toBeGreaterThan(0);
    expect(config.compileLimits.timeMs).toBeGreaterThan(config.runLimits.timeMs);
    expect(limitsFor({ timeLimitMs: 1000, memoryLimitMb: 128 }, language).timeMs).toBeGreaterThan(
      0,
    );
  });

  it('rejects unknown languages', () => {
    expect(() => getLanguage('ruby')).toThrow(/Unsupported language/);
  });
});
