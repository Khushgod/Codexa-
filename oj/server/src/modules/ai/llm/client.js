import { env } from '../../../config/env.js';
import { MockLLMClient } from './MockLLMClient.js';
import { OpenAIClient } from './OpenAIClient.js';

export const llmClient = env.LLM_PROVIDER === 'mock' ? new MockLLMClient() : new OpenAIClient();
