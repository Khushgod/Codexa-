import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

const valid = {
  MONGODB_URI: 'mongodb://localhost:27017/oj',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults for optional values', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.JWT_ACCESS_TTL_SEC).toBe(900);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.DNS_SERVERS).toEqual([]);
    expect(env.SANDBOX_DRIVER).toBe('docker');
    expect(env.JUDGE_IMAGE).toBe('oj-judge-runtime:dev');
    expect(env.JUDGE_CONCURRENCY).toBe(1);
    expect(env.JUDGE_MAX_ATTEMPTS).toBe(3);
    expect(env.JUDGE_LEASE_SEC).toBe(60);
    expect(env.JUDGE_JOB_RETENTION_DAYS).toBe(30);
  });

  it('refuses to boot without MONGODB_URI', () => {
    expect(() => parseEnv({ JWT_ACCESS_SECRET: valid.JWT_ACCESS_SECRET })).toThrow(/MONGODB_URI/);
  });

  it('treats empty strings as missing', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: '' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('rejects a non-mongodb URI', () => {
    expect(() => parseEnv({ ...valid, MONGODB_URI: 'http://example.com' })).toThrow(/MONGODB_URI/);
  });

  it('rejects an invalid port', () => {
    expect(() => parseEnv({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => parseEnv({ ...valid, PORT: '70000' })).toThrow(/PORT/);
  });

  it('parses a comma-separated CORS list', () => {
    const env = parseEnv({ ...valid, CORS_ORIGINS: 'http://a.test, http://b.test,' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('parses and validates optional DNS resolver addresses', () => {
    const env = parseEnv({ ...valid, DNS_SERVERS: '1.1.1.1, 8.8.8.8' });
    expect(env.DNS_SERVERS).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(() => parseEnv({ ...valid, DNS_SERVERS: 'not-an-ip' })).toThrow(/DNS_SERVERS/);
  });

  it('validates judge runtime settings', () => {
    expect(() => parseEnv({ ...valid, SANDBOX_DRIVER: 'invalid' })).toThrow(/SANDBOX_DRIVER/);
    expect(() => parseEnv({ ...valid, JUDGE_CONCURRENCY: '0' })).toThrow(/JUDGE_CONCURRENCY/);
    expect(() => parseEnv({ ...valid, JUDGE_LEASE_SEC: '5' })).toThrow(/JUDGE_LEASE_SEC/);
    expect(() => parseEnv({ ...valid, JUDGE_CPUSET: 'not-a-cpu-list' })).toThrow(/JUDGE_CPUSET/);
    expect(parseEnv({ ...valid, SANDBOX_DRIVER: 'fake', JUDGE_CPUSET: '0-2' })).toMatchObject({
      SANDBOX_DRIVER: 'fake',
      JUDGE_CPUSET: '0-2',
    });
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(parseEnv(valid))).toBe(true);
  });
});
