import { defineConfig } from 'vitest/config';

/**
 * Suite de tests lentos del motor (benchmark de bots, simulaciones masivas
 * con fast-check). Se ejecutan en un job separado de CI para no alargar el
 * ciclo rápido de feedback en `pnpm test` local.
 *
 * Los archivos `*.slow.spec.ts` están excluidos de la suite por defecto por
 * `vitest.config.ts`; este config los corre exclusivamente.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.slow.spec.ts'],
    exclude: [],
    testTimeout: 180_000,
  },
});
