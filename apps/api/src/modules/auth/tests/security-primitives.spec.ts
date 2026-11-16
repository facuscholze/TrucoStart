import { describe, expect, it } from 'vitest';
import { generateUuidV7 } from '../../../common/uuidv7.js';
import { SimulatedCaptchaVerifier } from '../providers/captcha.verifier.js';
import { ConsoleEmailProvider } from '../providers/email.provider.js';
import {
  createSimulatedGoogleIdToken,
  SimulatedGoogleOAuthVerifier,
} from '../providers/google-oauth.verifier.js';
import { HttpAuthRateLimiter } from '../security/http-rate-limiter.js';
import { PasswordHasher } from '../security/password-hasher.js';
import {
  computeNextFailedLoginLockout,
  createAccessCookieValue,
  verifyAccessSessionCookie,
} from '../security/token-crypto.js';

describe('M3 Security Primitives & Pluggable Dev/Test Providers', () => {
  it('hashes and verifies passwords with Argon2id ($argon2id$) including timing-safe null hash path', async () => {
    const hasher = new PasswordHasher();
    const hash = await hasher.hashPassword('ClaveTruco2026!');
    expect(hash.startsWith('$argon2id$')).toBe(true);

    expect(await hasher.verifyPasswordTimingSafe('ClaveTruco2026!', hash)).toBe(true);
    expect(await hasher.verifyPasswordTimingSafe('Incorrecta999', hash)).toBe(false);
    expect(await hasher.verifyPasswordTimingSafe('Cualquiera123', null)).toBe(false);
  });

  it('computes progressive lockout windows and signs/verifies HMAC access cookies', () => {
    const now = 1_800_000_000_000;
    expect(computeNextFailedLoginLockout(0, now).lockedUntil).toBeNull();
    expect(computeNextFailedLoginLockout(3, now).lockedUntil).toBeNull();

    // 5to intento fallido -> 60s
    const l5 = computeNextFailedLoginLockout(4, now);
    expect(l5.failedLoginCount).toBe(5);
    expect(l5.lockedUntil?.getTime()).toBe(now + 60_000);

    // 6to -> 300s, 7mo -> 900s, 8vo+ -> 3600s
    expect(computeNextFailedLoginLockout(5, now).lockedUntil?.getTime()).toBe(now + 300_000);
    expect(computeNextFailedLoginLockout(6, now).lockedUntil?.getTime()).toBe(now + 900_000);
    expect(computeNextFailedLoginLockout(7, now).lockedUntil?.getTime()).toBe(now + 3_600_000);

    const secret = 'secreto-cookies-m3-minimo-32-caracteres-largo!';
    const uid = generateUuidV7(now);
    const sid = generateUuidV7(now + 1);
    const cookie = createAccessCookieValue({
      userId: uid,
      sessionId: sid,
      role: 'PLAYER',
      isGuest: false,
      secret,
      nowMs: now,
      ttlSeconds: 900,
    });
    expect(verifyAccessSessionCookie(cookie, secret, now + 1_000)?.userId).toBe(uid);
    expect(verifyAccessSessionCookie(cookie, secret, now + 901_000)).toBeNull();
    expect(verifyAccessSessionCookie(`${cookie}tamper`, secret, now)).toBeNull();
  });

  it('enforces independent sliding-window rate limits per IP and per account', () => {
    let clock = 1_000_000;
    const limiter = new HttpAuthRateLimiter({
      windowMs: 60_000,
      maxPerIp: 3,
      maxPerAccount: 2,
      nowFn: () => clock,
    });

    limiter.enforce({ endpointGroup: 'login', ip: '10.0.0.1', accountKey: 'ana@test.com' });
    limiter.enforce({ endpointGroup: 'login', ip: '10.0.0.2', accountKey: 'ana@test.com' });
    // 3er intento para la misma cuenta desde una tercera IP distinta -> bloqueado por cuenta
    expect(() =>
      limiter.enforce({ endpointGroup: 'login', ip: '10.0.0.3', accountKey: 'ana@test.com' }),
    ).toThrow(/cuenta/);

    // Exceso por IP aunque cambie de cuenta
    limiter.enforce({ endpointGroup: 'login', ip: '10.0.0.1', accountKey: 'b1@test.com' });
    limiter.enforce({ endpointGroup: 'login', ip: '10.0.0.1', accountKey: 'b2@test.com' });
    expect(() =>
      limiter.enforce({ endpointGroup: 'login', ip: '10.0.0.1', accountKey: 'b3@test.com' }),
    ).toThrow(/dirección IP/);

    clock += 61_000;
    expect(() =>
      limiter.enforce({ endpointGroup: 'login', ip: '10.0.0.1', accountKey: 'ana@test.com' }),
    ).not.toThrow();
  });

  it('validates simulated Email, Google OAuth, and Captcha providers behind clean interfaces', async () => {
    const email = new ConsoleEmailProvider();
    expect(email.isSimulated).toBe(true);
    await email.sendPasswordResetEmail({
      to: 'facu@test.com',
      nickname: 'Facu',
      token: 'tok-reset-123',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(email.getLatestMessageFor('FACU@test.com', 'PASSWORD_RESET')?.token).toBe(
      'tok-reset-123',
    );

    const googleDev = new SimulatedGoogleOAuthVerifier({ allowSimulatedTokens: true });
    const idToken = createSimulatedGoogleIdToken({
      sub: 'goog-sub-999',
      email: 'GoogleUser@Test.com',
      name: 'Google Truquero',
    });
    const identity = await googleDev.verifyIdToken(idToken);
    expect(identity.email).toBe('googleuser@test.com');

    const googleProd = new SimulatedGoogleOAuthVerifier({ allowSimulatedTokens: false });
    await expect(googleProd.verifyIdToken(idToken)).rejects.toThrow();

    const captcha = new SimulatedCaptchaVerifier({ requireToken: true });
    await expect(captcha.verifyOrThrow(undefined, '127.0.0.1')).rejects.toThrow();
    await expect(captcha.verifyOrThrow('sim-captcha-fail', '127.0.0.1')).rejects.toThrow();
    await expect(captcha.verifyOrThrow('sim-captcha-ok', '127.0.0.1')).resolves.toBeUndefined();
  });
});
