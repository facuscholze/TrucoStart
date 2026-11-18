import { mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * Suite de tests lentos del motor (benchmark de bots, simulaciones masivas
 * con fast-check). Se ejecutan en un job separado de CI para no alargar el
 * ciclo rápido de feedback en `pnpm test` local.
 *
 * Los archivos `*.slow.spec.ts` están excluidos de la suite por defecto.
 */
export default mergeConfig(base, {
  test: {
    include: ['tests/**/*.slow.spec.ts'],
    exclude: [],
    testTimeout: 180_000,
  },
});
