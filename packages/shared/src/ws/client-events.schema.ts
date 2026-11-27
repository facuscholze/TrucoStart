import { z } from 'zod';
import { QuickChatPhraseIdSchema } from './quick-chat.js';

export const RoomIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, 'roomId solo admite caracteres alfanuméricos, guion y guion bajo');

/**
 * Modos de mesa. `3v3` es el truco de 6 (tres equipos de 2): se juega igual que el resto,
 * pero queda **fuera del ranking competitivo** (ver ADR-033) y no admite torneos ni partidas
 * de liga en esta etapa.
 */
export const GameModeSchema = z.enum(['1v1', '2v2', '3v3']);
export type GameMode = z.infer<typeof GameModeSchema>;

export const RulesetCodeSchema = z.enum([
  'ar-standard-v1',
  'ar-sin-flor-v1',
  'ar-corto-15-v1',
  'ar-corto-15-flor-v1',
]);
export type RulesetCode = z.infer<typeof RulesetCodeSchema>;

export const WsCallBidSchema = z.enum([
  'ENVIDO',
  'REAL_ENVIDO',
  'FALTA_ENVIDO',
  'FLOR',
  'CONTRAFLOR',
  'CONTRAFLOR_AL_RESTO',
  'TRUCO',
  'RETRUCO',
  'VALE_CUATRO',
]);
export type WsCallBid = z.infer<typeof WsCallBidSchema>;

export const WsCallFamilySchema = z.enum(['ENVIDO', 'FLOR', 'TRUCO']);
export type WsCallFamily = z.infer<typeof WsCallFamilySchema>;

export const WsRespondAnswerSchema = z.enum([
  'QUIERO',
  'NO_QUIERO',
  'SUBIR',
  'CON_FLOR_QUIERO',
  'ACHICO',
]);
export type WsRespondAnswer = z.infer<typeof WsRespondAnswerSchema>;

export const TableJoinPayloadSchema = z.object({
  roomId: RoomIdSchema,
  mode: GameModeSchema.optional(),
  rulesetCode: RulesetCodeSchema.optional(),
  turnTimeoutMs: z.number().int().min(500).max(120_000).optional(),
  preferredSeat: z.number().int().min(0).max(5).optional(),
});

export const TableLeavePayloadSchema = z.object({
  roomId: RoomIdSchema,
});

export const TableReadyPayloadSchema = z.object({
  roomId: RoomIdSchema,
  ready: z.boolean(),
});

export const GamePlayCardPayloadSchema = z.object({
  roomId: RoomIdSchema,
  cardId: z.string().min(3).max(24),
});

export const GameCallPayloadSchema = z.object({
  roomId: RoomIdSchema,
  type: WsCallBidSchema,
});

export const GameRespondPayloadSchema = z.object({
  roomId: RoomIdSchema,
  call: WsCallFamilySchema,
  answer: WsRespondAnswerSchema,
  raiseTo: WsCallBidSchema.optional(),
});

export const GameFoldHandPayloadSchema = z.object({
  roomId: RoomIdSchema,
});

export const GameSignalPayloadSchema = z.object({
  roomId: RoomIdSchema,
  signalId: z.string().min(2).max(40),
});

export const ChatQuickPayloadSchema = z.object({
  roomId: RoomIdSchema,
  phraseId: QuickChatPhraseIdSchema,
});

export const GameRejoinPayloadSchema = z.object({
  roomId: RoomIdSchema,
  sessionId: z.string().min(8).max(128),
  lastSeq: z.number().int().nonnegative(),
});

const BaseClientFields = {
  eventId: z.string().min(8).max(128),
  seq: z.number().int().nonnegative().optional(),
  ts: z.number().int().positive(),
};

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...BaseClientFields, type: z.literal('table.join'), payload: TableJoinPayloadSchema }),
  z.object({
    ...BaseClientFields,
    type: z.literal('table.leave'),
    payload: TableLeavePayloadSchema,
  }),
  z.object({
    ...BaseClientFields,
    type: z.literal('table.ready'),
    payload: TableReadyPayloadSchema,
  }),
  z.object({
    ...BaseClientFields,
    type: z.literal('game.playCard'),
    payload: GamePlayCardPayloadSchema,
  }),
  z.object({ ...BaseClientFields, type: z.literal('game.call'), payload: GameCallPayloadSchema }),
  z.object({
    ...BaseClientFields,
    type: z.literal('game.respond'),
    payload: GameRespondPayloadSchema,
  }),
  z.object({
    ...BaseClientFields,
    type: z.literal('game.foldHand'),
    payload: GameFoldHandPayloadSchema,
  }),
  z.object({
    ...BaseClientFields,
    type: z.literal('game.signal'),
    payload: GameSignalPayloadSchema,
  }),
  z.object({ ...BaseClientFields, type: z.literal('chat.quick'), payload: ChatQuickPayloadSchema }),
  z.object({
    ...BaseClientFields,
    type: z.literal('game.rejoin'),
    payload: GameRejoinPayloadSchema,
  }),
  z.object({
    ...BaseClientFields,
    type: z.literal('practice.hint'),
    payload: z.object({ roomId: RoomIdSchema }),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
