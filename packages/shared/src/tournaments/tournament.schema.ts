import { z } from 'zod';
import { RulesetCodeSchema } from '../ws/client-events.schema.js';
import { TournamentFormatSchema } from './bracket.js';

/**
 * Contratos de torneos (M10a) compartidos por API, web y admin.
 *
 * Invariante de producto (regla 13): un torneo **nunca** tiene inscripción con costo
 * ni premio con valor económico. Los premios son cosméticos o monedas virtuales del
 * libro mayor existente (`VIRTUAL_COIN`, sin valor económico, sin transferencias).
 */

export const TournamentStatusSchema = z.enum([
  'DRAFT',
  'REGISTRATION',
  'CHECK_IN',
  'IN_PROGRESS',
  'FINISHED',
  'CANCELLED',
]);
export type TournamentStatus = z.infer<typeof TournamentStatusSchema>;

/** Transiciones permitidas del ciclo de vida; cualquier otra se rechaza. */
export const TOURNAMENT_STATUS_TRANSITIONS: Readonly<
  Record<TournamentStatus, readonly TournamentStatus[]>
> = {
  DRAFT: ['REGISTRATION', 'CANCELLED'],
  REGISTRATION: ['CHECK_IN', 'CANCELLED'],
  CHECK_IN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['FINISHED', 'CANCELLED'],
  FINISHED: [],
  CANCELLED: [],
};

export function canTransitionTournament(from: TournamentStatus, to: TournamentStatus): boolean {
  return TOURNAMENT_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Modos que puede disputar un torneo: 1v1 y 2v2. El truco de 6 (`3v3`) no tiene torneos en esta
 * etapa, así que el tipo lo excluye y el compilador impide crear uno por error.
 */
export const TournamentModeSchema = z.enum(['1v1', '2v2']);
export type TournamentMode = z.infer<typeof TournamentModeSchema>;

export const TournamentVisibilitySchema = z.enum(['OFFICIAL', 'PRIVATE']);
export type TournamentVisibility = z.infer<typeof TournamentVisibilitySchema>;

export const TournamentParticipantStatusSchema = z.enum([
  'REGISTERED',
  'CHECKED_IN',
  'NO_SHOW',
  'WITHDRAWN',
  'DISQUALIFIED',
  'ELIMINATED',
  'WINNER',
]);
export type TournamentParticipantStatus = z.infer<typeof TournamentParticipantStatusSchema>;

/**
 * Motivos por los que una partida de torneo se define sin jugarse. El ganador no
 * siempre es quien se presentó: `DOUBLE_FORFEIT` deja el cruce sin ganador.
 */
export const TournamentForfeitReasonSchema = z.enum(['NO_SHOW', 'ABANDON', 'DISQUALIFIED']);
export type TournamentForfeitReason = z.infer<typeof TournamentForfeitReasonSchema>;

/** Premio: sólo monedas virtuales o cosméticos. Nunca dinero ni valor económico. */
export const TournamentPrizeSchema = z
  .object({
    position: z.number().int().min(1).max(64),
    coins: z.number().int().min(0).max(100_000).default(0),
    cosmeticId: z.string().min(1).max(64).nullable().default(null),
  })
  .strict()
  .refine((prize) => prize.coins > 0 || prize.cosmeticId !== null, {
    message: 'Un premio debe tener monedas o un cosmético',
  });
export type TournamentPrize = z.infer<typeof TournamentPrizeSchema>;

export const TournamentRulesSchema = z
  .object({
    mode: TournamentModeSchema,
    rulesetCode: RulesetCodeSchema,
    targetScore: z.number().int().min(15).max(30),
    florEnabled: z.boolean(),
    turnTimeoutMs: z.number().int().min(10_000).max(60_000),
  })
  .strict();
export type TournamentRules = z.infer<typeof TournamentRulesSchema>;

/** Cupo máximo: potencias de 2 y no potencias; el cuadro se completa con byes. */
export const TOURNAMENT_MIN_CAPACITY = 2;
export const TOURNAMENT_MAX_CAPACITY = 64;

export const CreateTournamentRequestSchema = z
  .object({
    name: z.string().trim().min(3).max(60),
    format: TournamentFormatSchema,
    visibility: TournamentVisibilitySchema,
    capacity: z.number().int().min(TOURNAMENT_MIN_CAPACITY).max(TOURNAMENT_MAX_CAPACITY),
    rules: TournamentRulesSchema,
    /**
     * Ventanas del ciclo de vida, en minutos desde la creación. Se guardan como
     * instantes absolutos al crear; el cliente no puede moverlos después.
     */
    registrationMinutes: z.number().int().min(1).max(10_080),
    checkInMinutes: z.number().int().min(1).max(120),
    /** Plazo para presentarse a una partida antes de la derrota por incomparecencia. */
    noShowMinutes: z.number().int().min(1).max(60).default(10),
    prizes: z.array(TournamentPrizeSchema).max(8).default([]),
    /** Sólo el admin puede crear torneos oficiales. */
    official: z.boolean().default(false),
  })
  .strict();
export type CreateTournamentRequest = z.infer<typeof CreateTournamentRequestSchema>;

/** Inscripción de un equipo (sólo torneos 2v2). */
export const RegisterTeamRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    teammateUserIds: z.array(z.string().uuid()).min(1).max(1),
  })
  .strict();
