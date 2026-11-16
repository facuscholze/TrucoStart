import { Injectable } from '@nestjs/common';
import { DomainApiException } from '../../../common/api-exception.js';

export const CAPTCHA_VERIFIER = Symbol('CAPTCHA_VERIFIER');

export interface CaptchaVerifier {
  readonly providerName: string;
  readonly isSimulated: boolean;
  verifyOrThrow(token: string | undefined, remoteIp: string): Promise<void>;
}

// TODO(STATE-12): Implementar adaptador HTTP contra Cloudflare Turnstile cuando CAPTCHA_PROVIDER="turnstile" y CAPTCHA_SECRET esté configurado en producción.
@Injectable()
export class SimulatedCaptchaVerifier implements CaptchaVerifier {
  readonly providerName = 'captcha-simulated-dev';
  readonly isSimulated = true;
  private readonly requireToken: boolean;

  constructor(options: { requireToken?: boolean } = {}) {
    this.requireToken = options.requireToken ?? false;
  }

  async verifyOrThrow(token: string | undefined, _remoteIp: string): Promise<void> {
    if (token === 'sim-captcha-fail') {
      throw new DomainApiException(
        400,
        'CAPTCHA_FAILED',
        'La verificación anti-bots (captcha) falló',
      );
    }
    if (this.requireToken && (!token || token.trim().length === 0)) {
      throw new DomainApiException(
        400,
        'CAPTCHA_FAILED',
        'Se requiere completar la verificación anti-bots (captcha)',
      );
    }
  }
}
