import { AR_CORTO_15_V1, createGame } from '@truco/engine';
import { describe, expect, it } from 'vitest';
import {
  computeSeedCommitment,
  createRngFromSeedHex,
  decryptSeedFromStore,
  encryptSeedForStore,
  generateCommitRevealSeed,
  verifySeedCommitment,
} from '../src/security/commit-reveal.js';
import { WsConnectionRateLimiter } from '../src/security/rate-limiter.js';

const ENC_KEY = 'clave-secreta-de-prueba-32-caracteres-minimo!!';

describe('Game Server Security: CSPRNG Commit-Reveal, AES-GCM Seed Storage & WS Rate Limiting', () => {
  it('generates verifiable SHA-256 seed commitments and reproduces identical shuffles on reveal', () => {
    const bundle = generateCommitRevealSeed();
    expect(bundle.seedHex).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.seedCommitment).toBe(computeSeedCommitment(bundle.seedHex));
    expect(verifySeedCommitment(bundle.seedHex, bundle.seedCommitment)).toBe(true);

    // Una semilla distinta jamás verifica contra el commitment publicado
    const otherBundle = generateCommitRevealSeed();
    expect(verifySeedCommitment(otherBundle.seedHex, bundle.seedCommitment)).toBe(false);
    expect(verifySeedCommitment('formato-invalido', bundle.seedCommitment)).toBe(false);

    // Reproducibilidad exacta del reparto usando seedHex revelado
    const seats = [
      { seat: 0, team: 0 },
      { seat: 1, team: 1 },
    ];
    const g1 = createGame(AR_CORTO_15_V1, seats, createRngFromSeedHex(bundle.seedHex));
    const g2 = createGame(AR_CORTO_15_V1, seats, createRngFromSeedHex(bundle.seedHex));
    expect(g1).toEqual(g2);
  });

  it('encrypts seedHex with AES-256-GCM at rest without leaking plaintext and detects tampering', () => {
    const { seedHex } = generateCommitRevealSeed();
    const ciphertext = encryptSeedForStore(seedHex, ENC_KEY);

    expect(ciphertext).not.toContain(seedHex);
    expect(decryptSeedFromStore(ciphertext, ENC_KEY)).toBe(seedHex);

    // Adulteración a nivel de bytes: se decodifica la tercera parte (ciphertext),
    // se voltea un bit en el medio del payload y se vuelve a codificar en
    // base64url. Esto garantiza que el texto cifrado cambia en al menos un byte
    // sin depender de la posición de los caracteres de padding (base64url no usa
    // padding) ni de la representación textual.
    const [ivB64, tagB64, dataB64] = ciphertext.split('.');
    const data = Buffer.from(dataB64!, 'base64url');
    const tamperedData = Buffer.from(data);
    const flipAt = Math.floor(tamperedData.length / 2);
    tamperedData[flipAt] = tamperedData[flipAt]! ^ 0xff;
    const tampered = [ivB64, tagB64, tamperedData.toString('base64url')].join('.');
    expect(() => decryptSeedFromStore(tampered, ENC_KEY)).toThrow();

    // Adulterar el tag de autenticación también falla.
    const tagBuf = Buffer.from(tagB64!, 'base64url');
    const tamperedTag = Buffer.from(tagBuf);
    tamperedTag[0] = tamperedTag[0]! ^ 0x01;
    const tamperedTagCipher = [ivB64, tamperedTag.toString('base64url'), dataB64].join('.');
    expect(() => decryptSeedFromStore(tamperedTagCipher, ENC_KEY)).toThrow();
  });

  it('enforces independent sliding-window limits per connection and per event category (chat vs action)', () => {
    const limiter = new WsConnectionRateLimiter({
      windowMs: 5_000,
      chatMax: 2,
      actionMax: 4,
      tableMax: 3,
    });

    const t0 = 1_000_000;
    expect(limiter.consume('conn-1', 'chat.quick', t0)).toBe(true);
    expect(limiter.consume('conn-1', 'chat.quick', t0 + 100)).toBe(true);
    // 3er mensaje de chat bloqueado en la ventana
    expect(limiter.consume('conn-1', 'chat.quick', t0 + 200)).toBe(false);

    // Acciones de juego siguen permitidas en la misma conexión (cupo independiente)
    expect(limiter.consume('conn-1', 'game.playCard', t0 + 300)).toBe(true);
    // Otra conexión tampoco se ve afectada
    expect(limiter.consume('conn-2', 'chat.quick', t0 + 300)).toBe(true);

    // Tras expirar la ventana, se rehabilita el cupo de chat
    expect(limiter.consume('conn-1', 'chat.quick', t0 + 5_100)).toBe(true);

    limiter.removeConnection('conn-1');
    expect(limiter.consume('conn-1', 'chat.quick', t0 + 5_200)).toBe(true);
  });
});
