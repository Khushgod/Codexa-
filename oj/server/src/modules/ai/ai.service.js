import { env } from '../../config/env.js';
import { readdir, readFile } from 'node:fs/promises';
import { AppError, notFound } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import * as problemService from '../problems/problem.service.js';
import * as submissionService from '../submissions/submission.service.js';
import { AiConversation } from './aiConversation.model.js';
import { buildTutorContext, sanitizeUserText } from './ai.context.js';
import { inspectTutorOutput, REFUSAL } from './ai.guard.js';
import { llmClient } from './llm/client.js';

const cannedReplyCache = new Map();
const referenceCache = new Map();
const EXPLICIT_UNLOCK_LEVELS = new Set([3, 4]);

function isReviewed(problem) {
  return problem.aiContext?.reviewed && !problem.aiContext?.lintWarnings?.length;
}

export function fallbackReply(problem, level) {
  const context = problem.aiContext ?? {};
  if (!isReviewed(problem)) {
    return "Let's identify what the statement asks you to find. Which part should we clarify first?";
  }
  if (level >= 3 && context.keyInsight) return context.keyInsight;
  if (level >= 2 && context.commonMistakes?.length) {
    return `Check whether your approach handles ${context.commonMistakes[0]}.`;
  }
  if (context.directionHint) return context.directionHint;
  if (context.edgeCases?.length) return `Consider this boundary: ${context.edgeCases[0]}.`;
  return 'Let’s identify what the input asks you to find. Which part should we clarify first?';
}

function publicConversation(conversation, level, nextUnlock, cooldownMs) {
  return {
    id: String(conversation._id),
    hintLevelUnlocked: level,
    nextUnlock,
    cooldownMs,
    messages: conversation.messages
      .map((message, index) => ({ ...(message.toObject?.() ?? message), index }))
      .filter((message) => message.level <= level),
  };
}

async function loadConversation(userId, problemId) {
  let conversation = await AiConversation.findOne({ userId, problemId });
  if (!conversation) {
    try {
      conversation = await AiConversation.create({ userId, problemId });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      conversation = await AiConversation.findOne({ userId, problemId });
      if (!conversation) throw error;
    }
  }
  return conversation;
}

async function currentLevel(conversation, problem, attempts) {
  if (!isReviewed(problem)) {
    const needsPrune =
      conversation.hintLevelUnlocked > 1 ||
      conversation.summary.level > 1 ||
      conversation.messages.some((message) => message.level > 1);
    if (needsPrune) {
      conversation.hintLevelUnlocked = 1;
      conversation.messages = conversation.messages.filter((message) => message.level <= 1);
      conversation.summary = { text: '', level: 1 };
      await conversation.save();
    }
    return 1;
  }

  const timeUnlockAt = conversation.createdAt.getTime() + env.AI_L2_UNLOCK_MINUTES * 60 * 1000;
  const autoLevel = attempts > 0 || Date.now() >= timeUnlockAt ? 2 : 1;
  const eligibleCeiling = attempts >= 3 ? 4 : 2;
  const level = Math.max(autoLevel, Math.min(conversation.hintLevelUnlocked, eligibleCeiling));
  const needsPrune =
    level !== conversation.hintLevelUnlocked ||
    conversation.summary.level > level ||
    conversation.messages.some((message) => message.level > level);
  if (needsPrune) {
    conversation.hintLevelUnlocked = level;
    conversation.messages = conversation.messages.filter((message) => message.level <= level);
    if (conversation.summary.level > level) conversation.summary = { text: '', level };
    await conversation.save();
  }
  return level;
}

async function loadState(userId, problemId) {
  const problem = await problemService.getPublishedProblemForTutor(problemId);
  if (!problem) throw notFound('Published problem not found');
  const conversation = await loadConversation(userId, problem._id);
  const submission = await submissionService.getTutorSubmissionContext(userId, problem._id);
  const level = await currentLevel(conversation, problem, submission.countedAttempts);
  const cooldownMs = conversation.lastUnlockAt
    ? Math.max(
        0,
        conversation.lastUnlockAt.getTime() + env.AI_UNLOCK_COOLDOWN_SEC * 1000 - Date.now(),
      )
    : 0;
  let nextUnlock = null;
  if (level < 2 && (submission.countedAttempts > 0 || level === 1)) nextUnlock = 2;
  if (level === 2 && submission.countedAttempts >= 3) nextUnlock = 3;
  if (level === 3 && cooldownMs === 0) nextUnlock = 4;
  return { problem, conversation, submission, level, nextUnlock, cooldownMs };
}

