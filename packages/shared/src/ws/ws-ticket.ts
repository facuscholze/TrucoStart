import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const WsAuthTicketClaimsSchema = z.object({
  userId: z.string().min(1).max(128),
  sessionId: z.string().min(8).max(128),
  nickname: z.string().trim().min(1).max(32),
  exp: z.number().int().positive(),
});

export type WsAuthTicketClaims = z.infer<typeof WsAuthTicketClaimsSchema>;

function computeSignature(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest();
}

export function signWsAuthTicket(claims: WsAuthTicketClaims, secret: string): string {
  if (secret.length < 32) {
    throw new Error('El secreto de firma WS debe tener al menos 32 caracteres');
  }
  const validated = WsAuthTicketClaimsSchema.parse(claims);
  const payloadB64 = Buffer.from(JSON.stringify(validated), 'utf8').toString('base64url');
  const sigB64 = computeSignature(payloadB64, secret).toString('base64url');
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

  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }

  const expectedSig = computeSignature(payloadB64, secret);
  if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
    return null;
  }

  try {
    const rawJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = WsAuthTicketClaimsSchema.safeParse(JSON.parse(rawJson));
    if (!parsed.success) return null;
    if (parsed.data.exp <= nowMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
