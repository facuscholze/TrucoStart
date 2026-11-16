import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiErrorResponseSchema,
  ClientEventTypeSchema,
  ClientMessageSchema,
  createApiErrorResponse,
  createWsEnvelopeSchema,
  GameEndedPayloadSchema,
  GameStartedPayloadSchema,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  QUICK_CHAT_PHRASES,
  signWsAuthTicket,
  verifyWsAuthTicket,
  WsEnvelopeSchema,
} from '../src/index.js';

const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Shared REST & WebSocket contracts', () => {
  it('excludes ambiguous characters (0, O, 1, I) from join code alphabet', () => {
    expect(JOIN_CODE_LENGTH).toBe(6);
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[0O1I]/);
    expect(new Set(JOIN_CODE_ALPHABET.split('')).size).toBe(JOIN_CODE_ALPHABET.length);
  });

  it('builds standardized API error responses matching ApiErrorResponseSchema', () => {
    const err = createApiErrorResponse('VALIDATION_ERROR', 'Entrada inválida', {
      field: 'nickname',
    });
    const parsed = ApiErrorResponseSchema.parse(err);

    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    expect(parsed.error.details).toEqual({ field: 'nickname' });
  });

  it('validates WebSocket envelopes and discriminated ClientMessageSchema payloads', () => {
    const valid = WsEnvelopeSchema.safeParse({
      eventId: '019a7e40-0000-7000-8000-000000000001',
      seq: 0,
      ts: 1794600000000,
      type: 'game.playCard',
      payload: { roomId: 'mesa-1', cardId: '1-espadas' },
    });
    expect(valid.success).toBe(true);

    expect(
      ClientMessageSchema.safeParse({
        eventId: 'evt-join-0001',
        ts: Date.now(),
        type: 'table.join',
        payload: { roomId: 'mesa-1', mode: '2v2', rulesetCode: 'ar-standard-v1' },
      }).success,
    ).toBe(true);

    expect(
      ClientMessageSchema.safeParse({
        eventId: 'evt-chat-0001',
        ts: Date.now(),
        type: 'chat.quick',
        payload: { roomId: 'mesa-1', phraseId: QUICK_CHAT_PHRASES[0].id },
      }).success,
    ).toBe(true);

    // Rechaza frases arbitrarias (no hay chat libre en MVP)
    expect(
      ClientMessageSchema.safeParse({
        eventId: 'evt-chat-bad',
        ts: Date.now(),
        type: 'chat.quick',
        payload: { roomId: 'mesa-1', phraseId: 'texto_libre_prohibido' },
      }).success,
    ).toBe(false);

    // Valida formatos SHA-256 hex de commit-reveal en game.started y game.ended
    const hex64 = 'a'.repeat(64);
    expect(
      GameStartedPayloadSchema.safeParse({
        roomId: 'mesa-1',
        matchId: 'match-123456',
        rulesetCode: 'ar-standard-v1',
        targetScore: 30,
        seats: [],
        seedCommitment: hex64,
      }).success,
    ).toBe(true);

    expect(
      GameEndedPayloadSchema.safeParse({
        roomId: 'mesa-1',
        matchId: 'match-123456',
        winnerTeam: 0,
        scoresByTeam: { '0': 30, '1': 18 },
        reason: 'TARGET_SCORE',
        seedCommitment: hex64,
        seedReveal: hex64,
      }).success,
    ).toBe(true);
  });

  it('signs and verifies HMAC WS auth tickets and rejects tampered or expired tokens', () => {
    const now = 1_800_000_000_000;
    const token = signWsAuthTicket(
      {
        userId: 'user-1',
        sessionId: 'sess-12345678',
        nickname: 'Facu',
        exp: now + 60_000,
      },
      TEST_SECRET,
    );

    const verified = verifyWsAuthTicket(token, TEST_SECRET, now);
    expect(verified).toEqual({
      userId: 'user-1',
      sessionId: 'sess-12345678',
      nickname: 'Facu',
      exp: now + 60_000,
    });

    // Expirado
    expect(verifyWsAuthTicket(token, TEST_SECRET, now + 60_001)).toBeNull();
    // Firma adulterada
    expect(verifyWsAuthTicket(`${token}x`, TEST_SECRET, now)).toBeNull();
    // Secreto incorrecto
    expect(verifyWsAuthTicket(token, 'x'.repeat(40), now)).toBeNull();

    const PlayCardEnvelope = createWsEnvelopeSchema(
      z.literal(ClientEventTypeSchema.enum['game.playCard']),
      z.object({ cardId: z.string().min(1) }),
    );
    expect(
      PlayCardEnvelope.safeParse({
        eventId: 'evt-12345678',
        ts: Date.now(),
        type: 'game.playCard',
        payload: { cardId: '7-oros' },
      }).success,
    ).toBe(true);
  });
});
