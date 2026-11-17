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
        {
          provide: EMAIL_PROVIDER,
          useValue: options.emailProvider ?? new ConsoleEmailProvider({ logToStdout: false }),
        },
        {
          provide: GOOGLE_OAUTH_VERIFIER,
          useValue:
            options.googleVerifier ??
            new SimulatedGoogleOAuthVerifier({ allowSimulatedTokens: !isProd }),
        },
        {
          provide: CAPTCHA_VERIFIER,
          useValue:
            options.captchaVerifier ??
            new SimulatedCaptchaVerifier({
              requireToken: process.env['CAPTCHA_PROVIDER'] === 'turnstile',
            }),
        },
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
