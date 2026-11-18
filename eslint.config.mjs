import { createEslintConfig } from './packages/config/eslint.base.mjs';

export default [
  ...createEslintConfig(),
  {
    // Los escenarios k6 usan globales inyectados por el runtime (__ENV, __VU,
    // __ITER, k6/ws/http); se evita que ESLint los marque como indefinidos.
    files: ['perf/k6/**/*.js'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
      },
    },
  },
  {
    // Scripts de CLI pueden escribir por stdout/stderr.
    files: ['scripts/**/*.{js,mjs,ts}', 'apps/*/scripts/**/*.{js,mjs,ts}'],
    rules: { 'no-console': 'off' },
  },
];
