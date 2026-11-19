import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResendEmailProvider } from '../providers/resend-email.provider.js';
import { GoogleJwksOAuthVerifier } from '../providers/google-jwks.verifier.js';
import { TurnstileCaptchaVerifier } from '../providers/turnstile-captcha.verifier.js';

/**
 * Tests de los adaptadores productivos (Resend, Google JWKS, Turnstile).
 *
 * Ninguno de estos tests pega la red real: reemplazamos fetch por un mock
 * que devuelve respuestas prefabricadas. Esto garantiza que la
 * implementación siga el contrato del proveedor (URL, headers, parseo de
 * respuestas) y no un supuesto sobre ella.
 */
describe('auth external providers (Resend / Google JWKS / Turnstile)', () => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('ResendEmailProvider', () => {
    it('sends signed POST to https://api.resend.com/emails with correct payload', async () => {
      fetchMock.mockResolvedValueOnce(new Response('{"id":"re_1"}', { status: 200 }));
      const outbox: unknown[] = [];
      const p = new ResendEmailProvider(
        're_secret_xxx',
        'Mesa de Truco <no-reply@truco.ar>',
        'https://app.truco.ar',
        // @ts-expect-error internal outbox
        outbox,
      );
      await p.sendVerificationEmail({
        to: 'jugador@example.com',
        nickname: 'Pepito',
        token: 'abc123',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://api.resend.com/emails');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer re_secret_xxx',
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(init?.body as string) as {
        from: string;
        to: string;
        subject: string;
        html: string;
        text: string;
      };
      expect(body.from).toBe('Mesa de Truco <no-reply@truco.ar>');
      expect(body.to).toBe('jugador@example.com');
      expect(body.html).toContain('verify-email?token=abc123');
      expect(body.text).toContain('verify-email?token=abc123');
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        template: 'EMAIL_VERIFICATION',
        to: 'jugador@example.com',
      });
    });

    it('throws BAD_GATEWAY when Resend responds non-2xx', async () => {
      fetchMock.mockResolvedValueOnce(new Response('bad api key', { status: 401 }));
      const p = new ResendEmailProvider('bad-key', 'no-reply@truco.ar', 'https://app.truco.ar');
      await expect(
        p.sendPasswordResetEmail({
          to: 'a@b.co',
          nickname: 'x',
          token: 'tok',
          expiresAt: new Date(),
        }),
      ).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
    });
  });

  describe('TurnstileCaptchaVerifier', () => {
    it('rejects empty token with CAPTCHA_FAILED without hitting network', async () => {
      const v = new TurnstileCaptchaVerifier('secret', fetchMock as unknown as typeof fetch);
      await expect(v.verifyOrThrow(undefined, '1.2.3.4')).rejects.toMatchObject({
        code: 'CAPTCHA_FAILED',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts secret/response/remoteip form-encoded and accepts success=true', async () => {
      fetchMock.mockResolvedValueOnce(new Response('{"success":true}', { status: 200 }));
      const v = new TurnstileCaptchaVerifier('cf-secret', fetchMock as unknown as typeof fetch);
      await v.verifyOrThrow('cf-token', '5.6.7.8');
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      expect(init?.method).toBe('POST');
      const body = init?.body as string;
      expect(body).toContain('secret=cf-secret');
      expect(body).toContain('response=cf-token');
      expect(body).toContain('remoteip=5.6.7.8');
    });

    it('throws CAPTCHA_FAILED on success=false and BAD_GATEWAY on HTTP failure', async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response('{"success":false,"error-codes":["invalid-input-response"]}', {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const v = new TurnstileCaptchaVerifier('s', fetchMock as unknown as typeof fetch);
      await expect(v.verifyOrThrow('t', '1.1.1.1')).rejects.toMatchObject({
        code: 'CAPTCHA_FAILED',
      });
      await expect(v.verifyOrThrow('t', '1.1.1.1')).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
    });
  });

  describe('GoogleJwksOAuthVerifier', () => {
    function signJwt(payload: Record<string, unknown>, privKey: string, kid: string): string {
      const header = { alg: 'RS256', typ: 'JWT', kid };
      const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
      const signingInput = `${enc(header)}.${enc(payload)}`;
      const sig = createSign('RSA-SHA256').update(signingInput).sign(privKey);
      return `${signingInput}.${sig.toString('base64url')}`;
    }

    function jwkFromKey(pubKey: KeyObject, kid: string) {
      // publicKey ya es una KeyObject pública; exportamos como JWK directamente.
      const exported = pubKey.export({ format: 'jwk' }) as {
        n?: string;
        e?: string;
        kty?: string;
      };
      if (!exported.n || !exported.e) {
        throw new Error('No se pudo exportar la clave pública a JWK');
      }
      return {
        kid,
        kty: 'RSA' as const,
        alg: 'RS256' as const,
        use: 'sig' as const,
        n: exported.n,
        e: exported.e,
      };
    }

    it('accepts a valid RS256 token signed by a published JWK and rejects invalid cases', async () => {
      const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = jwkFromKey(kp.publicKey, 'key-1');
      const fakeFetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));
      const verifier = new GoogleJwksOAuthVerifier(
        'my-client-id.apps.googleusercontent.com',
        undefined,
        30_000,
        fakeFetch as unknown as typeof fetch,
      );

      const now = Math.floor(Date.now() / 1000);
      const validPayload = {
        iss: 'https://accounts.google.com',
        aud: 'my-client-id.apps.googleusercontent.com',
        sub: '12345',
        email: 'pepe@gmail.com',
        email_verified: true,
        name: 'Pepe',
        iat: now - 10,
        exp: now + 300,
      };
      const privPem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
      const valid = signJwt(validPayload, privPem, 'key-1');
      await expect(verifier.verifyIdToken(valid)).resolves.toMatchObject({
        sub: '12345',
        email: 'pepe@gmail.com',
        emailVerified: true,
        displayName: 'Pepe',
      });

      // aud equivocado
      await expect(
        verifier.verifyIdToken(signJwt({ ...validPayload, aud: 'otro' }, privPem, 'key-1')),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      // expirado
      await expect(
        verifier.verifyIdToken(signJwt({ ...validPayload, exp: now - 100 }, privPem, 'key-1')),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      // iss inválido
      await expect(
        verifier.verifyIdToken(signJwt({ ...validPayload, iss: 'falso' }, privPem, 'key-1')),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      // email_verified=false
      await expect(
        verifier.verifyIdToken(
          signJwt({ ...validPayload, email_verified: false }, privPem, 'key-1'),
        ),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      // kid desconocido
      await expect(
        verifier.verifyIdToken(signJwt(validPayload, privPem, 'otro-kid')),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });
});
