import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  verifyTotpCode,
} from '../security/totp.js';

/** Semilla ASCII de los vectores oficiales del RFC 6238, Apéndice B (HMAC-SHA1). */
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_BASE32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, 'ascii'));

/** Vectores oficiales RFC 6238 §Appendix B (TOTP de 8 dígitos, SHA-1). */
const RFC_VECTORS: ReadonlyArray<{ seconds: number; code: string }> = [
  { seconds: 59, code: '94287082' },
  { seconds: 1_111_111_109, code: '07081804' },
  { seconds: 1_111_111_111, code: '14050471' },
  { seconds: 1_234_567_890, code: '89005924' },
  { seconds: 2_000_000_000, code: '69279037' },
  { seconds: 20_000_000_000, code: '65353130' },
];

describe('M7/M8 — TOTP del panel (RFC 6238)', () => {
  it('la semilla del RFC codifica a la base32 esperada', () => {
    expect(RFC_SECRET_BASE32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET_BASE32).toString('ascii')).toBe(RFC_SECRET_ASCII);
  });

  it.each(RFC_VECTORS)('reproduce el vector oficial T=$seconds → $code', ({ seconds, code }) => {
    expect(generateTotpCode(RFC_SECRET_BASE32, seconds * 1000, 30, 8)).toBe(code);
    // HOTP directo con el contador del RFC.
    expect(hotp(Buffer.from(RFC_SECRET_ASCII, 'ascii'), Math.floor(seconds / 30), 8)).toBe(code);
    // El panel usa 6 dígitos: los últimos 6 del vector oficial.
    expect(generateTotpCode(RFC_SECRET_BASE32, seconds * 1000)).toBe(code.slice(-6));
  });

  it('rechaza un código ya usado (mismo paso o anterior)', () => {
    const secret = generateTotpSecret();
    const nowMs = Date.UTC(2026, 10, 20, 12, 0, 0);
    const code = generateTotpCode(secret, nowMs);
    const currentStep = Math.floor(nowMs / 1000 / 30);

    const first = verifyTotpCode(secret, code, nowMs);
    expect(first).toEqual({ valid: true, step: currentStep });

    const replay = verifyTotpCode(secret, code, nowMs, { lastUsedStep: first.step });
    expect(replay).toEqual({ valid: false, step: null });

    // Un código de un paso anterior tampoco sirve una vez usado uno más nuevo.
    const previousCode = generateTotpCode(secret, (currentStep - 1) * 30_000);
    expect(verifyTotpCode(secret, previousCode, nowMs, { lastUsedStep: currentStep })).toEqual({
      valid: false,
      step: null,
    });
  });

  it('acepta ±1 paso de deriva y rechaza fuera de esa ventana', () => {
    const secret = generateTotpSecret();
    const nowMs = Date.UTC(2026, 10, 20, 12, 0, 0);
    const step = Math.floor(nowMs / 1000 / 30);

    expect(verifyTotpCode(secret, generateTotpCode(secret, (step - 1) * 30_000), nowMs).valid).toBe(
      true,
    );
    expect(verifyTotpCode(secret, generateTotpCode(secret, (step + 1) * 30_000), nowMs).valid).toBe(
      true,
    );
    expect(verifyTotpCode(secret, generateTotpCode(secret, (step - 2) * 30_000), nowMs).valid).toBe(
      false,
    );
    expect(verifyTotpCode(secret, generateTotpCode(secret, (step + 2) * 30_000), nowMs).valid).toBe(
      false,
    );
    // La ventana explícita puede ampliarse, pero el default del panel es 1 (±30 s).
    expect(
      verifyTotpCode(secret, generateTotpCode(secret, (step + 2) * 30_000), nowMs, { window: 2 })
        .valid,
    ).toBe(true);
  });

  it('rechaza formatos inválidos sin lanzar (comparación de largo fijo)', () => {
    const secret = generateTotpSecret();
    const nowMs = Date.UTC(2026, 10, 20, 12, 0, 0);
    for (const candidate of ['', '12345', '1234567', 'abcdef', '12 34 56 7']) {
      expect(verifyTotpCode(secret, candidate, nowMs)).toEqual({ valid: false, step: null });
    }
  });

  it('usa comparación en tiempo constante (timingSafeEqual, sin cortocircuito por dígito)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../security/totp.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('timingSafeEqual');
    expect(source).not.toMatch(/expected\s*===\s*candidate|expected\s*==\s*candidate/);
    // No hay comparación carácter a carácter con salida temprana.
    expect(source).not.toMatch(/for\s*\([^)]*\)\s*\{\s*if\s*\([^)]*\[i\][^)]*\)\s*(return|break)/);
  });

  it('cifra el secreto en reposo con AES-256-GCM y detecta manipulación', () => {
    const secret = generateTotpSecret();
    const key = 'clave-de-cifrado-de-pruebas-minimo-32!!';
    const stored = encryptTotpSecret(secret, key);

    expect(stored).not.toContain(secret);
    expect(stored.split('.')).toHaveLength(3);
    expect(decryptTotpSecret(stored, key)).toBe(secret);

    // Otro clave no puede descifrarlo.
    expect(() => decryptTotpSecret(stored, 'otra-clave-distinta-de-32-caracteres!')).toThrow();

    // Alterar el texto cifrado invalida el tag GCM.
    const [iv, tag, data] = stored.split('.');
    const tampered = [iv, tag, `${data?.slice(0, -4)}AAAA`].join('.');
    expect(() => decryptTotpSecret(tampered, key)).toThrow();
  });

  it('los códigos de recuperación son de un solo uso (hash distinto por código)', () => {
    const codes = generateRecoveryCodes(8);
    expect(new Set(codes).size).toBe(8);
    const hashes = codes.map(hashRecoveryCode);
    expect(new Set(hashes).size).toBe(8);
    expect(hashes[0]).toHaveLength(64);
    // El hash es estable para el mismo código, ignorando el guion.
    expect(hashRecoveryCode(codes[0]!.replace('-', ''))).toBe(hashes[0]);
  });

  it('la URI otpauth declara SHA1/6 dígitos/30 s y el emisor', () => {
    const uri = buildOtpAuthUri({ secret: RFC_SECRET_BASE32, accountName: 'admin@truco.ar' });
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    expect(uri).toContain('issuer=Mesa%20de%20Truco');
  });
});
