import type { Rng } from './types.js';

/**
 * Generador determinista Mulberry32 (32-bit) para simulaciones reproducibles y tests.
 * Para partidas reales el Game Server inyecta un adaptador respaldado por CSPRNG (`crypto.randomBytes`).
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    nextFloat(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
