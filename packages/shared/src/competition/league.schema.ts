import { z } from 'zod';
import { RulesetCodeSchema } from '../ws/client-events.schema.js';
import { CompetitiveModeSchema } from '../lobby/game-mode.js';

/**
 * Contratos de ligas por temporada (M10b, entrega 2), compartidos por API, web y admin.
 *
 * Invariantes de producto (regla 13):
 * - Una liga **nunca** tiene inscripción con costo: no existe campo de precio, entrada ni pago.
 * - Los premios son cosméticos o monedas virtuales por el libro mayor existente
 *   (`VIRTUAL_COIN`, sin valor económico, sin transferencias entre jugadores).
 * - Sólo `1v1` y `2v2`. El truco de 6 es social por el ADR-033 y no tiene ligas.
 */

/**
 * Modos que disputa una liga. Reutiliza `CompetitiveModeSchema` en vez de declarar otro enum:
 * una liga es una competencia por puntaje, y la fuente única de qué modos son competitivos ya
 * está en `@truco/shared`. Si mañana el 3v3 deja de ser social, la liga lo hereda sin cambios.
 */
export const LeagueModeSchema = CompetitiveModeSchema;
export type LeagueMode = z.infer<typeof LeagueModeSchema>;

/** Divisiones: de la más baja a la más alta. La escalera es lo que hace posibles ascensos. */
export const LEAGUE_DIVISIONS = ['BRONCE', 'PLATA', 'ORO', 'PLATINO'] as const;
export const LeagueDivisionSchema = z.enum(LEAGUE_DIVISIONS);
export type LeagueDivision = z.infer<typeof LeagueDivisionSchema>;

/** Índice de la división en la escalera: 0 = BRONCE. Sirve para ascender y descender. */
export function leagueDivisionRank(division: LeagueDivision): number {
  return LEAGUE_DIVISIONS.indexOf(division);
}

/** La división que sigue arriba, o `null` si ya es la más alta. */
export function nextLeagueDivision(division: LeagueDivision): LeagueDivision | null {
  return LEAGUE_DIVISIONS[leagueDivisionRank(division) + 1] ?? null;
}

/** La división que sigue abajo, o `null` si ya es la más baja. */
export function previousLeagueDivision(division: LeagueDivision): LeagueDivision | null {
  const rank = leagueDivisionRank(division);
  return rank <= 0 ? null : (LEAGUE_DIVISIONS[rank - 1] ?? null);
}

/**
 * Estado de una liga. `REGISTRATION` admite inscripciones; `ACTIVE` ya tiene calendario y se
 * juega; `CLOSING` es el cierre de temporada en curso (puede reintentarse); `FINISHED` es
 * terminal y sus ascensos ya están aplicados.
 */
export const LeagueStatusSchema = z.enum([
  'DRAFT',
  'REGISTRATION',
  'ACTIVE',
  'CLOSING',
  'FINISHED',
  'CANCELLED',
]);
export type LeagueStatus = z.infer<typeof LeagueStatusSchema>;

export const LEAGUE_STATUS_TRANSITIONS: Readonly<Record<LeagueStatus, readonly LeagueStatus[]>> = {
  DRAFT: ['REGISTRATION', 'CANCELLED'],
  REGISTRATION: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['CLOSING', 'CANCELLED'],
  // `CLOSING` es el único estado que puede volver a `ACTIVE`: si un cierre falla a mitad,
  // se revierte la transacción y la liga vuelve a estar en juego para reintentar.
  CLOSING: ['FINISHED', 'ACTIVE'],
  FINISHED: [],
  CANCELLED: [],
};

