import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../utils/AppError.js';

const SYSTEM_PROMPT = await readFile(
  fileURLToPath(new URL('./prompts/tutor.system.md', import.meta.url)),
  'utf8',
);

function neutralizeDelimiters(value) {
  return value
    .normalize('NFKC')
    .replace(/<\s*\/?\s*student[\s_-]*code\s*>/gi, '[student-code delimiter removed]')
    .replace(/<\s*\/?\s*student[\s_-]*message\s*>/gi, '[student-message delimiter removed]');
}

export function sanitizeUserText(value, kind = 'message') {
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', 400, 'Tutor input must be text.');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'Tutor input contains unsupported control characters.',
    );
  }
  const maxLength = kind === 'code' ? 20_000 : 2000;
  const maxLines = kind === 'code' ? 200 : Number.MAX_SAFE_INTEGER;
  const normalized = neutralizeDelimiters(value);
  if (kind === 'code') {
    return normalized.split(/\r?\n/).slice(0, maxLines).join('\n').slice(0, maxLength);
  }
  if (normalized.length > maxLength) {
    throw new AppError('VALIDATION_ERROR', 400, 'Tutor input exceeds the allowed size.');
  }
  if (kind === 'message' && /\S{251,}/.test(normalized)) {
    throw new AppError('VALIDATION_ERROR', 400, 'Please break up unusually long unspaced text.');
  }
  return normalized;
}

export function buildGatedNotes(aiContext = {}, level = 1) {
  const notes = [];
  for (const [label, value, requiredLevel] of [
    ['Edge cases', aiContext.edgeCases?.join('\n'), 1],
    ['Common mistakes', aiContext.commonMistakes?.join('\n'), 2],
    ['Direction hint', aiContext.directionHint, 1],
    ['Key insight', aiContext.keyInsight, 3],
    ['Outline', aiContext.outline, 4],
  ]) {
    if (requiredLevel <= level && value) notes.push(`${label}: ${value}`);
  }
  return notes.join('\n');
}

export function buildTutorContext({
  problem,
  level,
  summary,
  messages,
  editorCode,
  lastVerdict,
  failedCategory,
}) {
  const notesEnabled = problem.aiContext?.reviewed && !problem.aiContext?.lintWarnings?.length;
  const safeLevel = notesEnabled ? level : Math.min(level, 1);
  const notes = notesEnabled ? buildGatedNotes(problem.aiContext, safeLevel) : '';
  const statement = [
    problem.statementMd,
    `Input format: ${problem.inputFormat}`,
    `Output format: ${problem.outputFormat}`,
    `Constraints: ${(problem.constraints ?? []).join('; ')}`,
    ...(problem.sampleTestCases ?? []).map(
      (sample, index) =>
        `Sample ${index + 1}:\nInput:\n${sample.input}\nExpected output:\n${sample.expectedOutput}`,
    ),
  ].join('\n');
  const system = SYSTEM_PROMPT.replaceAll('{title}', problem.title)
    .replaceAll('{level}', String(safeLevel))
    .replace('{statement}', statement)
    .replace('{notes}', notes || 'No reviewed teaching notes are available.');
  const history = [];
  if (summary?.text && summary.level <= safeLevel) {
    history.push({ role: 'assistant', content: `Earlier discussion summary: ${summary.text}` });
  }
  for (const message of messages ?? []) {
    if (message.level <= safeLevel) {
      history.push({
        role: message.role,
        content:
          message.role === 'user'
            ? `<student_message>${message.content}</student_message>`
            : message.content,
      });
    }
  }
  const context = [
    editorCode ? `<student_code>\n${editorCode}\n</student_code>` : '',
    lastVerdict ? `Latest submission verdict: ${lastVerdict}` : '',
    failedCategory ? `Failed category (no test data): ${failedCategory}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  if (context) history.push({ role: 'user', content: `Platform context:\n${context}` });
  return { system, messages: history, level: safeLevel, notes };
}
