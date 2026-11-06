import { describe, expect, it } from 'vitest';
import { inspectTutorOutput } from '../../src/modules/ai/ai.guard.js';

const safeLlm = { isRealProvider: false };

describe('AI tutor output guard', () => {
  it('blocks code, full step lists, student-code echoes, and locked canaries', async () => {
    const cases = [
      { reply: '```text\nline 1\nline 2\nline 3\nline 4\n```' },
      { reply: '1. Read the input\n2. Update the map\n3. Return the pair' },
      {
        reply: 'The exact code is int main() { return 0; }',
      },
      {
        reply: 'alpha beta gamma delta epsilon',
        studentCode: 'alpha beta gamma delta epsilon zeta eta theta',
      },
      {
        reply: 'Use the copper-lantern invariant.',
        aiContext: { canaries: [{ phrase: 'copper-lantern invariant', level: 3 }] },
      },
    ];
    for (const testCase of cases) {
      const result = await inspectTutorOutput({
        level: 1,
        llm: safeLlm,
        ...testCase,
      });
      expect(result.allowed).toBe(false);
    }
  });

  it('allows brief Socratic guidance and fails closed if the classifier errors', async () => {
    const safe = await inspectTutorOutput({
      reply: 'Try the smallest allowed input. Which boundary might change your result?',
      level: 1,
      llm: safeLlm,
    });
    expect(safe.allowed).toBe(true);

    await expect(
      inspectTutorOutput({
        reply: 'A borderline reply mentions binary search.',
        level: 1,
        llm: {
          isRealProvider: true,
          generate: async () => {
            throw new Error('classifier unavailable');
          },
        },
      }),
    ).rejects.toThrow('classifier unavailable');
  });
});