export function canTransitionLeague(from: LeagueStatus, to: LeagueStatus): boolean {
  return LEAGUE_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Formato del calendario.
 *
 * - `ROUNDS`: jornadas numeradas. Cada jornada es una ventana con día y hora de inicio y un
 *   plazo para jugar cada partida. Es el formato clásico de liga de club.
 * - `WINDOW`: una sola ventana larga donde cada jugador concierta sus partidas dentro del
 *   plazo. Sirve para ligas de fin de semana o de comunidad.
 */
export const LeagueScheduleFormatSchema = z.enum(['ROUNDS', 'WINDOW']);
export type LeagueScheduleFormat = z.infer<typeof LeagueScheduleFormatSchema>;

/** Estado de una jornada. `OPEN` es la que se está jugando. */
export const LeagueRoundStatusSchema = z.enum(['SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED']);
export type LeagueRoundStatus = z.infer<typeof LeagueRoundStatusSchema>;

/** Estado de una partida de liga, con el mismo vocabulario que los cruces de torneo. */
export const LeagueMatchStatusSchema = z.enum([
  'SCHEDULED',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
  'FORFEITED',
  'VOID',
]);
export type LeagueMatchStatus = z.infer<typeof LeagueMatchStatusSchema>;

/**
 * Motivo por el que una partida de liga se define sin jugarse.
 *
 * - `NO_SHOW`: uno de los dos no se presentó dentro del plazo; gana el otro.
 * - `DOUBLE_NO_SHOW`: ninguno se presentó; **nadie suma** (ADR-035). No se inventa un ganador
 *   porque eso premiaría el abandono del que se quedó, y un doble cero es lo único que no
 *   distorsiona la tabla.
 * - `ABANDON`: uno empezó y se fue; gana el otro.
 * - `RESCHEDULED_EXPIRED`: la reprogramación venció sin jugarse; se resuelve como `NO_SHOW`.
 * - `DISQUALIFIED`: sanción de moderación; gana el otro.
 */
export const LeagueForfeitReasonSchema = z.enum([
  'NO_SHOW',
  'DOUBLE_NO_SHOW',
  'ABANDON',
  'RESCHEDULED_EXPIRED',
  'DISQUALIFIED',
]);
export type LeagueForfeitReason = z.infer<typeof LeagueForfeitReasonSchema>;

/**
 * Puntos de la tabla. Son constantes del producto y se documentan en el ADR-035: una victoria
 * vale 3, un empate no existe (el truco no empata) y una partida perdida vale 0. Lo que sí
 * distingue a una liga es **quién suma un doble ausente**: nadie.
 */
export const LEAGUE_POINTS = Object.freeze({ WIN: 3, LOSS: 0, VOID: 0 } as const);

/**
 * Desempates de la tabla, **en orden**. El orden importa: es normativo y está en el ADR-035.
 *
 * 1. `POINTS`: puntos de liga (3 por victoria).
 * 2. `HEAD_TO_HEAD`: resultado entre los jugadores empatados (sólo si jugaron entre sí).
 * 3. `WINS`: partidas ganadas.
 * 4. `SCORE_DIFFERENCE`: diferencia de puntos de truco a favor menos en contra.
 * 5. `SCORE_FOR`: puntos de truco a favor.
 * 6. `FEWER_NO_SHOWS`: menos ausencias propias. Quien no se presentó no queda arriba de quien sí.
 * 7. `SEED`: número de inscripción (el primero anotado queda arriba). Último recurso
 *    determinista: dos tablas iguales no pueden ordenarse distinto entre dos consultas.
 */
export const LEAGUE_TIEBREAKERS = [
  'POINTS',
  'HEAD_TO_HEAD',
  'WINS',
  'SCORE_DIFFERENCE',
  'SCORE_FOR',
  'FEWER_NO_SHOWS',
  'SEED',
] as const;
export const LeagueTiebreakerSchema = z.enum(LEAGUE_TIEBREAKERS);
export type LeagueTiebreaker = z.infer<typeof LeagueTiebreakerSchema>;

/**
 * Reglas de ascenso y descenso por división (ADR-035).
 *
 * `promotions` sube a los primeros N de la tabla; `relegations` baja a los últimos N. En la
 * división más alta no hay ascenso y en la más baja no hay descenso: la escalera termina.
 * El **empate en el corte** no lo resuelve el azar ni la posición arbitraria: se documenta
 * como `TIE_AT_CUT` y la decisión es que **suben los dos** (nunca se asciende a uno y se deja
 * afuera al otro por un desempate que la tabla no resuelve) y **bajan los dos** en el corte
 * de descenso. Ver `docs/RULES.md` §14 y el ADR-035.
 */
export const LeaguePromotionRulesSchema = z
  .object({
    /** Ascensos por división y temporada. 0 en la división más alta. */
    promotions: z.number().int().min(0).max(10),
    /** Descensos por división y temporada. 0 en la división más baja. */
    relegations: z.number().int().min(0).max(10),
    /**
     * Mínimo de partidas jugadas para poder ascender o descender. Un jugador inactivo no
     * asciende por haber quedado arriba en una tabla corta ni desciende por no jugar.
     */
    minMatchesToMove: z.number().int().min(1).max(50),
  })
  .strict();
export type LeaguePromotionRules = z.infer<typeof LeaguePromotionRulesSchema>;

/**
 * Reglas del calendario y de los plazos, configurables por liga.
 *
 * Todos los plazos se guardan como instantes absolutos al crear la liga, igual que las
 * ventanas de torneo: mover un plazo no reescribe el pasado.
 */
export const LeagueScheduleRulesSchema = z
  .object({
    format: LeagueScheduleFormatSchema,
    /** Jornadas (sólo `ROUNDS`). */
    rounds: z.number().int().min(1).max(30).default(1),
    /** Días entre el inicio de una jornada y la siguiente. */
    daysBetweenRounds: z.number().int().min(1).max(30).default(7),
    /** Horas que dura la ventana de cada jornada para jugar sus partidas. */
    roundWindowHours: z.number().int().min(1).max(336).default(72),
    /**
     * Cuántas veces se puede pedir reprogramar una partida, y con cuánta anticipación como
     * mínimo. El límite existe para que reprogramar no sea una forma de estirar el plazo
     * indefinidamente ni de esquivar a un rival concreto.
     */
    maxReschedulesPerMatch: z.number().int().min(0).max(5).default(2),
    rescheduleMinHoursBeforeDeadline: z.number().int().min(1).max(168).default(12),
    /** Horas extra que gana una partida reprogramada. Nunca más que el plazo original. */
    rescheduleExtensionHours: z.number().int().min(1).max(336).default(48),
  })
  .strict();
export type LeagueScheduleRules = z.infer<typeof LeagueScheduleRulesSchema>;

/** Reglas de juego de cada partida de liga: las mismas que un torneo. */
export const LeagueGameRulesSchema = z
  .object({
    rulesetCode: RulesetCodeSchema,
    targetScore: z.number().int().min(15).max(30),
    florEnabled: z.boolean(),
    turnTimeoutMs: z.number().int().min(10_000).max(60_000),
  })
  .strict();
export type LeagueGameRules = z.infer<typeof LeagueGameRulesSchema>;

export const LEAGUE_MIN_CAPACITY = 2;
export const LEAGUE_MAX_CAPACITY = 200;

export const LeaguePrizeSchema = z
  .object({
    /** Posición de la tabla que recibe el premio. */
    position: z.number().int().min(1).max(200),
    coins: z.number().int().min(0).max(50_000).default(0),
    cosmeticId: z.string().min(1).max(64).nullable().default(null),
  })
  .strict()
  .refine((prize) => prize.coins > 0 || prize.cosmeticId !== null, {
    message: 'Un premio debe tener monedas o un cosmético',
  });
export type LeaguePrize = z.infer<typeof LeaguePrizeSchema>;

export const LeagueSeasonSchema = z
  .object({
    /** Etiqueta de la temporada, por ejemplo «Temporada 2027-1». */
    label: z.string().trim().min(3).max(60),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .strict()
  .refine((season) => new Date(season.endsAt) > new Date(season.startsAt), {
    message: 'La temporada tiene que terminar después de empezar',
  })
  .refine(
    (season) =>
      new Date(season.endsAt).getTime() - new Date(season.startsAt).getTime() <=
      366 * 24 * 60 * 60 * 1000,
    { message: 'Una temporada de liga no puede durar más de un año' },
  );
export type LeagueSeason = z.infer<typeof LeagueSeasonSchema>;

export const CreateLeagueRequestSchema = z
  .object({
    name: z.string().trim().min(3).max(60),
    mode: LeagueModeSchema,
    /** División de la liga: cada división es una liga aparte con su tabla. */
    division: LeagueDivisionSchema,
    season: LeagueSeasonSchema,
    rules: LeagueGameRulesSchema,
    schedule: LeagueScheduleRulesSchema,
    promotion: LeaguePromotionRulesSchema,
    capacity: z.number().int().min(LEAGUE_MIN_CAPACITY).max(LEAGUE_MAX_CAPACITY),
    /** Ventana de inscripción, en minutos desde la creación. */
    registrationMinutes: z.number().int().min(1).max(10_080),
    prizes: z.array(LeaguePrizeSchema).max(12).default([]),
    /** Sólo el staff crea ligas oficiales; cualquiera puede crear una privada. */
    official: z.boolean().default(false),
  })
  .strict();
export type CreateLeagueRequest = z.infer<typeof CreateLeagueRequestSchema>;

/** Inscripción. No hay cuerpo con precio: una liga no se paga (regla 13). */
export const LeagueJoinRequestSchema = z.object({}).strict();
export type LeagueJoinRequest = z.infer<typeof LeagueJoinRequestSchema>;

export const LeagueParticipantStatusSchema = z.enum([
  'REGISTERED',
  'ACTIVE',
  'WITHDRAWN',
  'DISQUALIFIED',
  'PROMOTED',
  'RELEGATED',
]);
export type LeagueParticipantStatus = z.infer<typeof LeagueParticipantStatusSchema>;

/** Una fila de la tabla de posiciones, con el desglose de desempate a la vista. */
export const LeagueStandingRowSchema = z
  .object({
    position: z.number().int(),
    userId: z.string().uuid(),
    nickname: z.string(),
    status: LeagueParticipantStatusSchema,
    played: z.number().int(),
    wins: z.number().int(),
    losses: z.number().int(),
    noShows: z.number().int(),
    points: z.number().int(),
    scoreFor: z.number().int(),
    scoreAgainst: z.number().int(),
    scoreDifference: z.number().int(),
    /** `seed` es el número de inscripción: el último desempate determinista. */
    seed: z.number().int(),
    /**
     * Qué desempate decidió su posición respecto de la fila de abajo, cuando hubo empate.
     * `null` cuando la posición no necesitó desempate.
     */
    decidedBy: LeagueTiebreakerSchema.nullable(),
    /** Corte de ascenso o descenso que le toca, si alguno. */
    movement: z.enum(['PROMOTION', 'RELEGATION', 'TIE_AT_CUT', 'NONE']),
    /** Si todavía puede ascender/descender según el mínimo de partidas. */
    eligibleToMove: z.boolean(),
  })
  .strict();
export type LeagueStandingRow = z.infer<typeof LeagueStandingRowSchema>;

export const LeagueRoundViewSchema = z
  .object({
    id: z.string().uuid(),
    number: z.number().int(),
    status: LeagueRoundStatusSchema,
    startsAt: z.string(),
    /** Plazo para jugar las partidas de la jornada. */
    deadlineAt: z.string(),
    closedAt: z.string().nullable(),
  })
  .strict();
export type LeagueRoundView = z.infer<typeof LeagueRoundViewSchema>;

export const LeagueMatchViewSchema = z
  .object({
    id: z.string().uuid(),
    roundNumber: z.number().int().nullable(),
    status: LeagueMatchStatusSchema,
    homeUserId: z.string().uuid().nullable(),
    homeNickname: z.string().nullable(),
    awayUserId: z.string().uuid().nullable(),
    awayNickname: z.string().nullable(),
    /** Puntos de truco de cada lado, cuando la partida se jugó. */
    homeScore: z.number().int().nullable(),
    awayScore: z.number().int().nullable(),
    winnerUserId: z.string().uuid().nullable(),
    forfeitReason: LeagueForfeitReasonSchema.nullable(),
    /** Sala real del aprovisionamiento existente para entrar a jugar. */
    roomId: z.string().uuid().nullable(),
    deadlineAt: z.string().nullable(),
    reschedulesUsed: z.number().int(),
    maxReschedules: z.number().int(),
    canReschedule: z.boolean(),
    isMine: z.boolean(),
  })
  .strict();
export type LeagueMatchView = z.infer<typeof LeagueMatchViewSchema>;

export const LeaguePrizeViewSchema = LeaguePrizeSchema.extend({
  cosmeticName: z.string().nullable(),
}).strict();
export type LeaguePrizeView = z.infer<typeof LeaguePrizeViewSchema>;

export const LeagueSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    mode: LeagueModeSchema,
    division: LeagueDivisionSchema,
    status: LeagueStatusSchema,
    official: z.boolean(),
    seasonLabel: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    rulesetCode: RulesetCodeSchema,
    targetScore: z.number().int(),
    florEnabled: z.boolean(),
    turnTimeoutMs: z.number().int(),
    capacity: z.number().int(),
    participantCount: z.number().int(),
    /** Jornada abierta ahora, si hay alguna. */
    currentRound: z.number().int().nullable(),
    registrationClosesAt: z.string(),
    finishedAt: z.string().nullable(),
    createdByNickname: z.string(),
    isParticipant: z.boolean(),
    isOrganizer: z.boolean(),
    prizes: z.array(LeaguePrizeViewSchema),
  })
  .strict();
export type LeagueSummary = z.infer<typeof LeagueSummarySchema>;

export const LeagueDetailSchema = LeagueSummarySchema.extend({
  promotion: LeaguePromotionRulesSchema,
  schedule: LeagueScheduleRulesSchema,
  standings: z.array(LeagueStandingRowSchema),
  rounds: z.array(LeagueRoundViewSchema),
  /** Sólo las partidas del jugador, o todas si quien mira organiza la liga. */
  matches: z.array(LeagueMatchViewSchema),
  /** «Mi próxima partida de liga»: la más urgente de las que le quedan pendientes. */
  myNextMatch: LeagueMatchViewSchema.nullable(),
  /** Próxima jornada que abre, para el aviso de «jornada abierta». */
  nextRoundStartsAt: z.string().nullable(),
  /** División a la que ascendería y de la que descendería con la tabla actual. */
  myProjectedMovement: z.enum(['PROMOTION', 'RELEGATION', 'TIE_AT_CUT', 'NONE', 'UNKNOWN']),
}).strict();
export type LeagueDetail = z.infer<typeof LeagueDetailSchema>;

export const LeagueListQuerySchema = z
  .object({
    mode: LeagueModeSchema.optional(),
    division: LeagueDivisionSchema.optional(),
    status: z
      .union([LeagueStatusSchema, z.array(LeagueStatusSchema)])
      .optional()
      .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value])),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    cursor: z.string().max(200).optional().nullable().default(null),
  })
  .strict();
