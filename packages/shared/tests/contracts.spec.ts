import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiErrorResponseSchema,
  ClientEventTypeSchema,
  createApiErrorResponse,
  createWsEnvelopeSchema,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  WsEnvelopeSchema,
} from '../src/index.js';

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

  it('validates WebSocket envelopes and rejects malformed messages', () => {
    const valid = WsEnvelopeSchema.safeParse({
      eventId: '019a7e40-0000-7000-8000-000000000001',
      seq: 0,
      ts: 1794600000000,
      type: 'game.playCard',
      payload: { cardId: '1-espadas' },
    });
    expect(valid.success).toBe(true);

    const invalidType = WsEnvelopeSchema.safeParse({
      eventId: '019a7e40-0000-7000-8000-000000000001',
      ts: 1794600000000,
      type: 'unknown.event',
      payload: {},
    });
    expect(invalidType.success).toBe(false);
  });

  it('creates strongly typed payload-specific WebSocket envelope schemas', () => {
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
