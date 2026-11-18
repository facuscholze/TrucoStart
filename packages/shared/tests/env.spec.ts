import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_NAME, parseServerEnv } from '../src/index.js';

const validBaseEnv: Record<string, string> = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://truco_dev:secret@localhost:5432/truco_dev',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef_valid_secret',
  SEED_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  CORS_ORIGINS: 'http://localhost:5173, http://localhost:5174',
  EMAIL_PROVIDER: 'console',
  CAPTCHA_PROVIDER: 'disabled',
};

describe('ServerEnvSchema & parseServerEnv', () => {
  it('parses valid environment configuration and applies defaults', () => {
    const parsed = parseServerEnv(validBaseEnv);

    expect(parsed.APP_NAME).toBe(DEFAULT_APP_NAME);
    expect(parsed.API_PORT).toBe(3001);
    expect(parsed.GAME_SERVER_PORT).toBe(3002);
    expect(parsed.TURN_TIMEOUT_MS).toBe(30_000);
    expect(parsed.RECONNECT_GRACE_MS).toBe(45_000);
    expect(parsed.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
  });

  it('fails fast when SESSION_SECRET is shorter than 32 characters', () => {
    expect(() =>
      parseServerEnv({
        ...validBaseEnv,
        SESSION_SECRET: 'too_short',
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('fails fast when DATABASE_URL is not a PostgreSQL URL', () => {
    expect(() =>
      parseServerEnv({
        ...validBaseEnv,
        DATABASE_URL: 'mysql://localhost:3306/db',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('requires RESEND_API_KEY + EMAIL_FROM_ADDRESS (o SMTP_CONNECTION_URL) cuando EMAIL_PROVIDER es productivo', () => {
    expect(() =>
      parseServerEnv({
        ...validBaseEnv,
        EMAIL_PROVIDER: 'resend',
      }),
    ).toThrow(/RESEND_API_KEY/);
    expect(() =>
      parseServerEnv({
        ...validBaseEnv,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_xxx',
      }),
    ).toThrow(/EMAIL_FROM_ADDRESS/);
    expect(() =>
      parseServerEnv({
        ...validBaseEnv,
        EMAIL_PROVIDER: 'smtp',
        EMAIL_FROM_ADDRESS: 'a@b.co',
      }),
    ).toThrow(/SMTP_CONNECTION_URL/);
  });

  it('requires CAPTCHA_SITE_KEY and CAPTCHA_SECRET when CAPTCHA_PROVIDER is turnstile', () => {
    expect(() =>
      parseServerEnv({
        ...validBaseEnv,
        CAPTCHA_PROVIDER: 'turnstile',
      }),
    ).toThrow(/CAPTCHA_SECRET/);
  });
});
