import { afterAll, afterEach, beforeAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../../src/utils/db.js';

/** Start an in-memory MongoDB for the current test file and wipe data between tests. */
export function useTestDb() {
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectDb(mongod.getUri('oj-test'));
  });

  afterEach(async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  });

  afterAll(async () => {
    await disconnectDb();
    await mongod?.stop();
  });
}
