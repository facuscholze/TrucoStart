import { DomainApiException } from '../../../common/api-exception.js';
import type { CaptchaVerifier } from './captcha.verifier.js';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verificador contra Cloudflare Turnstile (CAPTCHA). Activado cuando
 * `CAPTCHA_PROVIDER=turnstile` y `CAPTCHA_SECRET` está configurado.
 *
 * Turnstile verifica el token con una request server-side que incluye la
 * IP real del cliente (que se obtiene por ADR-020 vía resolveClientIp y
 * Fastify). Si el servicio de Turnstile falla temporalmente se rechaza
 * la autenticación con error 502 en vez de dejar pasar al usuario.
 */
export class TurnstileCaptchaVerifier implements CaptchaVerifier {
  readonly providerName = 'turnstile';
  readonly isSimulated = false;

  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verifyOrThrow(token: string | undefined, remoteIp: string): Promise<void> {
    if (!token || token.trim().length === 0) {
      throw new DomainApiException(
        400,
        'CAPTCHA_FAILED',
        'Se requiere completar la verificación anti-bots (captcha)',
      );
    }
    const body = new URLSearchParams({
      secret: this.secretKey,
      response: token,
      remoteip: remoteIp,
    });
    const res = await this.fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new DomainApiException(
        502,
        'BAD_GATEWAY',
        `No se pudo verificar el captcha (HTTP ${res.status})`,
      );
    }
    let data: { success?: boolean; 'error-codes'?: string[] };
    try {
      data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    } catch {
      throw new DomainApiException(502, 'BAD_GATEWAY', 'Respuesta inválida de Turnstile');
    }
    if (data.success !== true) {
      throw new DomainApiException(
        400,
        'CAPTCHA_FAILED',
        `La verificación anti-bots falló (${(data['error-codes'] ?? []).join(',') || 'invalid'})`,
      );
    }
  }
}
