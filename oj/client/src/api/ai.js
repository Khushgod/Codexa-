import { apiRequest, streamRequest } from './client.js';

export async function getTutorConversation(problemId) {
  const query = new URLSearchParams({ problemId });
  const response = await apiRequest(`/api/ai/conversation?${query}`);
  return response.data;
}

export async function unlockTutorHint(problemId) {
  const response = await apiRequest('/api/ai/unlock', {
    method: 'POST',
    body: JSON.stringify({ problemId }),
  });
  return response.data;
}

export async function rateTutorReply(problemId, messageIndex, rating) {
  const response = await apiRequest('/api/ai/feedback', {
    method: 'POST',
    body: JSON.stringify({ problemId, messageIndex, rating }),
  });
  return response.data;
}

export async function streamTutorChat(input, onEvent) {
  const response = await streamRequest('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!response.body) throw new Error('The tutor stream is unavailable.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const event = frame.match(/^event:\s*(.+)$/m)?.[1];
        const data = frame.match(/^data:\s*(.+)$/m)?.[1];
        if (!event || !data) continue;
        const payload = JSON.parse(data);
        onEvent(event, payload);
        if (event === 'error') throw new Error(payload.message || 'Tutor request failed.');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
