import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { env } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/utils/db.js';
import { inspectTutorOutput } from '../src/modules/ai/ai.guard.js';
import { llmClient } from '../src/modules/ai/llm/client.js';
import { Problem } from '../src/modules/problems/problem.model.js';

const notesShape = {
  edgeCases: 'an array of short student-facing edge-case prompts',
  commonMistakes: 'an array of likely reasoning mistakes',
  directionHint: 'one gentle direction hint',
  keyInsight: 'a concise level-3 insight',
  outline: 'a concise level-4 outline',
};

async function main() {
  const slug = process.argv[2];
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Usage: npm run generate-ai-notes -- <problem-slug>');
  }
  if (!llmClient.isRealProvider) {
    throw new Error('Set LLM_PROVIDER=openai and configure LLM_API_KEY before generating notes.');
  }

  await connectDb(env.MONGODB_URI);
  try {
    const problem = await Problem.findOne({ slug });
    if (!problem) throw new Error(`Problem not found: ${slug}`);
    const referenceDirectory = new URL(`../seed/reference/${slug}/`, import.meta.url);
    const referenceNames = (await readdir(referenceDirectory)).filter((name) =>
      name.startsWith('reference.'),
    );
    if (!referenceNames.length) throw new Error(`No reference solution found for ${slug}.`);
    const reference = (
      await Promise.all(
        referenceNames.map((name) => readFile(new URL(name, referenceDirectory), 'utf8')),
      )
    ).join('\n');

    const response = await llmClient.generate({
      system:
        'Draft grounded coding-tutor notes as JSON only. Do not include source code. Notes must be tiered: edgeCases and directionHint at L1, commonMistakes at L2, keyInsight at L3, outline at L4. Keep each field concise and do not give code.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            statement: problem.statementMd,
            inputFormat: problem.inputFormat,
            outputFormat: problem.outputFormat,
            constraints: problem.constraints,
            referenceSolution: reference,
            requiredFields: notesShape,
          }),
        },
      ],
      maxTokens: 1000,
    });
    const raw = typeof response === 'string' ? response : response.content;
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error('LLM response did not contain a JSON object.');
    const draft = JSON.parse(json);
    for (const [field, expected] of Object.entries(notesShape)) {
      if (field === 'edgeCases' || field === 'commonMistakes') {
        if (!Array.isArray(draft[field]) || draft[field].some((item) => typeof item !== 'string')) {
          throw new Error(`Generated notes have an invalid ${field} field.`);
        }
      } else if (typeof draft[field] !== 'string') {
        throw new Error(`Generated notes have an invalid ${field} field.`);
      }
      if (!expected) throw new Error(`Unexpected note field: ${field}`);
    }

    const insightCanary = `${slug}-insight-${randomBytes(4).toString('hex')}`;
    const outlineCanary = `${slug}-outline-${randomBytes(4).toString('hex')}`;
    draft.keyInsight = `${draft.keyInsight.trim()} (${insightCanary})`;
    draft.outline = `${draft.outline.trim()} (${outlineCanary})`;
    const canaries = [
      { phrase: insightCanary, level: 3 },
      { phrase: outlineCanary, level: 4 },
    ];
    const warnings = [];
    for (const [label, text, level] of [
      ...draft.edgeCases.map((text, index) => [`edgeCases[${index}]`, text, 1]),
      ...draft.commonMistakes.map((text, index) => [`commonMistakes[${index}]`, text, 2]),
      ['directionHint', draft.directionHint, 1],
    ]) {
      try {
        const result = await inspectTutorOutput({
          reply: text,
          level,
          referenceCode: reference,
          studentCode: reference,
          aiContext: { canaries },
          llm: llmClient,
        });
        if (!result.allowed) warnings.push(`${label}: ${result.reason}`);
      } catch {
        warnings.push(`${label}: leak classifier failed; manual review required`);
      }
    }

    problem.aiContext = {
      ...draft,
      canaries,
      reviewed: false,
      lintWarnings: warnings,
    };
    await problem.save();
    console.info(
      `Tutor notes saved for ${slug}; reviewed=false; lint warnings=${warnings.length}.`,
    );
    if (warnings.length) {
      for (const warning of warnings) console.warn(`- ${warning}`);
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((error) => {
  console.error(`AI notes generation failed: ${error.message}`);
  process.exitCode = 1;
});
