import { z } from 'zod';
import {
  constantTimeEqualBytes,
  decodeBase64Url,
  encodeBase64Url,
  hmacSha256Bytes,
} from './hmac-sha256.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export const WsAuthTicketClaimsSchema = z.object({
  userId: z.string().min(1).max(128),
  sessionId: z.string().min(8).max(128),
  nickname: z.string().trim().min(1).max(32),
  isGuest: z.boolean().optional(),
  exp: z.number().int().positive(),
});

export type WsAuthTicketClaims = z.infer<typeof WsAuthTicketClaimsSchema>;

function computeSignatureBytes(encodedPayload: string, secret: string): Uint8Array {
  return hmacSha256Bytes(textEncoder.encode(secret), textEncoder.encode(encodedPayload));
}

export function signWsAuthTicket(claims: WsAuthTicketClaims, secret: string): string {
  if (secret.length < 32) {
    throw new Error('El secreto de firma WS debe tener al menos 32 caracteres');
  }
  const validated = WsAuthTicketClaimsSchema.parse(claims);
  const payloadB64 = encodeBase64Url(textEncoder.encode(JSON.stringify(validated)));
  const sigB64 = encodeBase64Url(computeSignatureBytes(payloadB64, secret));
  return `${payloadB64}.${sigB64}`;
}

export function verifyWsAuthTicket(
  token: string,
  secret: string,
  nowMs = Date.now(),
): WsAuthTicketClaims | null {
  if (typeof token !== 'string' || secret.length < 32) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const actualSig = decodeBase64Url(sigB64);
  if (!actualSig) return null;

  const expectedSig = computeSignatureBytes(payloadB64, secret);
  if (!constantTimeEqualBytes(actualSig, expectedSig)) {
    return null;
  }

  try {
    const rawBytes = decodeBase64Url(payloadB64);
    if (!rawBytes) return null;
    const rawJson = textDecoder.decode(rawBytes);
    const parsed = WsAuthTicketClaimsSchema.safeParse(JSON.parse(rawJson));
    if (!parsed.success) return null;
    if (parsed.data.exp <= nowMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
