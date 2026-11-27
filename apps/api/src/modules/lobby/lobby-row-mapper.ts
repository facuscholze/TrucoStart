import {
  seatsForMode,
  teamForSeat,
  type GameMode,
  type PersistedTableStatus,
  type PublicLobbySeatSummary,
  type PublicLobbyTableSummary,
  type RulesetCode,
  type TableDetailResponse,
  type TableParticipantSeat,
  type TableVisibility,
} from '@truco/shared';
import type { tableSeatsTable, tablesTable } from '../../db/schema/index.js';

export type TableRow = typeof tablesTable.$inferSelect;
export type TableSeatRow = typeof tableSeatsTable.$inferSelect;

export interface TableAggregate {
  readonly row: TableRow;
  readonly activeSeats: readonly TableSeatRow[];
}

/** Asientos por modo, resueltos en `@truco/shared` para no repetir la tabla en cada capa. */
export function maxSeatsForMode(mode: GameMode): number {
  return seatsForMode(mode);
}

function resolveOwnerNickname(agg: TableAggregate): string {
  const ownerSeat = agg.activeSeats.find((s) => s.userId === agg.row.ownerId);
  return ownerSeat?.nickname ?? agg.activeSeats[0]?.nickname ?? 'Anfitrión';
}

export function toPublicTableSummary(agg: TableAggregate): PublicLobbyTableSummary {
  const maxSeats = maxSeatsForMode(agg.row.mode);
  const bySeat = new Map(agg.activeSeats.map((s) => [s.seat, s]));
  const seats: PublicLobbySeatSummary[] = [];
  for (let i = 0; i < maxSeats; i++) {
    const occupied = bySeat.get(i);
    seats.push({
      seat: i,
      team: teamForSeat(agg.row.mode, i),
      occupied: Boolean(occupied),
      nickname: occupied ? occupied.nickname : null,
    });
  }

  const status: 'WAITING' | 'IN_GAME' = agg.row.status === 'IN_GAME' ? 'IN_GAME' : 'WAITING';
  return {
    id: agg.row.id,
    mode: agg.row.mode,
    rulesetCode: agg.row.rulesetCode as RulesetCode,
    targetScore: agg.row.targetScore === 15 ? 15 : 30,
    flor: agg.row.florEnabled,
    turnTimeoutMs: agg.row.turnTimeoutMs,
    status,
    ownerNickname: resolveOwnerNickname(agg),
    occupiedSeats: agg.activeSeats.length,
    maxSeats,
    seats,
    createdAt: agg.row.createdAt.toISOString(),
  };
}

export function toTableDetailResponse(
  agg: TableAggregate,
  options: {
    readonly viewerUserId: string;
    readonly includeJoinCredentials: boolean;
    readonly inviteToken?: string | null;
    readonly inviteExpiresAt?: string | null;
  },
): TableDetailResponse {
  const maxSeats = maxSeatsForMode(agg.row.mode);
  const bySeat = new Map(agg.activeSeats.map((s) => [s.seat, s]));
  const seats: TableParticipantSeat[] = [];
  let mySeat: number | null = null;

  for (let i = 0; i < maxSeats; i++) {
    const occupied = bySeat.get(i);
    if (occupied && occupied.userId === options.viewerUserId) {
      mySeat = i;
    }
    seats.push({
      seat: i,
      team: teamForSeat(agg.row.mode, i),
      occupied: Boolean(occupied),
      nickname: occupied ? occupied.nickname : null,
      isOwner: Boolean(occupied && occupied.userId === agg.row.ownerId),
      isSelf: Boolean(occupied && occupied.userId === options.viewerUserId),
    });
  }

  return {
    id: agg.row.id,
    roomId: agg.row.id,
    mode: agg.row.mode,
    visibility: agg.row.visibility as TableVisibility,
    rulesetCode: agg.row.rulesetCode as RulesetCode,
    targetScore: agg.row.targetScore === 15 ? 15 : 30,
    flor: agg.row.florEnabled,
    turnTimeoutMs: agg.row.turnTimeoutMs,
    status: agg.row.status as PersistedTableStatus,
    ownerNickname: resolveOwnerNickname(agg),
    isOwner: agg.row.ownerId === options.viewerUserId,
    mySeat,
    occupiedSeats: agg.activeSeats.length,
    maxSeats,
    seats,
    joinCode: options.includeJoinCredentials ? agg.row.joinCode : null,
    inviteToken: options.includeJoinCredentials ? (options.inviteToken ?? null) : null,
    inviteExpiresAt: options.includeJoinCredentials ? (options.inviteExpiresAt ?? null) : null,
    isPractice: agg.row.isPractice,
    expiresAt: agg.row.expiresAt.toISOString(),
    createdAt: agg.row.createdAt.toISOString(),
  };
}
