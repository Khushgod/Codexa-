import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/config/env.js';
import '../src/modules/ai/aiConversation.model.js';
import '../src/modules/judge/job.model.js';
import { seedProblems } from '../src/modules/problems/seed.service.js';
import '../src/modules/submissions/submission.model.js';
import { connectDb, disconnectDb } from '../src/utils/db.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(scriptDir, '../seed/problems');
const seedRoot = path.resolve(scriptDir, '../seed');

async function loadSeedEntries() {
  const files = (await readdir(seedDir)).filter((file) => file.endsWith('.json')).sort();
  if (files.length !== 5) {
    throw new Error(`Expected exactly 5 problem seed files in ${seedDir}; found ${files.length}.`);
  }

  const entries = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(path.join(seedDir, file), 'utf8'))),
  );
  for (const { referenceSolutions } of entries) {
    for (const referencePath of Object.values(referenceSolutions ?? {})) {
      const resolved = path.resolve(seedRoot, referencePath);
      if (!resolved.startsWith(`${seedRoot}${path.sep}`)) {
        throw new Error(`Reference solution path escapes the seed directory: ${referencePath}`);
      }
      await readFile(resolved);
    }
  }
  return entries;
}

try {
  const entries = await loadSeedEntries();
  await connectDb(env.MONGODB_URI);
  const result = await seedProblems(entries);
  console.log(`Seeded ${result.problems} problems and ${result.testCases} test cases.`);
} catch (err) {
  console.error(`Seeding failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
