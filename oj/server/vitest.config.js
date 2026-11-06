import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/globalSetup.js'],
    // Test-only values; never real secrets. MONGODB_URI is a placeholder:
    // each test file connects to its own mongodb-memory-server instance.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      MONGODB_URI: 'mongodb://127.0.0.1:1/placeholder',
      JWT_ACCESS_SECRET: 'test-only-secret-that-is-long-enough-1234567890',
      AUTH_RATE_LIMIT_MAX: '1000',
      CORS_ORIGINS: 'http://localhost:5173',
    },
    // First run downloads a MongoDB binary for mongodb-memory-server.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
