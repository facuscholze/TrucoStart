import { randomBytes } from 'node:crypto';

let lastTimestampMs = 0;
let monotonicSeq = 0;

/**
 * Generador RFC 9562 UUIDv7 (48 bits Unix epoch ms + 12 bits secuencia monótona/azar + 62 bits CSPRNG).
 * Garantiza localidad de índice B-Tree en PostgreSQL 16 y PGlite.
 */
export function generateUuidV7(nowMs = Date.now()): string {
  const rand = randomBytes(10);

  if (nowMs === lastTimestampMs) {
    monotonicSeq = (monotonicSeq + 1) & 0x0fff;
  } else {
    lastTimestampMs = nowMs;
    monotonicSeq = ((rand[0]! << 8) | rand[1]!) & 0x0fff;
  }

  const bytes = new Uint8Array(16);
  const tsHi = Math.floor(nowMs / 0x100000000);
  const tsLo = nowMs >>> 0;

  bytes[0] = (tsHi >>> 8) & 0xff;
  bytes[1] = tsHi & 0xff;
  bytes[2] = (tsLo >>> 24) & 0xff;
  bytes[3] = (tsLo >>> 16) & 0xff;
  bytes[4] = (tsLo >>> 8) & 0xff;
  bytes[5] = tsLo & 0xff;

  // version 7 (0111) + 12-bit rand_a / monotonic counter
  bytes[6] = 0x70 | ((monotonicSeq >>> 8) & 0x0f);
  bytes[7] = monotonicSeq & 0xff;

  // variant RFC 4122/9562 (10xx) + 62-bit rand_b
  bytes[8] = 0x80 | (rand[2]! & 0x3f);
  bytes.set(rand.subarray(3, 10), 9);

  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