async function collectModelReply(input) {
  if (typeof llmClient.stream !== 'function') {
    const result = await llmClient.generate(input);
    return typeof result === 'string' ? { content: result, usage: {} } : result;
  }
  let content = '';
  let usage = {};
  for await (const chunk of llmClient.stream(input)) {
    if (typeof chunk === 'string') content += chunk;
    else usage = chunk.usage ?? usage;
  }
  return { content, usage };
}

async function loadReferenceCode(slug) {
  if (referenceCache.has(slug)) return referenceCache.get(slug);
  try {
    const directory = new URL(`../../../seed/reference/${slug}/`, import.meta.url);
    const names = (await readdir(directory)).filter((name) => name.startsWith('reference.'));
    const code = (
      await Promise.all(names.map((name) => readFile(new URL(name, directory), 'utf8')))
    ).join('\n');
    referenceCache.set(slug, code);
    return code;
  } catch (error) {
    if (error.code === 'ENOENT') {
      referenceCache.set(slug, '');
      return '';
    }
    throw error;
  }
}

function cannedKey(message) {
  const normalized = message.trim().toLowerCase();
  if (normalized === 'explain the problem') return 'explain';
  if (normalized === 'what edge cases am i missing?') return 'edge-cases';
  return null;
}

export async function validateChatRequest(input) {
  const safeInput = validateChatInput(input);
  const problem = await problemService.getPublishedProblemForTutor(safeInput.problemId);
  if (!problem) throw notFound('Published problem not found');
  return safeInput;
}

export async function getConversation(userId, problemId) {
  const state = await loadState(userId, problemId);
  return {
    ...publicConversation(state.conversation, state.level, state.nextUnlock, state.cooldownMs),
    countedAttempts: state.submission.countedAttempts,
  };
}

export async function unlockNextHint(userId, problemId) {
  const state = await loadState(userId, problemId);
  if (!isReviewed(state.problem)) {
    throw new AppError('HINTS_UNAVAILABLE', 409, 'Reviewed tutor notes are not available yet.');
  }
  const target = state.level + 1;
  if (!EXPLICIT_UNLOCK_LEVELS.has(target)) {
    throw new AppError('HINT_NOT_READY', 409, 'The next hint unlocks after more time or attempts.');
  }
  if (target === 3 && state.submission.countedAttempts < 3) {
    throw new AppError(
      'HINT_NOT_READY',
      409,
      'Submit three distinct, runnable attempts before unlocking this hint.',
    );
  }
  if (state.conversation.lastUnlockAt && state.cooldownMs > 0) {
    throw new AppError(
      'UNLOCK_COOLDOWN',
      429,
      `Wait ${Math.ceil(state.cooldownMs / 1000)} seconds before unlocking another hint.`,
    );
  }
  state.conversation.hintLevelUnlocked = target;
  state.conversation.lastUnlockAt = new Date();
  await state.conversation.save();
  return {
    hintLevelUnlocked: target,
    nextUnlock: target === 3 ? 4 : null,
    cooldownMs: env.AI_UNLOCK_COOLDOWN_SEC * 1000,
  };
}

