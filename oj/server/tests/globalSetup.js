import { MongoBinary } from 'mongodb-memory-server';

/**
 * Download the MongoDB binary once before test files start in parallel;
 * otherwise concurrent first-time downloads race on the cache lockfile.
 */
export default async function setup() {
  await MongoBinary.getPath();
}
