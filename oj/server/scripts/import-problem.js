import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { env } from '../src/config/env.js';
import '../src/models.js';
import { importProblem } from '../src/modules/problems/problem.service.js';
import { connectDb, disconnectDb } from '../src/utils/db.js';

const [filePath, ...extraArgs] = process.argv.slice(2);
if (!filePath || extraArgs.length > 0) {
  console.error('Usage: npm run import-problem -- <file.json>');
  process.exit(1);
}

try {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const resolvedFilePath = path.resolve(projectRoot, filePath);
  const input = JSON.parse(await readFile(resolvedFilePath, 'utf8'));
  await connectDb(env.MONGODB_URI);
  const result = await importProblem(input);
  console.log(
    `Imported "${result.problem.slug}" as unpublished scraped content with ${result.testCaseCount} test cases.`,
  );
} catch (err) {
  console.error(`Problem import failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
