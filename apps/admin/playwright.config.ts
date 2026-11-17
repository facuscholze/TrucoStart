import { defineConfig } from '@playwright/test';

/**
 * E2E del panel administrativo contra la API real (stack `e2e-stack.ts`).
 * Requiere build previo de `@truco/admin` y `@truco/web`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    locale: 'es-AR',
  },
  webServer: [
    {
      command: 'pnpm --filter @truco/api exec tsx scripts/e2e-stack.ts',
      cwd: '../..',
      url: 'http://127.0.0.1:3001/v1/health',
      env: { E2E_ADMIN: '1' },
      reuseExistingServer: !process.env['CI'],
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @truco/admin exec vite preview --host 0.0.0.0 --port 5174',
      cwd: '../..',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: !process.env['CI'],
      timeout: 45_000,
    },
    {
      command: 'pnpm --filter @truco/web exec vite preview --host 0.0.0.0 --port 4173',
      cwd: '../..',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env['CI'],
      timeout: 45_000,
    },
  ],
});
