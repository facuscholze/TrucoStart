import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type {
  MatchCompletedLifecycleEvent,
  MatchLifecycleEvent,
  MatchStartedLifecycleEvent,
  TableSeatVacatedLifecycleEvent,
  TableVisibility,
} from '@truco/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { type AppDatabase, DRIZZLE_DB } from '../../db/database.provider.js';
import {
  matchEventsTable,
  matchesTable,
  matchPlayersTable,
  tableSeatsTable,
  tablesTable,
  usersTable,
} from '../../db/schema/index.js';
import { resolveRuleSetByCode } from './lobby.config.js';
import { LobbyRepository } from './lobby.repository.js';
import { LobbyRealtimeGateway } from './lobby-realtime.gateway.js';
import { toPublicTableSummary } from './lobby-row-mapper.js';
import { GAME_ROOM_PROVISIONER, type GameRoomProvisioner } from './ports/game-room-provisioner.js';
import {
  MATCH_LIFECYCLE_CONSUMER,
  type MatchLifecycleConsumer,
} from './ports/match-lifecycle-consumer.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MatchPersistenceService implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: AppDatabase,
    @Inject(LobbyRepository) private readonly lobbyRepository: LobbyRepository,
    @Inject(LobbyRealtimeGateway) private readonly realtimeGateway: LobbyRealtimeGateway,
    @Inject(GAME_ROOM_PROVISIONER) private readonly provisioner: GameRoomProvisioner,
    @Inject(MATCH_LIFECYCLE_CONSUMER) private readonly consumer: MatchLifecycleConsumer,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.consumer.start(async (event) => {
      await this.handleLifecycleEvent(event);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer.close();
  }

  async handleLifecycleEvent(event: MatchLifecycleEvent): Promise<void> {
    if (event.kind === 'match.started') {
      await this.handleMatchStarted(event);
      return;
    }
    if (event.kind === 'table.seatVacated') {
      await this.handleSeatVacated(event);
      return;
    }
    await this.handleMatchCompleted(event);
  }

  private async handleMatchStarted(event: MatchStartedLifecycleEvent): Promise<void> {
    if (!UUID_REGEX.test(event.roomId)) return;
    const now = new Date(event.startedAtMs);

    const updated = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(tablesTable)
        .where(eq(tablesTable.id, event.roomId))
        .for('update');
      const tableRow = locked[0];
      if (!tableRow || tableRow.status !== 'WAITING') return null;

      const nextRows = await tx
        .update(tablesTable)
        .set({ status: 'IN_GAME', updatedAt: now })
        .where(eq(tablesTable.id, tableRow.id))
        .returning();

      const activeSeats = await tx
        .select()
        .from(tableSeatsTable)
        .where(and(eq(tableSeatsTable.tableId, tableRow.id), eq(tableSeatsTable.isActive, true)))
        .orderBy(asc(tableSeatsTable.seat));

      return { row: nextRows[0]!, activeSeats };
    });

    if (updated) {
      this.realtimeGateway.broadcastTableUpsert(
        updated.row.visibility as TableVisibility,
        toPublicTableSummary(updated),
      );
    }
  }

  private async handleSeatVacated(event: TableSeatVacatedLifecycleEvent): Promise<void> {
    if (!UUID_REGEX.test(event.roomId) || !UUID_REGEX.test(event.userId)) return;
    const now = new Date(event.vacatedAtMs);

    const outcome = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(tablesTable)
        .where(eq(tablesTable.id, event.roomId))
        .for('update');
      const tableRow = locked[0];
      if (!tableRow || tableRow.status !== 'WAITING') return null;

      await tx
        .delete(tableSeatsTable)
        .where(
          and(eq(tableSeatsTable.tableId, tableRow.id), eq(tableSeatsTable.userId, event.userId)),
        );

      const remaining = await tx
        .select()
        .from(tableSeatsTable)
        .where(and(eq(tableSeatsTable.tableId, tableRow.id), eq(tableSeatsTable.isActive, true)))
        .orderBy(asc(tableSeatsTable.joinedAt), asc(tableSeatsTable.seat));

      if (remaining.length === 0) {
        await tx
          .update(tablesTable)
          .set({ status: 'CLOSED', closedReason: 'ABANDONED', updatedAt: now })
          .where(eq(tablesTable.id, tableRow.id));
        return {
          kind: 'CLOSED' as const,
          tableId: tableRow.id,
          visibility: tableRow.visibility as TableVisibility,
        };
      }

      const nextOwnerId =
        tableRow.ownerId === event.userId ? remaining[0]!.userId : tableRow.ownerId;
      const updated = await tx
        .update(tablesTable)
        .set({ ownerId: nextOwnerId, updatedAt: now })
        .where(eq(tablesTable.id, tableRow.id))
        .returning();

      return {
        kind: 'UPDATED' as const,
        aggregate: { row: updated[0]!, activeSeats: remaining },
      };
    });

    if (!outcome) return;
    if (outcome.kind === 'CLOSED') {
      await this.provisioner.deleteRoom(outcome.tableId).catch(() => undefined);
      this.realtimeGateway.broadcastTableRemoved(outcome.tableId, outcome.visibility);
      return;
    }
    this.realtimeGateway.broadcastTableUpsert(
      outcome.aggregate.row.visibility as TableVisibility,
      toPublicTableSummary(outcome.aggregate),
    );
  }

  private async handleMatchCompleted(event: MatchCompletedLifecycleEvent): Promise<void> {
    const isUuidRoom = UUID_REGEX.test(event.roomId);
    const ruleset = resolveRuleSetByCode(event.rulesetCode);
    const rulesetRow = await this.lobbyRepository.ensureRulesetRow(ruleset);

    const committed = await this.db.transaction(async (tx) => {
      // Idempotencia ante reentrega at-least-once de BullMQ sobre matchId
      const existingById = await tx
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(eq(matchesTable.id, event.matchId))
        .limit(1);
      if (existingById[0]) {
        return null;
      }

      let tableId: string | null = null;
      let tableVisibility: TableVisibility | null = null;
      let effectiveRulesetId = rulesetRow.id;

      if (isUuidRoom) {
        const locked = await tx
          .select()
          .from(tablesTable)
          .where(eq(tablesTable.id, event.roomId))
          .for('update');

        if (locked[0]) {
          tableId = locked[0].id;
          tableVisibility = locked[0].visibility as TableVisibility;
          effectiveRulesetId = locked[0].rulesetId;
        }
      }

      const team0Score = Number(event.scoresByTeam['0'] ?? 0);
      const team1Score = Number(event.scoresByTeam['1'] ?? 0);

      await tx.insert(matchesTable).values({
        id: event.matchId,
        tableId,
        mode: event.mode,
        rulesetId: effectiveRulesetId,
        rulesetCode: event.rulesetCode,
        seedCommitment: event.seedCommitment,
        startedAt: new Date(event.startedAtMs),
        endedAt: new Date(event.endedAtMs),
        result: {
          winnerTeam: event.winnerTeam,
          team0Score,
          team1Score,
          scoresByTeam: event.scoresByTeam,
          reason: event.reason,
          seedReveal: event.seedReveal,
        },
      });

      const candidateUserIds = event.players
        .map((p) => p.userId)
        .filter((uid) => UUID_REGEX.test(uid));

      const existingUsers =
        candidateUserIds.length > 0
          ? await tx
              .select({ id: usersTable.id })
              .from(usersTable)
              .where(inArray(usersTable.id, candidateUserIds))
          : [];
      const validUserIds = new Set(existingUsers.map((u) => u.id));

      const playerValues = event.players
        .filter((p) => validUserIds.has(p.userId))
        .map((p) => ({
          matchId: event.matchId,
          seat: p.seat,
          userId: p.userId,
          team: p.team,
          score: p.score,
          outcome: p.outcome,
          ratingDelta: 0,
        }));

      if (playerValues.length > 0) {
        await tx.insert(matchPlayersTable).values(playerValues);
      }

      if (event.events.length > 0) {
        await tx.insert(matchEventsTable).values(
          event.events.map((ev) => ({
            matchId: event.matchId,
            seq: ev.seq,
            type: ev.type,
            payload: ev.payload,
            createdAt: new Date(ev.ts),
          })),
        );
      }

      if (tableId) {
        await tx
          .update(tablesTable)
          .set({
            status: 'FINISHED',
            closedReason: event.reason,
            updatedAt: new Date(event.endedAtMs),
          })
          .where(eq(tablesTable.id, tableId));

        await tx
          .update(tableSeatsTable)
          .set({ isActive: false })
          .where(eq(tableSeatsTable.tableId, tableId));
      }

      return { matchId: event.matchId, tableId, tableVisibility };
    });

    if (committed?.tableId && committed.tableVisibility) {
      await this.provisioner.deleteRoom(committed.tableId).catch(() => undefined);
      this.realtimeGateway.broadcastTableRemoved(committed.tableId, committed.tableVisibility);
    }
  }
}
