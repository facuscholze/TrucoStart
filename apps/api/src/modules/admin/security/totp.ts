import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Código TOTP de 6 dígitos para un `step` de 30 s (RFC 6238, HMAC-SHA1). */
export function generateTotpCode(secret: string, atMs: number, stepSeconds = 30): string {
  const step = Math.floor(atMs / 1000 / stepSeconds);
  return hotp(base32Decode(secret), step);
}

function hotp(key: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/**
 * Verifica un código TOTP aceptando ±1 paso (30 s) de deriva de reloj.
 * Devuelve el `step` usado para impedir reutilización del mismo código.
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  atMs: number,
  options: { window?: number; stepSeconds?: number; lastUsedStep?: number | null } = {},
): { valid: boolean; step: number | null } {
  const window = options.window ?? 1;
  const stepSeconds = options.stepSeconds ?? 30;
  const currentStep = Math.floor(atMs / 1000 / stepSeconds);
  const candidate = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return { valid: false, step: null };

  for (let delta = -window; delta <= window; delta++) {
    const step = currentStep + delta;
    if (
      options.lastUsedStep !== undefined &&
      options.lastUsedStep !== null &&
      step <= options.lastUsedStep
    ) {
      continue;
    }
    const expected = hotp(base32Decode(secret), step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) {
      return { valid: true, step };
    }
  }
  return { valid: false, step: null };
}

const ENCRYPTION_CONTEXT = 'truco-admin-totp-v1';

function deriveKey(secretKey: string): Buffer {
  return scryptSync(secretKey, ENCRYPTION_CONTEXT, 32);
}

/** Cifra el secreto TOTP (AES-256-GCM) para no guardarlo en claro en la base. */
export function encryptTotpSecret(secret: string, encryptionKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(encryptionKey), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptTotpSecret(payload: string, encryptionKey: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Secreto TOTP corrupto');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(encryptionKey),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = String(randomInt(0, 100_000_000)).padStart(8, '0');
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(code.replace(/[^0-9]/g, ''))
    .digest('hex');
}

/** URI `otpauth://` para cargar el secreto en Google Authenticator / Aegis. */
export function buildOtpAuthUri(params: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? 'Mesa de Truco';
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
    params.accountName,
  )}?secret=${params.secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
