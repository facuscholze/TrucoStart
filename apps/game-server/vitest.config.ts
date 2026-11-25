import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    setupFiles: ['../../scripts/testing/require-real-services.mjs'],
  },
});
