import { createVerify, createPublicKey } from 'node:crypto';
import { DomainApiException } from '../../../common/api-exception.js';
import type { GoogleOAuthVerifier, VerifiedGoogleIdentity } from './google-oauth.verifier.js';

interface Jwk {
  kid: string;
  kty: 'RSA';
  alg: 'RS256';
  use: 'sig';
  n: string;
  e: string;
}

interface CachedJwks {
  keys: readonly Jwk[];
  fetchedAt: number;
  maxAgeMs: number;
}

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_CACHE_MS = 6 * 60 * 60 * 1000; // 6 h; Google rota claves varias veces al día.
const DEFAULT_CLOCK_SKEW_MS = 30_000;

function b64urlDecode(s: string): Buffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function parseJwtParts(idToken: string): {
  header: { kid?: string; alg?: string };
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
} {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new DomainApiException(401, 'UNAUTHORIZED', 'Token de Google inválido o expirado');
  }
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  try {
    const header = JSON.parse(b64urlDecode(headerB64).toString('utf8')) as {
      kid?: string;
      alg?: string;
    };
    const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as Record<
      string,
      unknown
    >;
    return {
      header,
      payload,
      signingInput: `${headerB64}.${payloadB64}`,
      signature: b64urlDecode(sigB64),
    };
  } catch {
    throw new DomainApiException(401, 'UNAUTHORIZED', 'Token de Google inválido o expirado');
  }
}

function jwkToPublicKey(jwk: Jwk) {
  return createPublicKey({
    key: {
      kty: 'RSA',
      n: jwk.n,
      e: jwk.e,
      alg: 'RS256',
      use: 'sig',
    },
    format: 'jwk',
  });
}

/**
 * Verificador de ID Tokens de Google contra las JWKS públicas, sin
 * dependencias externas. Implementa las recomendaciones de
 * https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
 *
 * - firma RS256 con clave cuyo `kid` coincide con una JWK publicada;
 * - `iss` es accounts.google.com;
 * - `aud` coincide con el client ID configurado;
 * - `exp` no expirado (con margen de 30 s);
 * - `email_verified` debe ser true para loguearse.
 */
export class GoogleJwksOAuthVerifier implements GoogleOAuthVerifier {
  readonly providerName = 'google-jwks';
  readonly isSimulated = false;
  private cache: CachedJwks | null = null;

  constructor(
    private readonly clientId: string,
    private readonly hostedDomain?: string,
    private readonly clockSkewMs: number = DEFAULT_CLOCK_SKEW_MS,
    private readonly fetchJwks: (
      url: string,
    ) => Promise<Response | { readonly keys: readonly Jwk[] }> = defaultFetchJwks,
  ) {}

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    const { header, payload, signingInput, signature } = parseJwtParts(idToken);
    if (header.alg !== 'RS256' || !header.kid) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Token de Google inválido o expirado');
    }
    const jwks = await this.getJwks();
    const key = jwks.keys.find((k) => k.kid === header.kid);
    if (!key || key.kty !== 'RSA' || key.alg !== 'RS256') {
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'Token de Google inválido o expirado (clave desconocida)',
      );
    }

    const pubKey = jwkToPublicKey(key);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);
    const valid = verifier.verify(pubKey, signature);
    if (!valid) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Firma del token de Google inválida');
    }

    const now = Date.now();
    const exp = typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    const iat = typeof payload.iat === 'number' ? payload.iat * 1000 : 0;
    if (!exp || now > exp + this.clockSkewMs || now < iat - this.clockSkewMs) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Token de Google inválido o expirado');
    }
    if (!GOOGLE_ISSUERS.has(String(payload.iss))) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Emisor del token de Google inválido');
    }
    if (payload.aud !== this.clientId && payload.azp !== this.clientId) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Audiencia del token de Google inválida');
    }
    if (this.hostedDomain && payload.hd !== this.hostedDomain) {
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'La cuenta Google no pertenece al dominio permitido',
      );
    }
    if (payload.email_verified !== true) {
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'La cuenta Google no tiene el correo verificado',
      );
    }
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const displayName =
      typeof payload.name === 'string' ? payload.name : (email.split('@')[0] ?? '');
    if (!email || !sub) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Token de Google inválido');
    }
    return { sub, email, emailVerified: true, displayName };
  }

  private async getJwks(): Promise<CachedJwks> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < this.cache.maxAgeMs) return this.cache;
    const fresh = await coerceJwks(await this.fetchJwks(GOOGLE_JWKS_URL));
    this.cache = { keys: fresh.keys, fetchedAt: now, maxAgeMs: JWKS_CACHE_MS };
    return this.cache;
  }
}

async function defaultFetchJwks(
  url: string,
): Promise<Response | { readonly keys: readonly Jwk[] }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new DomainApiException(
      502,
      'BAD_GATEWAY',
      `No se pudieron obtener las claves JWKS de Google (HTTP ${res.status})`,
    );
  }
  return (await res.json()) as { keys: readonly Jwk[] };
}

async function coerceJwks(
  raw: { readonly keys: readonly Jwk[] } | Response,
): Promise<{ readonly keys: readonly Jwk[] }> {
  if (raw instanceof Response) {
    if (!raw.ok) {
      throw new DomainApiException(
        502,
        'BAD_GATEWAY',
        `No se pudieron obtener las claves JWKS de Google (HTTP ${raw.status})`,
      );
    }
    return (await raw.json()) as { keys: readonly Jwk[] };
  }
  return raw;
}
