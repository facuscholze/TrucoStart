import { describe, expect, it } from 'vitest';
import {
  generateGuestNickname,
  LoginRequestSchema,
  normalizeNicknameLower,
  PatchMeRequestSchema,
  RegisterRequestSchema,
  validateNickname,
} from '../src/index.js';

describe('@truco/shared M3 Auth & Users schemas and nickname profanity filter', () => {
  it('normalizes nicknames case-insensitively and blocks offensive, obfuscated, and custom configured terms', () => {
    expect(normalizeNicknameLower('  ElTruquero_99 ')).toBe('eltruquero_99');
    expect(validateNickname('ElTruquero_99').valid).toBe(true);

    // Términos ofensivos directos, con tildes o l33tspeak
    expect(validateNickname('puto_rey').valid).toBe(false);
    expect(validateNickname('P_U_T_0').valid).toBe(false);
    expect(validateNickname('pél0tud0').valid).toBe(false);
    expect(validateNickname('Admin_Oficial').valid).toBe(false);

    // Filtro configurable con palabras adicionales en tiempo de ejecución
    expect(validateNickname('MarcaProhibida').valid).toBe(true);
    expect(
      validateNickname('MarcaProhibida99', { extraBlockedTerms: ['marcaprohibida'] }).valid,
    ).toBe(false);

    // Apodo de invitado generado válido y limpio
    const guestNick = generateGuestNickname(new Uint8Array([2, 5, 11, 19, 23, 29]));
    expect(validateNickname(guestNick).valid).toBe(true);
  });

  it('validates strict Auth & Users payloads and rejects unknown fields', () => {
    const parsed = RegisterRequestSchema.parse({
      email: '  FACU@Example.COM ',
      password: 'ClaveSegura123',
      nickname: 'FacuCordoba',
      legal: { accepted: true },
    });
    expect(parsed.email).toBe('facu@example.com');

    // M8d: el alta sin aceptación explícita ya no es un payload válido.
    expect(
      RegisterRequestSchema.safeParse({
        email: 'facu@example.com',
        password: 'ClaveSegura123',
        nickname: 'FacuCordoba',
      }).success,
    ).toBe(false);
    expect(
      RegisterRequestSchema.safeParse({
        email: 'facu@example.com',
        password: 'ClaveSegura123',
        nickname: 'FacuCordoba',
        legal: { accepted: false },
      }).success,
    ).toBe(false);
    // Un documento desconocido tampoco se acepta (contrato cerrado).
    expect(
      RegisterRequestSchema.safeParse({
        email: 'facu@example.com',
        password: 'ClaveSegura123',
        nickname: 'FacuCordoba',
        legal: { accepted: true, versions: { algo_inventado: '1' } },
      }).success,
    ).toBe(false);

    // Propiedades no declaradas rechazadas (.strict())
    expect(
      LoginRequestSchema.safeParse({
        email: 'facu@example.com',
        password: 'ClaveSegura123',
        role: 'ADMIN',
      }).success,
    ).toBe(false);

    expect(
      PatchMeRequestSchema.safeParse({
        bio: 'Mano brava en Córdoba',
        isAdmin: true,
      }).success,
    ).toBe(false);
  });
});
