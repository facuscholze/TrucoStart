import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'es-AR',
  },
  webServer: [
    {
      command: 'pnpm --filter @truco/api exec tsx scripts/e2e-stack.ts',
      cwd: '../..',
      url: 'http://127.0.0.1:3001/v1/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
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
