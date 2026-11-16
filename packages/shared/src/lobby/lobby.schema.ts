import { z } from 'zod';
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '../constants/app.js';
import { MatchOutcomeSchema } from '../users/users.schema.js';
import { GameModeSchema, RulesetCodeSchema } from '../ws/client-events.schema.js';

export const TableVisibilitySchema = z.enum(['PUBLIC', 'PRIVATE']);
export type TableVisibility = z.infer<typeof TableVisibilitySchema>;

export const PersistedTableStatusSchema = z.enum([
  'WAITING',
  'IN_GAME',
  'FINISHED',
  'CLOSED',
  'EXPIRED',
]);
export type PersistedTableStatus = z.infer<typeof PersistedTableStatusSchema>;

export const LobbyListFilterStatusSchema = z.enum(['WAITING', 'IN_GAME']);

const joinCodeRegex = new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`);
export const JoinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(joinCodeRegex, 'Código de mesa inválido');

export const CreateTableRequestSchema = z
  .object({
    mode: GameModeSchema,
    visibility: TableVisibilitySchema.optional().default('PUBLIC'),
    rulesetCode: RulesetCodeSchema.optional(),
    targetScore: z.union([z.literal(15), z.literal(30)]).optional(),
    flor: z.boolean().optional(),
    turnTimeoutMs: z.number().int().min(500).max(120_000).optional().default(25_000),
  })
  .strict();
export type CreateTableRequest = z.infer<typeof CreateTableRequestSchema>;

export const ListTablesQuerySchema = z
  .object({
    mode: GameModeSchema.optional(),
    targetScore: z.coerce
      .number()
      .int()
      .refine((v): v is 15 | 30 => v === 15 || v === 30, 'targetScore debe ser 15 o 30')
      .optional(),
    rulesetCode: RulesetCodeSchema.optional(),
    flor: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    status: LobbyListFilterStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(25),
  })
  .strict();
export type ListTablesQuery = z.infer<typeof ListTablesQuerySchema>;

export const JoinByCodeRequestSchema = z
  .object({
    code: JoinCodeSchema.optional(),
    inviteToken: z.string().trim().min(16).max(1024).optional(),
    preferredSeat: z.number().int().min(0).max(3).optional(),
  })
  .strict()
  .refine((val) => Boolean(val.code) || Boolean(val.inviteToken), {
    message: 'Debés proporcionar code o inviteToken para unirte a la mesa',
  });
export type JoinByCodeRequest = z.infer<typeof JoinByCodeRequestSchema>;

export const JoinPublicTableRequestSchema = z
  .object({
    preferredSeat: z.number().int().min(0).max(3).optional(),
  })
  .strict();
export type JoinPublicTableRequest = z.infer<typeof JoinPublicTableRequestSchema>;

/**
 * Vista estrictamente pública de asiento en el lobby y namespace WS `/lobby`
 * (sin userId, email, sessionId, IP ni preferencias privadas).
 */
export const PublicLobbySeatSummarySchema = z
  .object({
    seat: z.number().int().nonnegative(),
    team: z.number().int().nonnegative(),
    occupied: z.boolean(),
    nickname: z.string().nullable(),
  })
  .strict();
export type PublicLobbySeatSummary = z.infer<typeof PublicLobbySeatSummarySchema>;

/**
 * Resumen estrictamente público de una mesa emitido en `GET /v1/tables` y `/lobby`.
 * Jamás incluye `joinCode`, `inviteToken`, `ownerId` ni mesas con `visibility = PRIVATE`.
 */
export const PublicLobbyTableSummarySchema = z
  .object({
    id: z.string().uuid(),
    mode: GameModeSchema,
    rulesetCode: RulesetCodeSchema,
    targetScore: z.union([z.literal(15), z.literal(30)]),
    flor: z.boolean(),
    turnTimeoutMs: z.number().int().positive(),
    status: LobbyListFilterStatusSchema,
    ownerNickname: z.string(),
    occupiedSeats: z.number().int().nonnegative(),
    maxSeats: z.number().int().positive(),
    seats: z.array(PublicLobbySeatSummarySchema),
    createdAt: z.string(),
  })
  .strict();
export type PublicLobbyTableSummary = z.infer<typeof PublicLobbyTableSummarySchema>;

export const PublicTableListResponseSchema = z.object({
  tables: z.array(PublicLobbyTableSummarySchema),
});
export type PublicTableListResponse = z.infer<typeof PublicTableListResponseSchema>;

export const TableParticipantSeatSchema = z.object({
  seat: z.number().int().nonnegative(),
  team: z.number().int().nonnegative(),
  occupied: z.boolean(),
  nickname: z.string().nullable(),
  isOwner: z.boolean(),
  isSelf: z.boolean(),
});
export type TableParticipantSeat = z.infer<typeof TableParticipantSeatSchema>;

export const TableDetailResponseSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  mode: GameModeSchema,
  visibility: TableVisibilitySchema,
  rulesetCode: RulesetCodeSchema,
  targetScore: z.union([z.literal(15), z.literal(30)]),
  flor: z.boolean(),
  turnTimeoutMs: z.number().int().positive(),
  status: PersistedTableStatusSchema,
  ownerNickname: z.string(),
  isOwner: z.boolean(),
  mySeat: z.number().int().nonnegative().nullable(),
  occupiedSeats: z.number().int().nonnegative(),
  maxSeats: z.number().int().positive(),
  seats: z.array(TableParticipantSeatSchema),
  joinCode: z.string().nullable(),
  inviteToken: z.string().nullable(),
  inviteExpiresAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type TableDetailResponse = z.infer<typeof TableDetailResponseSchema>;

export const TableInviteResponseSchema = z.object({
  tableId: z.string().uuid(),
  joinCode: z.string(),
  inviteToken: z.string(),
  invitePath: z.string(),
  expiresAt: z.string(),
});
export type TableInviteResponse = z.infer<typeof TableInviteResponseSchema>;

export const DeleteTableResponseSchema = z.object({
  deleted: z.literal(true),
  tableId: z.string().uuid(),
});
export type DeleteTableResponse = z.infer<typeof DeleteTableResponseSchema>;

export const LeaveTableResponseSchema = z.object({
  left: z.literal(true),
  tableId: z.string().uuid(),
  tableStatus: PersistedTableStatusSchema,
  newOwnerNickname: z.string().nullable(),
});
export type LeaveTableResponse = z.infer<typeof LeaveTableResponseSchema>;

export const MatchmakingEnqueueRequestSchema = z
  .object({
    mode: GameModeSchema,
    rulesetCode: RulesetCodeSchema.optional().default('ar-standard-v1'),
  })
  .strict();
export type MatchmakingEnqueueRequest = z.infer<typeof MatchmakingEnqueueRequestSchema>;

export const MatchmakingQueueStatusResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('IDLE') }),
  z.object({
    status: z.literal('QUEUED'),
    mode: GameModeSchema,
    rulesetCode: RulesetCodeSchema,
    position: z.number().int().positive(),
    enqueuedAt: z.string(),
    expiresAt: z.string(),
  }),
  z.object({
    status: z.literal('MATCHED'),
    tableId: z.string().uuid(),
    roomId: z.string().uuid(),
    mode: GameModeSchema,
    rulesetCode: RulesetCodeSchema,
    mySeat: z.number().int().nonnegative(),
    myTeam: z.number().int().nonnegative(),
  }),
]);
export type MatchmakingQueueStatusResponse = z.infer<typeof MatchmakingQueueStatusResponseSchema>;

export const MatchmakingCancelResponseSchema = z.object({
  cancelled: z.boolean(),
});
export type MatchmakingCancelResponse = z.infer<typeof MatchmakingCancelResponseSchema>;

/**
 * Eventos emitidos por el namespace WebSocket separado `/lobby`.
 */
export const LobbyWsSnapshotEventSchema = z.object({
  tables: z.array(PublicLobbyTableSummarySchema),
});
export const LobbyWsTableUpsertedEventSchema = z.object({
  table: PublicLobbyTableSummarySchema,
});
export const LobbyWsTableRemovedEventSchema = z.object({
  tableId: z.string().uuid(),
});
export const LobbyWsMatchFoundEventSchema = z.object({
  tableId: z.string().uuid(),
  roomId: z.string().uuid(),
  mode: GameModeSchema,
  rulesetCode: RulesetCodeSchema,
  seat: z.number().int().nonnegative(),
  team: z.number().int().nonnegative(),
});

/**
 * Contrato formal de aprovisionamiento `apps/api -> apps/game-server` (ADR-017).
 */
export const RoomProvisionSpecSchema = z
  .object({
    roomId: z.string().uuid(),
    mode: GameModeSchema,
    visibility: TableVisibilitySchema,
    rulesetCode: RulesetCodeSchema,
    ruleset: z.record(z.string(), z.unknown()),
    targetScore: z.union([z.literal(15), z.literal(30)]),
    florEnabled: z.boolean(),
    turnTimeoutMs: z.number().int().min(500).max(120_000),
  })
  .strict();
export type RoomProvisionSpec = z.infer<typeof RoomProvisionSpecSchema>;

/**
 * Eventos asíncronos de ciclo de vida y cierre de partida `apps/game-server -> BullMQ -> apps/api` (ADR-017).
 */
export const MatchStartedLifecycleEventSchema = z.object({
  kind: z.literal('match.started'),
  roomId: z.string().min(3).max(64),
  matchId: z.string().uuid(),
  startedAtMs: z.number().int().positive(),
  seats: z.array(
    z.object({
      seat: z.number().int().nonnegative(),
      team: z.number().int().nonnegative(),
      userId: z.string(),
    }),
  ),
});

export const TableSeatVacatedLifecycleEventSchema = z.object({
  kind: z.literal('table.seatVacated'),
  roomId: z.string().min(3).max(64),
  userId: z.string(),
  seat: z.number().int().nonnegative(),
  vacatedAtMs: z.number().int().positive(),
});

export const MatchCompletedPlayerResultSchema = z.object({
  seat: z.number().int().nonnegative(),
  userId: z.string(),
  nickname: z.string(),
  team: z.number().int().nonnegative(),
  score: z.number().int().nonnegative(),
  outcome: MatchOutcomeSchema,
});

export const MatchCompletedSequencedEventSchema = z.object({
  seq: z.number().int().positive(),
  type: z.string().min(1).max(64),
  ts: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
});

export const MatchCompletedLifecycleEventSchema = z.object({
  kind: z.literal('match.completed'),
  matchId: z.string().uuid(),
  roomId: z.string().min(3).max(64),
  mode: GameModeSchema,
  rulesetCode: RulesetCodeSchema,
  seedCommitment: z.string().regex(/^[a-f0-9]{64}$/),
  seedReveal: z.string().regex(/^[a-f0-9]{64}$/),
  startedAtMs: z.number().int().positive(),
  endedAtMs: z.number().int().positive(),
  winnerTeam: z.number().int().nonnegative(),
  scoresByTeam: z.record(z.string(), z.number().int().nonnegative()),
  reason: z.string().min(1),
  players: z.array(MatchCompletedPlayerResultSchema).min(2),
  events: z.array(MatchCompletedSequencedEventSchema).min(1),
});

export const MatchLifecycleEventSchema = z.discriminatedUnion('kind', [
  MatchStartedLifecycleEventSchema,
  TableSeatVacatedLifecycleEventSchema,
  MatchCompletedLifecycleEventSchema,
]);

export type MatchStartedLifecycleEvent = z.infer<typeof MatchStartedLifecycleEventSchema>;
export type TableSeatVacatedLifecycleEvent = z.infer<typeof TableSeatVacatedLifecycleEventSchema>;
export type MatchCompletedLifecycleEvent = z.infer<typeof MatchCompletedLifecycleEventSchema>;
export type MatchLifecycleEvent = z.infer<typeof MatchLifecycleEventSchema>;
