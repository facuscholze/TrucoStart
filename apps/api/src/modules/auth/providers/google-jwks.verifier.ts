import {
  createRemoteJWKSet,
  jwtVerify,
  errors as joseErrors,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { DomainApiException } from '../../../common/api-exception.js';
import type { GoogleOAuthVerifier, VerifiedGoogleIdentity } from './google-oauth.verifier.js';

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google rota claves varias veces al día. */
const JWKS_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const JWKS_COOLDOWN_MS = 30_000;
const JWKS_TIMEOUT_MS = 5_000;
const DEFAULT_CLOCK_SKEW_S = 30;

const unauthorized = (detail?: string): DomainApiException =>
  new DomainApiException(
    401,
    'UNAUTHORIZED',
    detail
      ? `Token de Google inválido o expirado (${detail})`
      : 'Token de Google inválido o expirado',
  );

/**
 * Verificador de ID Tokens de Google contra las JWKS públicas usando `jose`.
 *
 * Implementa las recomendaciones de
 * https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
 *
 * - firma RS256 validada con la clave cuyo `kid` publica Google
 *   (`createRemoteJWKSet`: caché en memoria + cooldown + refetch ante `kid`
 *   desconocido, tolerante a la rotación de claves);
 * - `iss` es `accounts.google.com`;
 * - `aud` coincide con el client ID configurado;
 * - `exp`/`iat`/`nbf` con margen de reloj configurable;
 * - `email_verified` debe ser true para loguearse.
 *
 * Cualquier fallo de la librería se traduce a un 401 con código `UNAUTHORIZED`
 * (nunca se filtra el motivo criptográfico al cliente).
 */
export class GoogleJwksOAuthVerifier implements GoogleOAuthVerifier {
  readonly providerName = 'google-jwks';
  readonly isSimulated = false;
  private readonly jwks: JWTVerifyGetKey;

  constructor(
    private readonly clientId: string,
    private readonly hostedDomain?: string,
    clockSkewSeconds: number = DEFAULT_CLOCK_SKEW_S,
    /** Inyectable en tests; por defecto el set remoto real de Google. */
    jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), {
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
      cooldownDuration: JWKS_COOLDOWN_MS,
      timeoutDuration: JWKS_TIMEOUT_MS,
    }),
    private readonly clockSkewS: number = clockSkewSeconds,
  ) {
    this.jwks = jwks;
  }

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: this.clientId,
        algorithms: ['RS256'],
        clockTolerance: this.clockSkewS,
        requiredClaims: ['sub', 'email', 'exp', 'iat'],
      }));
    } catch (error) {
      if (error instanceof joseErrors.JWTClaimValidationFailed) {
        throw unauthorized(error.claim);
      }
      // Falla del proveedor (no del cliente): red, timeout o JWKS inalcanzable.
      if (
        error instanceof joseErrors.JOSEError &&
        (error.code === 'ERR_JWKS_TIMEOUT' || error.code === 'ERR_JWKS_FETCH_ERROR')
      ) {
        throw new DomainApiException(
          502,
          'BAD_GATEWAY',
          'No se pudieron obtener las claves JWKS de Google',
        );
      }
      // Firma inválida, kid desconocido, algoritmo no permitido, token malformado → 401.
      throw unauthorized();
    }

    if (this.hostedDomain && payload['hd'] !== this.hostedDomain) {
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'La cuenta Google no pertenece al dominio permitido',
      );
    }
    if (payload['email_verified'] !== true) {
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'La cuenta Google no tiene el correo verificado',
      );
    }

    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    if (!email || !sub) throw unauthorized();
    const displayName =
      typeof payload['name'] === 'string' ? payload['name'] : (email.split('@')[0] ?? '');

    return { sub, email, emailVerified: true, displayName };
  }
}
