import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export function createEslintConfig(options = {}) {
  const { isBrowser = false, allowDecorators = false } = options;

  return tseslint.config(
    {
      ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.turbo/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: {
          ...globals.node,
          ...(isBrowser ? globals.browser : {}),
        },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/consistent-type-imports': allowDecorators
          ? 'off'
          : ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      },
    },
    eslintConfigPrettier,
  );
}

export default createEslintConfig();
