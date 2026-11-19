import { type DynamicModule, Global, Module } from '@nestjs/common';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../../common/rate-limit/rate-limit-store.interface.js';
import {
  AUTH_RUNTIME_CONFIG,
  type AuthRuntimeConfig,
  buildAuthRuntimeConfigFromEnv,
} from './auth.config.js';
import { AuthController } from './auth.controller.js';
import { AuthRecoveryService } from './auth-recovery.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { AuthSessionService } from './auth-session.service.js';
import { SessionAuthGuard } from './guards/session-auth.guard.js';
import {
  CAPTCHA_VERIFIER,
  type CaptchaVerifier,
  SimulatedCaptchaVerifier,
} from './providers/captcha.verifier.js';
import {
  ConsoleEmailProvider,
  EMAIL_PROVIDER,
  type EmailProvider,
} from './providers/email.provider.js';
import {
  GOOGLE_OAUTH_VERIFIER,
  type GoogleOAuthVerifier,
  SimulatedGoogleOAuthVerifier,
} from './providers/google-oauth.verifier.js';
import { ResendEmailProvider, SmtpEmailProvider } from './providers/resend-email.provider.js';
import { GoogleJwksOAuthVerifier } from './providers/google-jwks.verifier.js';
import { TurnstileCaptchaVerifier } from './providers/turnstile-captcha.verifier.js';
import { type AuthRateLimitConfig, HttpAuthRateLimiter } from './security/http-rate-limiter.js';
import { PasswordHasher } from './security/password-hasher.js';

export interface AuthModuleOptions {
  readonly runtimeConfig?: Partial<AuthRuntimeConfig>;
  readonly rateLimitConfig?: Partial<AuthRateLimitConfig>;
  readonly emailProvider?: EmailProvider;
  readonly googleVerifier?: GoogleOAuthVerifier;
  readonly captchaVerifier?: CaptchaVerifier;
}

@Global()
@Module({})
export class AuthModule {
  static register(options: AuthModuleOptions = {}): DynamicModule {
    const runtimeConfig = buildAuthRuntimeConfigFromEnv(options.runtimeConfig);
    const rateLimitConfig: AuthRateLimitConfig = {
      windowMs:
        options.rateLimitConfig?.windowMs ??
        Number(process.env['RATE_LIMIT_HTTP_WINDOW_MS'] ?? 60_000),
      maxPerIp:
        options.rateLimitConfig?.maxPerIp ?? Number(process.env['RATE_LIMIT_AUTH_MAX'] ?? 15),
      maxPerAccount:
        options.rateLimitConfig?.maxPerAccount ??
        Math.max(5, Math.min(10, Number(process.env['RATE_LIMIT_AUTH_MAX'] ?? 15))),
      nowFn: options.rateLimitConfig?.nowFn ?? runtimeConfig.nowFn,
    };

    const isProd = process.env['NODE_ENV'] === 'production';
    const isStaging = process.env['NODE_ENV'] === 'staging';
    const useRealProviders = isProd || isStaging;

    const emailProvider: EmailProvider = options.emailProvider ?? buildEmailProviderFromEnv();
    const googleVerifier: GoogleOAuthVerifier =
      options.googleVerifier ?? buildGoogleVerifierFromEnv(useRealProviders);
    const captchaVerifier: CaptchaVerifier =
      options.captchaVerifier ?? buildCaptchaVerifierFromEnv(useRealProviders);

    return {
      module: AuthModule,
      global: true,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_RUNTIME_CONFIG, useValue: runtimeConfig },
        {
          provide: HttpAuthRateLimiter,
          useFactory: (store: RateLimitStore) => new HttpAuthRateLimiter(rateLimitConfig, store),
          inject: [RATE_LIMIT_STORE],
        },
        { provide: EMAIL_PROVIDER, useValue: emailProvider },
        { provide: GOOGLE_OAUTH_VERIFIER, useValue: googleVerifier },
        { provide: CAPTCHA_VERIFIER, useValue: captchaVerifier },
        PasswordHasher,
        AuthRepository,
        AuthSessionService,
        AuthRecoveryService,
        AuthService,
        SessionAuthGuard,
      ],
      exports: [
        AUTH_RUNTIME_CONFIG,
        AuthRepository,
        AuthSessionService,
        AuthRecoveryService,
        AuthService,
        SessionAuthGuard,
        PasswordHasher,
        EMAIL_PROVIDER,
        GOOGLE_OAUTH_VERIFIER,
        CAPTCHA_VERIFIER,
      ],
    };
  }
}

function buildEmailProviderFromEnv(): EmailProvider {
  const kind = (process.env['EMAIL_PROVIDER'] ?? 'console') as 'console' | 'resend' | 'smtp';
  const webBaseUrl = process.env['WEB_BASE_URL'] ?? 'http://localhost:5173';
  const from = process.env['EMAIL_FROM_ADDRESS'] ?? '';
  if (kind === 'resend') {
    return new ResendEmailProvider(process.env['RESEND_API_KEY'] ?? '', from, webBaseUrl);
  }
  if (kind === 'smtp') {
    // El transporte se construye (y se valida con verify()) en el primer envío:
    // un SMTP caído no debe impedir que arranque la API.
    return lazySmtp(process.env['SMTP_CONNECTION_URL'] ?? '', from, webBaseUrl);
  }
  return new ConsoleEmailProvider({ logToStdout: process.env['NODE_ENV'] !== 'production' });
}

/**
 * Envoltura perezosa sobre `SmtpEmailProvider.create()`: el handshake con el
 * servidor SMTP (`verify()`) ocurre en el primer envío, no en el arranque.
 */
function lazySmtp(connectionUrl: string, from: string, webBaseUrl: string): EmailProvider {
  let pending: Promise<SmtpEmailProvider> | null = null;
  const get = (): Promise<SmtpEmailProvider> => {
    pending ??= SmtpEmailProvider.create({ connectionUrl, fromAddress: from, webBaseUrl });
    return pending;
  };
  return {
    providerName: 'smtp',
    isSimulated: false,
    async sendVerificationEmail(params) {
      await (await get()).sendVerificationEmail(params);
    },
    async sendPasswordResetEmail(params) {
      await (await get()).sendPasswordResetEmail(params);
    },
  };
}

function buildGoogleVerifierFromEnv(useReal: boolean): GoogleOAuthVerifier {
  const clientId = (process.env['GOOGLE_CLIENT_ID'] ?? '').trim();
  if (useReal && clientId.length > 0) {
    return new GoogleJwksOAuthVerifier(
      clientId,
      process.env['GOOGLE_HOSTED_DOMAIN']?.trim() || undefined,
    );
  }
  return new SimulatedGoogleOAuthVerifier({ allowSimulatedTokens: !useReal });
}

function buildCaptchaVerifierFromEnv(useReal: boolean): CaptchaVerifier {
  const provider = (process.env['CAPTCHA_PROVIDER'] ?? 'disabled') as 'disabled' | 'turnstile';
  if (useReal && provider === 'turnstile') {
    const secret = (process.env['CAPTCHA_SECRET'] ?? '').trim();
    return new TurnstileCaptchaVerifier(secret);
  }
  return new SimulatedCaptchaVerifier({
    requireToken: provider === 'turnstile',
  });
}