export async function chat(userId, input) {
  const message = sanitizeUserText(input.message, 'message');
  const editorCode = sanitizeUserText(input.editorCode ?? '', 'code');
  if (!message.trim()) throw new AppError('VALIDATION_ERROR', 400, 'Message cannot be empty.');

  const state = await loadState(userId, input.problemId);
  const context = buildTutorContext({
    problem: state.problem,
    level: state.level,
    summary: state.conversation.summary,
    messages: state.conversation.messages,
    editorCode: editorCode || state.submission.latestCode,
    lastVerdict: state.submission.lastVerdict,
    failedCategory: state.submission.failedCategory,
  });
  const studentCode = editorCode || state.submission.latestCode;
  const cachedAction = context.level <= 1 ? cannedKey(message) : null;
  const cacheKey = cachedAction
    ? `${state.problem._id}:${state.problem.updatedAt?.getTime() ?? 0}:${context.level}:${cachedAction}`
    : null;

  const generationContext = cacheKey
    ? buildTutorContext({
        problem: state.problem,
        level: context.level,
        messages: [],
        editorCode: '',
        lastVerdict: '',
        failedCategory: '',
      })
    : context;
  const priorMessages = generationContext.messages;
  priorMessages.push({
    role: 'user',
    content: `<student_message>${message}</student_message>`,
  });

  let reply;
  let usage = {};
  let replaced = false;
  let cacheHit = false;
  try {
    cacheHit = Boolean(cacheKey && cannedReplyCache.has(cacheKey));
    const result = cacheHit
      ? { content: cannedReplyCache.get(cacheKey), usage: {} }
      : await collectModelReply({
          system: generationContext.system,
          messages: priorMessages,
          maxTokens: env.AI_MAX_TOKENS,
        });
    reply = result.content?.trim();
    usage = result.usage ?? {};
    if (!reply || reply.split(/\s+/).length > 150) throw new Error('LLM response exceeded limits');
    const referenceCode = await loadReferenceCode(state.problem.slug);
    const inspection = await inspectTutorOutput({
      reply,
      level: context.level,
      studentCode,
      referenceCode,
      aiContext: state.problem.aiContext,
      llm: llmClient,
    });
    if (!inspection.allowed) {
      replaced = true;
      reply = REFUSAL;
      if (inspection.reason === 'canary') {
        logger.error({
          event: 'ai.leak_detected',
          problemId: String(state.problem._id),
          phrase: inspection.phrase,
        });
      }
    } else if (cacheKey) {
      if (cannedReplyCache.size >= 500) {
        cannedReplyCache.delete(cannedReplyCache.keys().next().value);
      }
      cannedReplyCache.set(cacheKey, reply);
    }
  } catch (error) {
    logger.warn({ event: 'ai.provider_failed', error: error.message });
    reply = fallbackReply(state.problem, context.level);
    replaced = true;
    const referenceCode = await loadReferenceCode(state.problem.slug);
    const fallbackInspection = await inspectTutorOutput({
      reply,
      level: context.level,
      referenceCode,
      aiContext: state.problem.aiContext,
      llm: { isRealProvider: false },
    });
    if (!fallbackInspection.allowed || reply.split(/\s+/).length > 150) {
      reply = REFUSAL;
      if (fallbackInspection.reason === 'canary') {
        logger.error({
          event: 'ai.leak_detected',
          problemId: String(state.problem._id),
          phrase: fallbackInspection.phrase,
        });
      }
    }
  }

  state.conversation.messages.push(
    { role: 'user', content: message, level: context.level },
    { role: 'assistant', content: reply, level: context.level },
  );
  if (state.conversation.messages.length > 20) {
    const older = state.conversation.messages.slice(0, -10);
    state.conversation.summary = {
      text: older
        .filter((entry) => entry.level <= context.level)
        .map((entry) => `${entry.role}: ${entry.content}`)
        .join('\n')
        .slice(-4000),
      level: context.level,
    };
    state.conversation.messages = state.conversation.messages.slice(-10);
  }
  const promptTokens =
    usage.prompt ??
    (cacheHit
      ? 0
      : Math.ceil(
          priorMessages.reduce((size, item) => size + item.content.length, context.system.length) /
            4,
        ));
  const completionTokens = usage.completion ?? (cacheHit ? 0 : Math.ceil(reply.length / 4));
  state.conversation.tokenUsage.prompt += promptTokens;
  state.conversation.tokenUsage.completion += completionTokens;
  state.conversation.tokenUsage.total += usage.total ?? promptTokens + completionTokens;
  await state.conversation.save();
  return { reply, replaced, level: context.level };
}

export function validateChatInput(input) {
  const message = sanitizeUserText(input.message, 'message');
  if (!message.trim()) throw new AppError('VALIDATION_ERROR', 400, 'Message cannot be empty.');
  return {
    ...input,
    message,
    editorCode: sanitizeUserText(input.editorCode ?? '', 'code'),
  };
}

export async function rateReply(userId, { problemId, messageIndex, rating }) {
  const conversation = await AiConversation.findOne({ userId, problemId });
  const message = conversation?.messages[messageIndex];
  if (!message || message.role !== 'assistant') throw notFound('Tutor reply not found');
  message.feedback = rating;
  await conversation.save();
}
