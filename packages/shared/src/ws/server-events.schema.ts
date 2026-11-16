import { z } from 'zod';
import { ErrorCodeSchema } from '../errors/error-codes.js';
import {
  GameModeSchema,
  RoomIdSchema,
  RulesetCodeSchema,
  WsCallBidSchema,
} from './client-events.schema.js';
import { QuickChatPhraseIdSchema } from './quick-chat.js';

export const RoomSeatInfoSchema = z.object({
  seat: z.number().int().nonnegative(),
  team: z.number().int().nonnegative(),
  userId: z.string().nullable(),
  nickname: z.string().nullable(),
  ready: z.boolean(),
  connected: z.boolean(),
});
export type RoomSeatInfo = z.infer<typeof RoomSeatInfoSchema>;

export const TableStatusSchema = z.enum(['WAITING', 'IN_GAME', 'FINISHED']);
export type TableStatus = z.infer<typeof TableStatusSchema>;

export const TableStatePayloadSchema = z.object({
  roomId: RoomIdSchema,
  status: TableStatusSchema,
  mode: GameModeSchema,
  rulesetCode: RulesetCodeSchema,
  turnTimeoutMs: z.number().int().positive(),
  seats: z.array(RoomSeatInfoSchema),
  matchId: z.string().nullable(),
});

export const GameStartedPayloadSchema = z.object({
  roomId: RoomIdSchema,
  matchId: z.string().min(8),
  rulesetCode: RulesetCodeSchema,
  targetScore: z.number().int().positive(),
  seats: z.array(RoomSeatInfoSchema),
  seedCommitment: z.string().regex(/^[a-f0-9]{64}$/, 'seedCommitment debe ser SHA-256 hex'),
});

export const WireCardSchema = z.object({
  id: z.string(),
  rank: z.number().int(),
  suit: z.enum(['espadas', 'bastos', 'oros', 'copas']),
});

export const GameDealtPayloadSchema = z.object({
  roomId: RoomIdSchema,
  handNumber: z.number().int().positive(),
  manoSeat: z.number().int().nonnegative(),
  mySeat: z.number().int().nonnegative(),
  myCards: z.array(WireCardSchema).length(3),
  view: z.record(z.string(), z.unknown()),
});

export const GameTurnPayloadSchema = z.object({
  roomId: RoomIdSchema,
  handNumber: z.number().int().positive(),
  seat: z.number().int().nonnegative(),
  responderTeam: z.number().int().nonnegative().nullable(),
  deadline: z.number().int().positive(),
  warningAt: z.number().int().positive(),
  isWarning: z.boolean().optional(),
  view: z.record(z.string(), z.unknown()).optional(),
});

export const GameCardPlayedPayloadSchema = z.object({
  roomId: RoomIdSchema,
  handNumber: z.number().int().positive(),
  roundIndex: z.number().int().nonnegative(),
  seat: z.number().int().nonnegative(),
  team: z.number().int().nonnegative(),
  card: WireCardSchema,
  roundEnded: z
    .object({
      winnerTeam: z.number().int().nonnegative().nullable(),
      winningSeat: z.number().int().nonnegative().nullable(),
      isParda: z.boolean(),
    })
    .nullable(),
});

export const GameCallMadePayloadSchema = z.object({
  roomId: RoomIdSchema,
  handNumber: z.number().int().positive(),
  family: z.enum(['ENVIDO', 'FLOR', 'TRUCO']),
  bid: WsCallBidSchema,
  seat: z.number().int().nonnegative(),
  team: z.number().int().nonnegative(),
  cancelledPendingTruco: z.boolean().optional(),
});

export const GameCallResolvedPayloadSchema = z.object({
  roomId: RoomIdSchema,
  handNumber: z.number().int().positive(),
  family: z.enum(['ENVIDO', 'FLOR', 'TRUCO']),
  accepted: z.boolean(),
  winningTeam: z.number().int().nonnegative().nullable(),
  winningSeat: z.number().int().nonnegative().nullable(),
  winningScore: z.number().int().nonnegative().nullable(),
  pointsAwarded: z.number().int().nonnegative(),
  responderSeat: z.number().int().nonnegative().nullable(),
});

export const GameSignalSentPayloadSchema = z.object({
  roomId: RoomIdSchema,
  handNumber: z.number().int().positive(),
  seat: z.number().int().nonnegative(),
  team: z.number().int().nonnegative(),
  signalId: z.string().min(2),
});

export const GameHandEndedPayloadSchema = z.object({
  roomId: RoomIdSchema,
  handNumber: z.number().int().positive(),
  winnerTeam: z.number().int().nonnegative(),
  pointsAwarded: z.number().int().nonnegative(),
  reason: z.string().min(1),
  foldedSeat: z.number().int().nonnegative().nullable().optional(),
});

export const GameScoreUpdatedPayloadSchema = z.object({
  roomId: RoomIdSchema,
  handNumber: z.number().int().positive(),
  team: z.number().int().nonnegative(),
  delta: z.number().int().nonnegative(),
  newScore: z.number().int().nonnegative(),
  reason: z.string().min(1),
});

export const GameEndedPayloadSchema = z.object({
  roomId: RoomIdSchema,
  matchId: z.string().min(8),
  winnerTeam: z.number().int().nonnegative(),
  scoresByTeam: z.record(z.string(), z.number().int().nonnegative()),
  reason: z.string().min(1),
  seedCommitment: z.string().regex(/^[a-f0-9]{64}$/),
  seedReveal: z.string().regex(/^[a-f0-9]{64}$/),
});

export const PlayerDisconnectedPayloadSchema = z.object({
  roomId: RoomIdSchema,
  seat: z.number().int().nonnegative(),
  userId: z.string(),
  graceDeadline: z.number().int().positive(),
});

export const PlayerReconnectedPayloadSchema = z.object({
  roomId: RoomIdSchema,
  seat: z.number().int().nonnegative(),
  userId: z.string(),
});

export const GameResyncPayloadSchema = z.object({
  roomId: RoomIdSchema,
  matchId: z.string().nullable(),
  seedCommitment: z.string().nullable(),
  turnDeadline: z.number().int().positive().nullable(),
  view: z.record(z.string(), z.unknown()),
});

export const ChatQuickMessagePayloadSchema = z.object({
  roomId: RoomIdSchema,
  seat: z.number().int().nonnegative(),
  nickname: z.string(),
  phraseId: QuickChatPhraseIdSchema,
  text: z.string(),
});

export const WsErrorPayloadSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  refEventId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
