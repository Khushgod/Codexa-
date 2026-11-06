import { env } from '../../config/env.js';

const REFUSAL =
  'I can help you reason through the problem, but I can’t provide a full solution. Which part would you like to explore?';

function codeLeak(reply) {
  if (/<\s*\/?\s*student[\s_-]*(?:code|message)\s*>/i.test(reply.normalize('NFKC'))) {
    return true;
  }
  const fences = [...reply.matchAll(/```[\s\S]*?```/g)];
  if (fences.some((match) => match[0].split('\n').length > 5)) return true;
  const outside = reply.replace(/```[\s\S]*?```/g, '');
  return /(?:#include\s*[<"]|\b(?:def|class|function)\s+\w+\s*(?:\(|:|\{)|\bimport\s+\w+|\b(?:int|void|bool|string|char|long|double)\s+\w+\s*\([^)]*\)\s*\{|for\s*\([^)]*\)\s*\{|return\s+[^?.!]+;|System\.out\.print|print\s*\([^)]*\))/i.test(
    outside,
  );
}

function codeSimilarity(reply, studentCode) {
  if (!studentCode) return false;
  const words = (value) => value.toLowerCase().match(/[a-z_]\w*|\d+/g) ?? [];
  const ngrams = (value) => {
    const tokens = words(value);
    const result = new Set();
    for (let index = 0; index + 4 <= tokens.length; index += 1) {
      result.add(tokens.slice(index, index + 4).join(' '));
    }
    return result;
  };
  const source = ngrams(studentCode);
  if (source.size < 3) return false;
  const response = ngrams(reply);
  let overlap = 0;
  for (const token of response) if (source.has(token)) overlap += 1;
  return response.size > 0 && overlap / response.size >= 0.55;
}

function hasStepList(reply) {
  const numbered = reply.match(/(?:^|\n)\s*(?:\d+[.)]|[-*])\s+\S+/g) ?? [];
  if (numbered.length >= 3) return true;
  return (
    /\bfirst\b[\s\S]{0,300}\bthen\b[\s\S]{0,300}\bfinally\b/i.test(reply) ||
    /\bfirst\b[\s\S]{0,300}\bsecond\b[\s\S]{0,300}\bthird\b/i.test(reply)
  );
}

function heuristicBorderline(reply) {
  return /\b(?:sort|binary search|two pointers|dynamic programming|prefix sum|graph traversal)\b/i.test(
    reply,
  );
}

async function classifierRejects(llm, reply, level) {
  if (!llm.isRealProvider || env.AI_LEAK_CLASSIFIER !== 'on') return false;
  if (level > 2 && !heuristicBorderline(reply)) return false;
  const result = await llm.generate({
    system:
      'Classify whether the tutor reply reveals solution code, pseudocode, or a complete algorithm. Reply only LEAK or SAFE.',
    messages: [{ role: 'user', content: reply }],
    maxTokens: 20,
    timeoutMs: Math.min(env.LLM_TIMEOUT_MS, 5000),
  });
  const content = typeof result === 'string' ? result : result.content;
  if (!content || !/^(?:SAFE|LEAK)$/i.test(content.trim())) {
    throw new Error('Leak classifier returned an invalid response');
  }
  return /^LEAK$/i.test(content.trim());
}

export async function inspectTutorOutput({
  reply,
  level,
  studentCode,
  referenceCode,
  aiContext,
  llm,
}) {
  if (
    codeLeak(reply) ||
    codeSimilarity(reply, studentCode) ||
    codeSimilarity(reply, referenceCode) ||
    (level < 4 && hasStepList(reply))
  ) {
    return { allowed: false, reason: 'output_heuristic' };
  }
  const leakedCanary = (aiContext?.canaries ?? []).find(
    ({ phrase, level: canaryLevel }) =>
      canaryLevel > level && reply.toLowerCase().includes(phrase.toLowerCase()),
  );
  if (leakedCanary) {
    return { allowed: false, reason: 'canary', phrase: leakedCanary.phrase };
  }
  if (await classifierRejects(llm, reply, level)) {
    return { allowed: false, reason: 'leak_classifier' };
  }
  return { allowed: true };
}

export { REFUSAL };
