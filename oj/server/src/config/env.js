import { isIP } from 'node:net';
import { setServers } from 'node:dns';
import { z } from 'zod';

/**
 * The only place in the server that reads process.env (enforced by ESLint).
 * The app refuses to boot if any value is missing or invalid.
 */

const intFromEnv = (fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: intFromEnv(4000, { max: 65535 }),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
    DNS_SERVERS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((server) => server.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(z.string().refine((value) => isIP(value) !== 0, 'must be an IPv4 or IPv6 address')),
      ),

    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ACCESS_TTL_SEC: intFromEnv(900, { min: 60, max: 86400 }),
    REFRESH_TOKEN_TTL_DAYS: intFromEnv(14, { max: 90 }),

    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    AUTH_RATE_LIMIT_MAX: intFromEnv(20),
    AUTH_RATE_LIMIT_WINDOW_MIN: intFromEnv(15, { max: 1440 }),

    TRUST_PROXY: z
      .enum(['0', '1'])
      .default('0')
      .transform((value) => value === '1'),

    SANDBOX_DRIVER: z.enum(['docker', 'fake']).default('docker'),
    JUDGE_IMAGE: z.string().min(1).default('oj-judge-runtime:dev'),
    JUDGE_CONCURRENCY: intFromEnv(1, { max: 32 }),
    JUDGE_MAX_ATTEMPTS: intFromEnv(3, { max: 10 }),
    JUDGE_LEASE_SEC: intFromEnv(60, { min: 10, max: 600 }),
    JUDGE_JOB_RETENTION_DAYS: intFromEnv(30, { max: 365 }),
    JUDGE_CPUSET: z
      .string()
      .default('')
      .refine(
        (value) => value === '' || /^[0-9,-]+$/.test(value),
        'must be a CPU list such as 0 or 0-2',
      ),

    LLM_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    LLM_MODEL: z.string().min(1).default('gpt-4o-mini'),
    LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    LLM_API_KEY: z.string().default(''),
    LLM_TIMEOUT_MS: intFromEnv(15_000, { min: 1000, max: 120_000 }),
    AI_MAX_TOKENS: intFromEnv(400, { min: 32, max: 1000 }),
    AI_DAILY_MESSAGE_LIMIT: intFromEnv(30, { max: 1000 }),
    AI_MIN_ATTEMPT_CHARS: intFromEnv(20, { max: 1000 }),
    AI_L2_UNLOCK_MINUTES: intFromEnv(15, { max: 1440 }),
    AI_UNLOCK_COOLDOWN_SEC: intFromEnv(300, { max: 86_400 }),
    AI_LEAK_CLASSIFIER: z.enum(['on', 'off']).default('on'),
    AI_REDTEAM_LIVE: z
      .enum(['0', '1'])
      .default('0')
      .transform((value) => value === '1'),
  })
  .superRefine((value, ctx) => {
    if (value.LLM_PROVIDER === 'openai' && !value.LLM_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_API_KEY'],
        message: 'is required when LLM_PROVIDER=openai',
      });
    }
  });

/**
 * @typedef {z.infer<typeof envSchema>} Env
 */

/**
 * Validate an env-like object. Empty strings are treated as "not set" so that
 * blank lines copied from .env.example fall back to defaults (or fail if required).
 * @param {Record<string, string | undefined>} source
 * @returns {Readonly<Env>}
 */
export function parseEnv(source) {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return Object.freeze(result.data);
}

function loadEnv() {
  try {
    return parseEnv(process.env);
  } catch (err) {
    // The logger depends on env, so report directly and refuse to boot.
    // eslint-disable-next-line no-console
    console.error(`${err.message}\nSee .env.example for every variable.`);
    process.exit(1);
  }
}

/** @type {Readonly<Env>} */
export const env = loadEnv();

if (env.DNS_SERVERS.length > 0) setServers(env.DNS_SERVERS);

export const isProduction = env.NODE_ENV === 'production';
