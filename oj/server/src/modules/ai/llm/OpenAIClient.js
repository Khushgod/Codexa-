import { env } from '../../../config/env.js';

export class OpenAIClient {
  isRealProvider = true;

  async generate({ system, messages, maxTokens, timeoutMs = env.LLM_TIMEOUT_MS }) {
    const response = await fetch(`${env.LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`LLM provider returned HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('LLM provider returned no text content');
    return {
      content,
      usage: {
        prompt: payload.usage?.prompt_tokens ?? 0,
        completion: payload.usage?.completion_tokens ?? 0,
        total: payload.usage?.total_tokens ?? 0,
      },
    };
  }

  async *stream({ system, messages, maxTokens, timeoutMs = env.LLM_TIMEOUT_MS }) {
    const response = await fetch(`${env.LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok || !response.body) {
      throw new Error(`LLM provider returned HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          const payload = JSON.parse(data);
          const content = payload.choices?.[0]?.delta?.content;
          if (typeof content === 'string') yield content;
          if (payload.usage) {
            yield {
              usage: {
                prompt: payload.usage.prompt_tokens ?? 0,
                completion: payload.usage.completion_tokens ?? 0,
                total: payload.usage.total_tokens ?? 0,
              },
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
