import { env } from '../../../config/env.js';
import { MockLLMClient } from './MockLLMClient.js';
import { OpenAIClient } from './OpenAIClient.js';

export const llmClient = env.LLM_PROVIDER === 'openai' ? new OpenAIClient() : new MockLLMClient();
