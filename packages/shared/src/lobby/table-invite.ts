import { z } from 'zod';
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '../constants/app.js';
import {
  constantTimeEqualBytes,
  decodeBase64Url,
  encodeBase64Url,
  hmacSha256Bytes,
} from '../ws/hmac-sha256.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

const INVITE_DOMAIN_PREFIX = 'table-invite-v1:';
const INTERNAL_RPC_DOMAIN_PREFIX = 'internal-rpc-v1:';

export const TableInviteClaimsSchema = z.object({
  tableId: z.string().uuid(),
  exp: z.number().int().positive(),
});

export type TableInviteClaims = z.infer<typeof TableInviteClaimsSchema>;

/**
 * Genera un código de unión de 6 caracteres sin ambigüedad visual (sin 0, O, 1, I)
 * a partir de bytes aleatorios CSPRNG provistos por el llamador.
 */
export function generateJoinCodeFromRandomBytes(randomBytes: Uint8Array): string {
  if (randomBytes.length < JOIN_CODE_LENGTH) {
    throw new Error(`Se requieren al menos ${JOIN_CODE_LENGTH} bytes aleatorios`);
  }
  const alphabetLen = JOIN_CODE_ALPHABET.length; // 32 caracteres exactos -> sin sesgo módulo (256 % 32 === 0)
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    const idx = randomBytes[i]! % alphabetLen;
    code += JOIN_CODE_ALPHABET[idx]!;
  }
  return code;
}

export function normalizeJoinCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function signTableInviteToken(claims: TableInviteClaims, secret: string): string {
  if (secret.length < 32) {
    throw new Error('El secreto de firma de invitaciones debe tener al menos 32 caracteres');
  }
  const validated = TableInviteClaimsSchema.parse(claims);
  const payloadB64 = encodeBase64Url(textEncoder.encode(JSON.stringify(validated)));
  const keyBytes = textEncoder.encode(`${INVITE_DOMAIN_PREFIX}${secret}`);
  const sigB64 = encodeBase64Url(hmacSha256Bytes(keyBytes, textEncoder.encode(payloadB64)));
  return `${payloadB64}.${sigB64}`;
}

export function verifyTableInviteToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): TableInviteClaims | null {
  if (typeof token !== 'string' || secret.length < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const actualSig = decodeBase64Url(sigB64);
  if (!actualSig) return null;

  const keyBytes = textEncoder.encode(`${INVITE_DOMAIN_PREFIX}${secret}`);
  const expectedSig = hmacSha256Bytes(keyBytes, textEncoder.encode(payloadB64));
  if (!constantTimeEqualBytes(actualSig, expectedSig)) return null;

  try {
    const rawBytes = decodeBase64Url(payloadB64);
    if (!rawBytes) return null;
    const parsed = TableInviteClaimsSchema.safeParse(JSON.parse(textDecoder.decode(rawBytes)));
    if (!parsed.success) return null;
    if (parsed.data.exp <= nowMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function signInternalServicePayload(rawBody: string, secret: string): string {
  if (secret.length < 32) {
    throw new Error('El secreto interno entre servicios debe tener al menos 32 caracteres');
  }
  const keyBytes = textEncoder.encode(`${INTERNAL_RPC_DOMAIN_PREFIX}${secret}`);
  return encodeBase64Url(hmacSha256Bytes(keyBytes, textEncoder.encode(rawBody)));
}

export function verifyInternalServicePayload(
  rawBody: string,
  signatureB64: string,
  secret: string,
): boolean {
  if (typeof signatureB64 !== 'string' || secret.length < 32) return false;
  const actualSig = decodeBase64Url(signatureB64);
  if (!actualSig) return false;
  const keyBytes = textEncoder.encode(`${INTERNAL_RPC_DOMAIN_PREFIX}${secret}`);
  const expectedSig = hmacSha256Bytes(keyBytes, textEncoder.encode(rawBody));
  return constantTimeEqualBytes(actualSig, expectedSig);
}
