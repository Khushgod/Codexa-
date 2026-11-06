import { env } from './config/env.js';
import { createApp } from './app.js';
import './models.js';
import { connectDb, disconnectDb } from './utils/db.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDb(env.MONGODB_URI);

  const server = createApp().listen(env.PORT, () => {
    logger.info({ event: 'api.listening', port: env.PORT }, `API listening on :${env.PORT}`);
  });

  const shutdown = (signal) => {
    logger.info({ event: 'api.shutdown', signal }, 'Shutting down');
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    // Force exit if connections do not drain in time.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err, event: 'api.startup_failed' }, 'API failed to start');
  process.exit(1);
});