export type RegisterTeamRequest = z.infer<typeof RegisterTeamRequestSchema>;

export const RegisterTeamResponseSchema = z
  .object({
    teamId: z.string().uuid(),
    participants: z.number().int(),
  })
  .strict();
export type RegisterTeamResponse = z.infer<typeof RegisterTeamResponseSchema>;

/** Equipo visto en el detalle del torneo. */
export const TournamentTeamViewSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    seed: z.number().int().nullable(),
    captainUserId: z.string().uuid(),
    members: z.array(
      z
        .object({
          userId: z.string().uuid(),
          nickname: z.string(),
          status: TournamentParticipantStatusSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type TournamentTeamView = z.infer<typeof TournamentTeamViewSchema>;

export const TournamentPrizeViewSchema = TournamentPrizeSchema.extend({
  /** Etiqueta legible del cosmético, cuando aplica. */
  cosmeticName: z.string().nullable(),
}).strict();
export type TournamentPrizeView = z.infer<typeof TournamentPrizeViewSchema>;

export const TournamentSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    format: TournamentFormatSchema,
    visibility: TournamentVisibilitySchema,
    status: TournamentStatusSchema,
    mode: TournamentModeSchema,
    rulesetCode: RulesetCodeSchema,
    targetScore: z.number().int(),
    /** El torneo define sus reglas: puntos, flor y reloj no los hereda del lobby. */
    florEnabled: z.boolean(),
    turnTimeoutMs: z.number().int(),
    capacity: z.number().int(),
    registeredCount: z.number().int(),
    checkedInCount: z.number().int(),
    /** Código de acceso, sólo para torneos privados y sólo para quien puede verlo. */
    joinCode: z.string().nullable(),
    registrationClosesAt: z.string(),
    checkInClosesAt: z.string(),
    startsAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    cancelledReason: z.string().nullable(),
    createdByNickname: z.string(),
    isParticipant: z.boolean(),
    isOrganizer: z.boolean(),
    prizes: z.array(TournamentPrizeViewSchema),
  })
  .strict();
export type TournamentSummary = z.infer<typeof TournamentSummarySchema>;

/** Filtros del listado, compartidos por el jugador y el panel. */
export const TournamentListQuerySchema = z
  .object({
    status: z
      .union([TournamentStatusSchema, z.array(TournamentStatusSchema)])
      .optional()
      .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value])),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    cursor: z.string().max(200).optional().nullable().default(null),
  })
  .strict();
export type TournamentListQuery = z.infer<typeof TournamentListQuerySchema>;

