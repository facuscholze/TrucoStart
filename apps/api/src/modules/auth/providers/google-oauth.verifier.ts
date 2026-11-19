import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DomainApiException } from '../../../common/api-exception.js';

export const GOOGLE_OAUTH_VERIFIER = Symbol('GOOGLE_OAUTH_VERIFIER');

export interface VerifiedGoogleIdentity {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName: string;
}

export interface GoogleOAuthVerifier {
  readonly providerName: string;
  readonly isSimulated: boolean;
  verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity>;
}

const SimulatedTokenPayloadSchema = z.object({
  sub: z.string().min(4).max(128),
  email: z.string().email(),
  emailVerified: z.boolean().optional().default(true),
  name: z.string().min(1).max(80).optional().default('JugadorGoogle'),
});

// STATE-11 cerrado: GoogleJwksOAuthVerifier (google-jwks.verifier.ts) verifica la
// firma RS256 del ID token contra las JWKS públicas de Google, con caché de 6 h,
// cuando GOOGLE_CLIENT_ID está configurado en staging/producción. En desarrollo
// sigue disponible SimulatedGoogleOAuthVerifier con tokens "sim-google:..." para tests.
@Injectable()
export class SimulatedGoogleOAuthVerifier implements GoogleOAuthVerifier {
  readonly providerName = 'google-simulated-dev';
  readonly isSimulated = true;
  private readonly allowSimulatedTokens: boolean;

  constructor(options: { allowSimulatedTokens: boolean }) {
    this.allowSimulatedTokens = options.allowSimulatedTokens;
  }

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (!this.allowSimulatedTokens) {
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'Google OAuth no está habilitado en este entorno sin credenciales productivas',
      );
    }

    // Formato explícito de desarrollo/tests: "sim-google:<base64url(JSON)>"
    if (!idToken.startsWith('sim-google:')) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Token de Google inválido o expirado');
    }

    try {
      const encoded = idToken.slice('sim-google:'.length);
      const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      const parsed = SimulatedTokenPayloadSchema.parse(decoded);
      return {
        sub: parsed.sub,
        email: parsed.email.toLowerCase(),
        emailVerified: parsed.emailVerified,
        displayName: parsed.name,
      };
    } catch {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Token de Google inválido o expirado');
    }
  }
}

export function createSimulatedGoogleIdToken(payload: {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified?: boolean;
  readonly name?: string;
}): string {
  return `sim-google:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}