export type LeagueListQuery = z.infer<typeof LeagueListQuerySchema>;

export const LeagueListResponseSchema = z
  .object({
    items: z.array(LeagueSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type LeagueListResponse = z.infer<typeof LeagueListResponseSchema>;

/** Reprogramación: el jugador elige la nueva hora dentro de la ventana permitida. */
export const RescheduleLeagueMatchRequestSchema = z
  .object({
    reason: z.string().trim().min(5).max(300),
  })
  .strict();
export type RescheduleLeagueMatchRequest = z.infer<typeof RescheduleLeagueMatchRequestSchema>;

export const RescheduleLeagueMatchResponseSchema = z
  .object({
    matchId: z.string().uuid(),
    deadlineAt: z.string(),
    reschedulesUsed: z.number().int(),
  })
  .strict();
export type RescheduleLeagueMatchResponse = z.infer<typeof RescheduleLeagueMatchResponseSchema>;

/**
 * Identificación de una liga en el panel. `leagueId` se repite dentro del objeto porque el
 * detalle de auditoría se consume solo, sin el listado al lado: el panel tiene que poder pedir
 * el cierre de jornada de esa liga sin adivinar a cuál pertenece.
 */
export const AdminLeagueAuditSchema = z
  .object({
    leagueId: z.string().uuid(),
    status: LeagueStatusSchema,
    currentRound: z
      .object({
        id: z.string().uuid(),
        number: z.number().int().min(1),
        deadlineAt: z.string(),
      })
      .strict()
      .nullable(),
    closure: z
      .object({
        closedAt: z.string(),
        championUserId: z.string().uuid().nullable(),
        promoted: z.array(z.string().uuid()),
        relegated: z.array(z.string().uuid()),
        forfeitedMatches: z.number().int().min(0),
      })
      .strict()
      .nullable(),
    movements: z.array(
      z
        .object({
          userId: z.string().uuid(),
          kind: z.enum(['PROMOTION', 'RELEGATION', 'TIE_AT_CUT', 'NONE']),
          fromDivision: LeagueDivisionSchema,
          toDivision: LeagueDivisionSchema,
          createdAt: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type AdminLeagueAuditResponse = z.infer<typeof AdminLeagueAuditSchema>;

/**
 * Resultado del cierre de temporada. Se devuelve igual en el primer intento y en un reintento:
 * los asientos del libro mayor son idempotentes por liga y posición (ADR-035).
 */
export const LeagueCloseResultSchema = z
  .object({
    leagueId: z.string().uuid(),
    finishedAt: z.string(),
    championUserId: z.string().uuid().nullable(),
    promoted: z.array(z.string().uuid()),
    relegated: z.array(z.string().uuid()),
    /** Premios acreditados en **este** intento; un reintento devuelve la lista vacía. */
    awardedPrizes: z.number().int(),
    /** Partidas que se definieron por ausencia en el cierre. */
    forfeitedMatches: z.number().int(),
  })
  .strict();
export type LeagueCloseResult = z.infer<typeof LeagueCloseResultSchema>;
