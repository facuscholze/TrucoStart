import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Rng } from '@truco/engine';

export interface CommitRevealBundle {
  readonly seedHex: string;
  readonly seedCommitment: string;
}

export function computeSeedCommitment(seedHex: string): string {
  return createHash('sha256').update(seedHex, 'utf8').digest('hex');
}

export function generateCommitRevealSeed(): CommitRevealBundle {
  const seedHex = randomBytes(32).toString('hex');
  return {
    seedHex,
    seedCommitment: computeSeedCommitment(seedHex),
  };
}

export function verifySeedCommitment(seedHex: string, commitmentHex: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(seedHex) || !/^[a-f0-9]{64}$/.test(commitmentHex)) {
    return false;
  }
  const actual = Buffer.from(computeSeedCommitment(seedHex), 'hex');
  const expected = Buffer.from(commitmentHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Crea un `Rng` determinista y sin sesgo a partir de `seedHex` usando HMAC-SHA256 en modo contador,
 * permitiendo auditar y reproducir íntegramente el reparto tras revelar la semilla al final de la partida.
 */
export function createRngFromSeedHex(seedHex: string): Rng {
  if (!/^[a-f0-9]{64}$/.test(seedHex)) {
    throw new Error('seedHex debe ser una cadena hexadecimal de 64 caracteres (32 bytes)');
  }
  const key = Buffer.from(seedHex, 'hex');
  let counter = 0;

  return {
    nextFloat(): number {
      const counterBuf = Buffer.allocUnsafe(4);
      counterBuf.writeUInt32BE(counter >>> 0, 0);
      counter = (counter + 1) >>> 0;

      const digest = createHmac('sha256', key).update(counterBuf).digest();
      // 53 bits de precisión IEEE-754 uniforme en [0, 1)
      const hi21 = digest.readUInt32BE(0) >>> 11;
      const lo32 = digest.readUInt32BE(4) >>> 0;
      return (hi21 * 4_294_967_296 + lo32) / 9_007_199_254_740_992;
    },
  };
}

function deriveAesKey(encryptionSecret: string): Buffer {
  if (encryptionSecret.length < 32) {
    throw new Error('SEED_ENCRYPTION_KEY debe tener al menos 32 caracteres');
  }
  return createHash('sha256').update(encryptionSecret, 'utf8').digest();
}

export function encryptSeedForStore(seedHex: string, encryptionSecret: string): string {
  const key = deriveAesKey(encryptionSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(seedHex, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSeedFromStore(ciphertext: string, encryptionSecret: string): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) {
    throw new Error('Formato de semilla cifrada inválido');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const key = deriveAesKey(encryptionSecret);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64!, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64!, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
