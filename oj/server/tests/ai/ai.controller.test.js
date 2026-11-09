import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  validateChatRequest: vi.fn(),
  chat: vi.fn(),
}));

vi.mock('../../src/modules/ai/ai.service.js', () => service);

import { chat } from '../../src/modules/ai/ai.controller.js';

function createResponse() {
  const response = {
    headersSent: true,
    status: vi.fn(),
    set: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe('AI controller chat stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.validateChatRequest.mockResolvedValue({ problemId: 'problem-1', message: 'Help' });
  });

  it('distinguishes provider fallback from safety replacement', async () => {
    service.chat.mockResolvedValue({
      reply: 'Try a smaller input first.',
      replaced: true,
      providerFailed: true,
      level: 1,
    });
    const response = createResponse();

    await chat(
      {
        user: { id: 'user-1' },
        validated: { body: { problemId: 'problem-1', message: 'Help' } },
      },
      response,
      vi.fn(),
    );

    const frames = response.write.mock.calls.map(([frame]) => frame).join('');
    expect(frames).toContain('event: fallback');
    expect(frames).not.toContain('event: replaced');
    expect(frames).toContain('event: delta');
    expect(response.end).toHaveBeenCalledOnce();
  });
});
