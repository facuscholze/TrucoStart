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

    // Adulteración del tag o payload falla autenticación GCM
    const tampered = `${ciphertext.slice(0, -2)}AA`;
    expect(() => decryptSeedFromStore(tampered, ENC_KEY)).toThrow();
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
