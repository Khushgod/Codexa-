import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadTestInput } from '../../src/modules/judge/judge.service.js';

const seedFile = new URL('../../seed/problems/pair-signal.json', import.meta.url);
const serverFile = new URL('../../package.json', import.meta.url);

describe('judge input resolution', () => {
  it('loads a seed file only when its SHA-256 matches', async () => {
    const bytes = await readFile(seedFile);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const input = await loadTestInput({
      fileRef: 'problems/pair-signal.json',
      sha256,
    });
    expect(input).toBe(bytes.toString('utf8'));
    await expect(
      loadTestInput({ fileRef: 'problems/pair-signal.json', sha256: '0'.repeat(64) }),
    ).rejects.toThrow(/checksum/);
  });

  it('rejects file references that resolve outside the seed root', async () => {
    const bytes = await readFile(serverFile);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await expect(loadTestInput({ fileRef: '../package.json', sha256 })).rejects.toThrow(
      /outside the seed directory/,
    );
  });
});
