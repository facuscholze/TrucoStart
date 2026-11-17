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
const INTERNAL_RPC_REPLAY_SAFE_PREFIX = 'internal-rpc-v2:';

export const DEFAULT_INTERNAL_RPC_MAX_SKEW_MS = 30_000;

/** Nonce aleatorio base64url (128 bits) para las cabeceras `x-internal-nonce`. */
export function randomBytesB64Url(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

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

export interface InternalRpcSignParams {
  readonly method: string;
  readonly path: string;
  readonly timestampMs: number;
  readonly nonce: string;
  readonly rawBody: string;
}

export type SignedInternalRpcHeaders = Record<
  'x-internal-timestamp' | 'x-internal-nonce' | 'x-internal-signature',
  string
>;

export type InternalRpcVerifyResult =
  | {
      readonly valid: true;
      readonly timestampMs: number;
      readonly nonce: string;
    }
  | {
      readonly valid: false;
      readonly reason: 'INVALID_HEADERS' | 'TIMESTAMP_EXPIRED' | 'INVALID_SIGNATURE';
    };

function buildCanonicalInternalRpcMessage(params: InternalRpcSignParams): string {
  return `${params.method.toUpperCase()}\n${params.path}\n${params.timestampMs}\n${params.nonce}\n${params.rawBody}`;
}

export function signInternalRpcRequest(params: InternalRpcSignParams, secret: string): string {
  if (secret.length < 32) {
    throw new Error('El secreto interno entre servicios debe tener al menos 32 caracteres');
  }
  if (!Number.isSafeInteger(params.timestampMs) || params.timestampMs <= 0) {
    throw new Error('timestampMs inválido para firma RPC interna');
  }
  if (!NONCE_PATTERN.test(params.nonce)) {
    throw new Error('nonce inválido para firma RPC interna (16..128 caracteres base64url)');
  }
  const keyBytes = textEncoder.encode(`${INTERNAL_RPC_REPLAY_SAFE_PREFIX}${secret}`);
  const canonical = buildCanonicalInternalRpcMessage(params);
  return encodeBase64Url(hmacSha256Bytes(keyBytes, textEncoder.encode(canonical)));
}

export function buildSignedInternalRpcHeaders(
  params: InternalRpcSignParams,
  secret: string,
): SignedInternalRpcHeaders {
  return {
    'x-internal-timestamp': String(params.timestampMs),
    'x-internal-nonce': params.nonce,
    'x-internal-signature': signInternalRpcRequest(params, secret),
  };
}

/**
 * Conveniencia para llamadas internas firmadas: genera timestamp y nonce frescos y
 * devuelve las cabeceras anti-replay listas para usar con `fetch`.
 */
export function signInternalRequestHeaders(params: {
  readonly method: string;
  readonly path: string;
  readonly rawBody?: string;
  readonly secret: string;
  readonly nowMs?: number;
  readonly nonce?: string;
}): SignedInternalRpcHeaders {
  const nonce = params.nonce ?? randomBytesB64Url(16);
  return buildSignedInternalRpcHeaders(
    {
      method: params.method,
      path: params.path,
      timestampMs: params.nowMs ?? Date.now(),
      nonce,
      rawBody: params.rawBody ?? '',
    },
    params.secret,
  );
}

export function verifyInternalRpcSignatureAndWindow(params: {
  readonly method: string;
  readonly path: string;
  readonly timestampHeader: string;
  readonly nonceHeader: string;
  readonly signatureHeader: string;
  readonly rawBody: string;
  readonly secret: string;
  readonly nowMs?: number;
  readonly maxSkewMs?: number;
}): InternalRpcVerifyResult {
  if (params.secret.length < 32) {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }
  if (
    !params.timestampHeader ||
    !/^\d+$/.test(params.timestampHeader) ||
    !NONCE_PATTERN.test(params.nonceHeader) ||
    !params.signatureHeader
  ) {
    return { valid: false, reason: 'INVALID_HEADERS' };
  }

  const timestampMs = Number(params.timestampHeader);
  if (!Number.isSafeInteger(timestampMs) || timestampMs <= 0) {
    return { valid: false, reason: 'INVALID_HEADERS' };
  }

  const actualSig = decodeBase64Url(params.signatureHeader);
  if (!actualSig) {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }

  const keyBytes = textEncoder.encode(`${INTERNAL_RPC_REPLAY_SAFE_PREFIX}${params.secret}`);
  const canonical = buildCanonicalInternalRpcMessage({
    method: params.method,
    path: params.path,
    timestampMs,
    nonce: params.nonceHeader,
    rawBody: params.rawBody,
  });
  const expectedSig = hmacSha256Bytes(keyBytes, textEncoder.encode(canonical));
  if (!constantTimeEqualBytes(actualSig, expectedSig)) {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }

  const nowMs = params.nowMs ?? Date.now();
  const maxSkewMs = params.maxSkewMs ?? DEFAULT_INTERNAL_RPC_MAX_SKEW_MS;
  if (Math.abs(nowMs - timestampMs) > maxSkewMs) {
    return { valid: false, reason: 'TIMESTAMP_EXPIRED' };
  }

  return {
    valid: true,
    timestampMs,
    nonce: params.nonceHeader,
  };
}