export const TournamentListResponseSchema = z
  .object({
    items: z.array(TournamentSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type TournamentListResponse = z.infer<typeof TournamentListResponseSchema>;

export const TournamentParticipantViewSchema = z
  .object({
    userId: z.string().uuid(),
    nickname: z.string(),
    seed: z.number().int().nullable(),
    status: TournamentParticipantStatusSchema,
    registeredAt: z.string(),
    checkedInAt: z.string().nullable(),
    /** Sólo visible para organizadores y para el propio jugador. */
    rating: z.number().int().nullable(),
  })
  .strict();
export type TournamentParticipantView = z.infer<typeof TournamentParticipantViewSchema>;

export const TournamentMatchStatusSchema = z.enum([
  'SCHEDULED',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
  'FORFEITED',
]);
export type TournamentMatchStatus = z.infer<typeof TournamentMatchStatusSchema>;

export const TournamentMatchViewSchema = z
  .object({
    id: z.string().uuid(),
    round: z.number().int(),
    slot: z.number().int(),
    bracket: z.enum(['WINNERS', 'LOSERS', 'GRAND_FINAL']),
    status: TournamentMatchStatusSchema,
    homeNickname: z.string().nullable(),
    awayNickname: z.string().nullable(),
    homeUserId: z.string().uuid().nullable(),
    awayUserId: z.string().uuid().nullable(),
    winnerUserId: z.string().uuid().nullable(),
    /**
     * Equipos que ocupan cada lado y el ganador, en torneos 2v2. En 1v1 son `null` y
     * mandan los ids de usuario.
     */
    homeTeamId: z.string().uuid().nullable(),
    awayTeamId: z.string().uuid().nullable(),
    winnerTeamId: z.string().uuid().nullable(),
    /** Sala de juego creada por el aprovisionamiento existente. */
    roomId: z.string().uuid().nullable(),
    /** Reloj límite para presentarse; pasado el plazo se define por incomparecencia. */
    deadlineAt: z.string().nullable(),
    forfeitReason: TournamentForfeitReasonSchema.nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
  })
  .strict();
export type TournamentMatchView = z.infer<typeof TournamentMatchViewSchema>;

export const TournamentStandingSchema = z
  .object({
    position: z.number().int(),
    userId: z.string().uuid(),
    nickname: z.string(),
    seed: z.number().int().nullable(),
    eliminationRound: z.number().int().nullable(),
    /** Desempate documentado: ver `docs/RULES.md` § Torneos. */
    tiebreakNote: z.string(),
  })
  .strict();
export type TournamentStanding = z.infer<typeof TournamentStandingSchema>;

export const TournamentDetailResponseSchema = z
  .object({
    tournament: TournamentSummarySchema,
    participants: z.array(TournamentParticipantViewSchema),
    /** Equipos del torneo 2v2; en 1v1 viene vacío. */
    teams: z.array(TournamentTeamViewSchema),
    matches: z.array(TournamentMatchViewSchema),
    standings: z.array(TournamentStandingSchema),
    /** Próxima partida del jugador actual, si tiene una pendiente. */
    myNextMatch: TournamentMatchViewSchema.nullable(),
    /** `true` si el jugador actual puede inscribirse ahora. */
    canRegister: z.boolean(),
    /** `true` si el jugador actual puede hacer check-in ahora. */
    canCheckIn: z.boolean(),
    registrationClosedReason: z.string().nullable(),
  })
  .strict();
export type TournamentDetailResponse = z.infer<typeof TournamentDetailResponseSchema>;

export const RegisterForTournamentResponseSchema = z
  .object({
    participant: TournamentParticipantViewSchema,
    tournament: TournamentSummarySchema,
  })
  .strict();
export type RegisterForTournamentResponse = z.infer<typeof RegisterForTournamentResponseSchema>;

export const TournamentJoinByCodeRequestSchema = z
  .object({ joinCode: z.string().trim().toUpperCase().min(4).max(12) })
  .strict();
export type TournamentJoinByCodeRequest = z.infer<typeof TournamentJoinByCodeRequestSchema>;

/**
 * Acciones administrativas: crear, cancelar, ajustar (avanzar una ronda a mano) y
 * resolver incidencias. Todas exigen motivo y quedan en `audit_logs`.
 */
export const AdminResolveTournamentIncidentRequestSchema = z
  .object({
    matchId: z.string().uuid(),
    /** Quién avanza: un usuario participante del cruce, o `null` para dejarlo sin ganador. */
    winnerUserId: z.string().uuid().nullable(),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export type AdminResolveTournamentIncidentRequest = z.infer<
  typeof AdminResolveTournamentIncidentRequestSchema
>;

/** Creación de staff: el mismo cuerpo del torneo más el motivo de la decisión. */
export const AdminCreateTournamentRequestSchema = CreateTournamentRequestSchema.extend({
  reason: z.string().trim().min(10).max(500),
}).strict();
export type AdminCreateTournamentRequest = z.infer<typeof AdminCreateTournamentRequestSchema>;

export const AdminCancelTournamentRequestSchema = z
  .object({ reason: z.string().trim().min(10).max(500) })
  .strict();
export type AdminCancelTournamentRequest = z.infer<typeof AdminCancelTournamentRequestSchema>;

export const AdminAdvanceTournamentRequestSchema = z
  .object({ reason: z.string().trim().min(10).max(500) })
  .strict();
export type AdminAdvanceTournamentRequest = z.infer<typeof AdminAdvanceTournamentRequestSchema>;
