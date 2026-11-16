import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../bootstrap.js';
import { createAdaptiveTestDatabase, type DatabaseConnectionHandle } from '../database.provider.js';
import { DEV_SEED_ACCOUNTS, DEV_SEED_PASSWORD, seedDevelopmentUsers } from '../seed-dev.js';

const SECRET = 'pre-m5-dev-seed-test-secret-minimum-32-chars!!';

describe('Pre-M5 Item 4: Development Seed (db:seed:dev)', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    app = await createApiApp({
      dbHandle,
      authOptions: { runtimeConfig: { sessionSecret: SECRET } },
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  it('refuses to run when nodeEnv is production', async () => {
    await expect(seedDevelopmentUsers(dbHandle.db, { nodeEnv: 'production' })).rejects.toThrow(
      /prohibido/,
    );
  });

  it('seeds test accounts idempotently and allows immediate login via POST /v1/auth/login', async () => {
    const firstRun = await seedDevelopmentUsers(dbHandle.db, { nodeEnv: 'development' });
    expect(firstRun).toEqual({ inserted: DEV_SEED_ACCOUNTS.length, skipped: 0 });

    const secondRun = await seedDevelopmentUsers(dbHandle.db, { nodeEnv: 'development' });
    expect(secondRun).toEqual({ inserted: 0, skipped: DEV_SEED_ACCOUNTS.length });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: DEV_SEED_ACCOUNTS[0]!.email,
        password: DEV_SEED_PASSWORD,
      },
    });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json<{ user: { nickname: string; email: string } }>().user).toMatchObject({
      email: DEV_SEED_ACCOUNTS[0]!.email,
      nickname: DEV_SEED_ACCOUNTS[0]!.nickname,
    });
  });
});
