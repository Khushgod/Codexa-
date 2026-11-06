import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

async function* linesFromFile(path) {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield line;
  } finally {
    lines.close();
    input.destroy();
  }
}

function normalizedLine(line) {
  return line.replace(/[ \t]+$/g, '');
}

async function* nonEmptyNormalizedLines(path) {
  let pendingBlankLines = 0;
  for await (const line of linesFromFile(path)) {
    const normalized = normalizedLine(line);
    if (normalized.length === 0) {
      pendingBlankLines += 1;
      continue;
    }
    while (pendingBlankLines > 0) {
      yield '';
      pendingBlankLines -= 1;
    }
    yield normalized;
  }
}

export async function compareExact(actualPath, expectedPath) {
  const actual = nonEmptyNormalizedLines(actualPath);
  const expected = nonEmptyNormalizedLines(expectedPath);
  while (true) {
    const [left, right] = await Promise.all([actual.next(), expected.next()]);
    if (left.done || right.done) return left.done === right.done;
    if (left.value !== right.value) return false;
  }
}

async function* tokensFromFile(path) {
  let remaining = '';
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    const parts = `${remaining}${chunk}`.split(/\s+/);
    remaining = parts.pop() ?? '';
    for (const part of parts) {
      if (part) yield part;
    }
  }
  if (remaining) yield remaining;
}

export async function compareTokens(actualPath, expectedPath) {
  const actual = tokensFromFile(actualPath);
  const expected = tokensFromFile(expectedPath);
  while (true) {
    const [left, right] = await Promise.all([actual.next(), expected.next()]);
    if (left.done || right.done) return left.done === right.done;
    if (left.value !== right.value) return false;
  }
}

export async function compareFloats(actualPath, expectedPath, epsilon = 1e-6) {
  const actual = tokensFromFile(actualPath);
  const expected = tokensFromFile(expectedPath);
  while (true) {
    const [left, right] = await Promise.all([actual.next(), expected.next()]);
    if (left.done || right.done) return left.done === right.done;
    const actualNumber = Number(left.value);
    const expectedNumber = Number(right.value);
    if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) {
      if (left.value !== right.value) return false;
    } else if (Math.abs(actualNumber - expectedNumber) > epsilon) {
      return false;
    }
  }
}

export async function compareOutput(checker, actualPath, expectedPath) {
  switch (checker?.type) {
    case 'exact':
      return compareExact(actualPath, expectedPath);
    case 'token':
      return compareTokens(actualPath, expectedPath);
    case 'float':
      return compareFloats(actualPath, expectedPath, checker.epsilon ?? 1e-6);
    case 'custom':
      throw new Error('Custom checkers are not supported by the M6 judge runtime.');
    default:
      throw new Error(`Unknown checker type: ${checker?.type}`);
  }
}
