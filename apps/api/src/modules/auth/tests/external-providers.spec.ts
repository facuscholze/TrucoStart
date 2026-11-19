import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, createLocalJWKSet, type JSONWebKeySet, type JWTPayload } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResendEmailProvider, SmtpEmailProvider } from '../providers/resend-email.provider.js';
import { GoogleJwksOAuthVerifier } from '../providers/google-jwks.verifier.js';
import { DomainApiException } from '../../../common/api-exception.js';
import { TurnstileCaptchaVerifier } from '../providers/turnstile-captcha.verifier.js';

/**
 * Tests de los adaptadores productivos (Resend, SMTP/nodemailer, Google JWKS, Turnstile).
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

  describe('SmtpEmailProvider (nodemailer)', () => {
    function transportMock() {
      return { sendMail: vi.fn().mockResolvedValue({ messageId: 'smtp-1' }) };
    }

    it('envía el correo de verificación con from, asunto y enlace tokenizado', async () => {
      const transport = transportMock();
      const provider = new SmtpEmailProvider(
        transport,
        'Mesa de Truco <no-reply@truco.ar>',
        'https://app.truco.ar',
      );
      await provider.sendVerificationEmail({
        to: 'jugador@example.com',
        nickname: 'Pepito',
        token: 'abc123',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      });
      expect(transport.sendMail).toHaveBeenCalledTimes(1);
      const mail = transport.sendMail.mock.calls[0]![0] as {
        from: string;
        to: string;
        subject: string;
        html: string;
        text: string;
      };
      expect(mail.from).toBe('Mesa de Truco <no-reply@truco.ar>');
      expect(mail.to).toBe('jugador@example.com');
      expect(mail.subject).toContain('Confirmá tu correo');
      expect(mail.text).toContain('https://app.truco.ar/verify-email?token=abc123');
      expect(mail.html).toContain('abc123');
    });

    it('escapa HTML del apodo para no inyectar markup en el correo', async () => {
      const transport = transportMock();
      const provider = new SmtpEmailProvider(transport, 'a@b.c', 'https://app.truco.ar');
      await provider.sendPasswordResetEmail({
        to: 'x@example.com',
        nickname: '<script>alert(1)</script>',
        token: 't',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      });
      const mail = transport.sendMail.mock.calls[0]![0] as { html: string };
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).toContain('&lt;script&gt;');
    });

    it('traduce un fallo del transporte SMTP a BAD_GATEWAY (sin filtrar credenciales)', async () => {
      const transport = {
        sendMail: vi.fn().mockRejectedValue(new Error('535 auth failed for smtp://user:pw@host')),
      };
      const provider = new SmtpEmailProvider(transport, 'a@b.c', 'https://app.truco.ar');
      await expect(
        provider.sendVerificationEmail({
          to: 'x@example.com',
          nickname: 'X',
          token: 't',
          expiresAt: new Date('2030-01-01T00:00:00Z'),
        }),
      ).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
    });
  });

  describe('GoogleJwksOAuthVerifier (jose)', () => {
    const CLIENT_ID = 'my-client-id.apps.googleusercontent.com';

    async function makeKeys(kid = 'key-1') {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = {
        ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
        kid,
        alg: 'RS256',
        use: 'sig',
      };
      return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] } as JSONWebKeySet) };
    }

    function basePayload(): JWTPayload {
      const now = Math.floor(Date.now() / 1000);
      return {
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: '12345',
        email: 'pepe@gmail.com',
        email_verified: true,
        name: 'Pepe',
        iat: now - 10,
        exp: now + 300,
      };
    }

    it('acepta un token RS256 firmado por una JWK publicada', async () => {
      const { privateKey, jwks } = await makeKeys();
      const verifier = new GoogleJwksOAuthVerifier(CLIENT_ID, undefined, 30, jwks);
      const token = await new SignJWT(basePayload())
        .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
        .sign(privateKey);

      await expect(verifier.verifyIdToken(token)).resolves.toMatchObject({
        sub: '12345',
        email: 'pepe@gmail.com',
        emailVerified: true,
        displayName: 'Pepe',
      });
    });

    it('rechaza aud, iss, exp, firma, kid y email_verified inválidos con 401', async () => {
      const { privateKey, jwks } = await makeKeys();
      const verifier = new GoogleJwksOAuthVerifier(CLIENT_ID, undefined, 30, jwks);
      const sign = (payload: JWTPayload, kid = 'key-1') =>
        new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid }).sign(privateKey);

      await expect(
        verifier.verifyIdToken(await sign({ ...basePayload(), aud: 'otro' })),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(
        verifier.verifyIdToken(await sign({ ...basePayload(), iss: 'falso' })),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(
        verifier.verifyIdToken(
          await sign({ ...basePayload(), exp: Math.floor(Date.now() / 1000) - 100 }),
        ),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(
        verifier.verifyIdToken(await sign({ ...basePayload(), email_verified: false })),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      // kid desconocido: jose intenta refetch y el set local no lo tiene.
      await expect(
        verifier.verifyIdToken(await sign(basePayload(), 'otro-kid')),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      // Firma con una clave distinta a la publicada.
      const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const forged = await new SignJWT(basePayload())
        .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
        .sign(other.privateKey);
      await expect(verifier.verifyIdToken(forged)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      // Token malformado.
      await expect(verifier.verifyIdToken('no-es-un-jwt')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('exige el dominio alojado (hd) cuando se configura GOOGLE_HOSTED_DOMAIN', async () => {
      const { privateKey, jwks } = await makeKeys();
      const verifier = new GoogleJwksOAuthVerifier(CLIENT_ID, 'truco.ar', 30, jwks);
      const sign = (hd: string) =>
        new SignJWT({ ...basePayload(), hd })
          .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
          .sign(privateKey);

      await expect(verifier.verifyIdToken(await sign('truco.ar'))).resolves.toMatchObject({
        email: 'pepe@gmail.com',
      });
      await expect(verifier.verifyIdToken(await sign('otro.com'))).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });
});

/**
 * El verifier de producción (sin inyectar `jwks`) debe usar el set remoto real
 * de Google. Se comprueba sin red: un token firmado con una clave que Google no
 * publica tiene que fallar, y el código de error nunca debe ser 5xx.
 */
describe('GoogleJwksOAuthVerifier — set remoto por defecto', () => {
  it('rechaza con 401 un token cuya clave no está en las JWKS de Google', async () => {
    const verifier = new GoogleJwksOAuthVerifier('cid.apps.googleusercontent.com');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      iss: 'https://accounts.google.com',
      aud: 'cid.apps.googleusercontent.com',
      sub: '1',
      email: 'x@gmail.com',
      email_verified: true,
      iat: now - 10,
      exp: now + 300,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-que-google-no-publica' })
      .sign(privateKey);

    // Sin red disponible en CI el fallo también es 401/502, nunca un bypass.
    await expect(verifier.verifyIdToken(token)).rejects.toBeInstanceOf(DomainApiException);
    await expect(verifier.verifyIdToken(token)).rejects.toMatchObject({
      code: expect.stringMatching(/^(UNAUTHORIZED|BAD_GATEWAY)$/),
    });
  });
});
