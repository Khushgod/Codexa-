import mongoose from 'mongoose';
import { logger } from './logger.js';

/**
 * Connect to MongoDB and make sure every registered model's indexes exist
 * (unique constraints must be in place before we accept traffic).
 * @param {string} uri
 */
export async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  logger.info({ event: 'db.connected' }, 'MongoDB connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}
