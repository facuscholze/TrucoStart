import { Inject, Injectable } from '@nestjs/common';
import type { RuleSet } from '@truco/engine';
import type { GameMode, ListTablesQuery, RulesetCode, TableVisibility } from '@truco/shared';
import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { DomainApiException } from '../../common/api-exception.js';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { type AppDatabase, DRIZZLE_DB } from '../../db/database.provider.js';
import { rulesetsTable, tableSeatsTable, tablesTable } from '../../db/schema/index.js';
import { generateJoinCode } from './join-code.js';
import { maxSeatsForMode, type TableAggregate, type TableRow } from './lobby-row-mapper.js';

export interface InitialSeatParticipant {
  readonly userId: string;
  readonly nickname: string;
  readonly seat: number;
  readonly team: number;
}

export type LeaveTableOutcome =
  | {
      readonly kind: 'LEFT';
      readonly aggregate: TableAggregate;
      readonly newOwnerNickname: string;
    }
  | { readonly kind: 'CLOSED'; readonly tableId: string; readonly visibility: TableVisibility };

function isPgUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { code?: unknown; cause?: { code?: unknown } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}

@Injectable()
export class LobbyRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  async ensureRulesetRow(
    ruleset: RuleSet,
  ): Promise<{ readonly id: string; readonly code: string }> {
    await this.db
      .insert(rulesetsTable)
      .values({
        id: generateUuidV7(),
        code: ruleset.code,
        version: ruleset.version,
        config: ruleset as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: rulesetsTable.code });

    const rows = await this.db
      .select({ id: rulesetsTable.id, code: rulesetsTable.code })
      .from(rulesetsTable)
      .where(eq(rulesetsTable.code, ruleset.code))
      .limit(1);

    if (!rows[0]) {
      throw new Error(`No se pudo resolver el ruleset '${ruleset.code}' en PostgreSQL.`);
    }
    return rows[0];
  }

  async findActiveSeatForUser(userId: string): Promise<{
    readonly tableId: string;
    readonly seat: number;
    readonly team: number;
  } | null> {
    const rows = await this.db
      .select({
        tableId: tableSeatsTable.tableId,
        seat: tableSeatsTable.seat,
        team: tableSeatsTable.team,
      })
      .from(tableSeatsTable)
      .where(and(eq(tableSeatsTable.userId, userId), eq(tableSeatsTable.isActive, true)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createTableWithSeatsTx(input: {
    readonly tableId: string;
    readonly ownerId: string;
    readonly mode: GameMode;
    readonly visibility: TableVisibility;
    readonly rulesetId: string;
    readonly rulesetCode: RulesetCode;
    readonly targetScore: 15 | 30;
    readonly florEnabled: boolean;
    readonly turnTimeoutMs: number;
    readonly now: Date;
    readonly expiresAt: Date;
    readonly participants: readonly InitialSeatParticipant[];
  }): Promise<TableAggregate> {
    return this.db.transaction(async (tx) => {
      const participantIds = input.participants.map((p) => p.userId);
      const existingActive = await tx
        .select({ userId: tableSeatsTable.userId, tableId: tableSeatsTable.tableId })
        .from(tableSeatsTable)
        .where(
          and(inArray(tableSeatsTable.userId, participantIds), eq(tableSeatsTable.isActive, true)),
        )
        .limit(1);

      if (existingActive[0]) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'Ya participás de una mesa o partida activa. Finalizala o salí antes de abrir otra.',
          { reason: 'ALREADY_IN_ACTIVE_TABLE', activeTableId: existingActive[0].tableId },
        );
      }

      let insertedRow: TableRow | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const joinCode = generateJoinCode();
        const existingCode = await tx
          .select({ id: tablesTable.id })
          .from(tablesTable)
          .where(eq(tablesTable.joinCode, joinCode))
          .limit(1);
        if (existingCode[0]) continue;

        const inserted = await tx
          .insert(tablesTable)
          .values({
            id: input.tableId,
            ownerId: input.ownerId,
            mode: input.mode,
            rulesetId: input.rulesetId,
            rulesetCode: input.rulesetCode,
            targetScore: input.targetScore,
            florEnabled: input.florEnabled,
            turnTimeoutMs: input.turnTimeoutMs,
            visibility: input.visibility,
            joinCode,
            status: 'WAITING',
            expiresAt: input.expiresAt,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning();
        insertedRow = inserted[0]!;
        break;
      }

      if (!insertedRow) {
        throw new Error('No fue posible asignar un joinCode único tras múltiples intentos.');
      }

      try {
        const seatValues = input.participants.map((p) => ({
          tableId: input.tableId,
          seat: p.seat,
          team: p.team,
          userId: p.userId,
          nickname: p.nickname,
          isActive: true,
          joinedAt: input.now,
        }));
        const seats = await tx.insert(tableSeatsTable).values(seatValues).returning();
        return { row: insertedRow, activeSeats: seats };
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          throw new DomainApiException(
            409,
            'CONFLICT',
            'Ya participás de una mesa o partida activa.',
            { reason: 'ALREADY_IN_ACTIVE_TABLE' },
          );
        }
        throw err;
      }
    });
  }

  async rollbackCreatedTable(tableId: string): Promise<void> {
    await this.db.delete(tablesTable).where(eq(tablesTable.id, tableId));
  }

  async getTableWithSeats(tableId: string): Promise<TableAggregate | null> {
    const rows = await this.db
      .select()
      .from(tablesTable)
      .where(eq(tablesTable.id, tableId))
      .limit(1);
    if (!rows[0]) return null;

    const seats = await this.db
      .select()
      .from(tableSeatsTable)
      .where(and(eq(tableSeatsTable.tableId, tableId), eq(tableSeatsTable.isActive, true)))
      .orderBy(asc(tableSeatsTable.seat));

    return { row: rows[0], activeSeats: seats };
  }

  async findTableIdByJoinCode(normalizedCode: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: tablesTable.id })
      .from(tablesTable)
      .where(eq(tablesTable.joinCode, normalizedCode))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async listPublicTables(query: ListTablesQuery): Promise<TableAggregate[]> {
    const conditions = [eq(tablesTable.visibility, 'PUBLIC')];

    if (query.status) {
      conditions.push(eq(tablesTable.status, query.status));
    } else {
      conditions.push(inArray(tablesTable.status, ['WAITING', 'IN_GAME']));
    }
    if (query.mode) {
      conditions.push(eq(tablesTable.mode, query.mode));
    }
    if (query.targetScore !== undefined) {
      conditions.push(eq(tablesTable.targetScore, query.targetScore));
    }
    if (query.flor !== undefined) {
      conditions.push(eq(tablesTable.florEnabled, query.flor));
    }
    if (query.rulesetCode) {
      conditions.push(eq(tablesTable.rulesetCode, query.rulesetCode));
    }

    const tableRows = await this.db
      .select()
      .from(tablesTable)
      .where(and(...conditions))
      .orderBy(desc(tablesTable.createdAt))
      .limit(query.limit);

    if (tableRows.length === 0) return [];

    const ids = tableRows.map((r) => r.id);
    const allSeats = await this.db
      .select()
      .from(tableSeatsTable)
      .where(and(inArray(tableSeatsTable.tableId, ids), eq(tableSeatsTable.isActive, true)))
      .orderBy(asc(tableSeatsTable.seat));

    const seatsByTable = new Map<string, (typeof allSeats)[number][]>();
    for (const s of allSeats) {
      const arr = seatsByTable.get(s.tableId) ?? [];
      arr.push(s);
      seatsByTable.set(s.tableId, arr);
    }

    return tableRows.map((row) => ({
      row,
      activeSeats: seatsByTable.get(row.id) ?? [],
    }));
  }

  async joinTableAtomicallyTx(input: {
    readonly tableId: string;
    readonly userId: string;
    readonly nickname: string;
    readonly preferredSeat?: number | undefined;
    readonly now: Date;
    readonly tableTtlMs: number;
    readonly requirePublicVisibility: boolean;
  }): Promise<TableAggregate> {
    return this.db.transaction(async (tx) => {
      // Bloqueo pesimista sobre la fila de la mesa para serializar ingresos concurrentes al último asiento
      const locked = await tx
        .select()
        .from(tablesTable)
        .where(eq(tablesTable.id, input.tableId))
        .for('update');

      const tableRow = locked[0];
      if (!tableRow) {
        throw new DomainApiException(404, 'NOT_FOUND', 'La mesa solicitada no existe.', {
          reason: 'TABLE_NOT_FOUND',
        });
      }

      if (tableRow.status === 'WAITING' && tableRow.expiresAt.getTime() <= input.now.getTime()) {
        await tx
          .update(tablesTable)
          .set({ status: 'EXPIRED', closedReason: 'TTL_EXPIRED', updatedAt: input.now })
          .where(eq(tablesTable.id, tableRow.id));
        await tx
          .update(tableSeatsTable)
          .set({ isActive: false })
          .where(eq(tableSeatsTable.tableId, tableRow.id));
        throw new DomainApiException(
          410,
          'INVALID_STATE',
          'Esta mesa expiró por inactividad antes de que pudieras unirte.',
          { reason: 'TABLE_EXPIRED' },
        );
      }

      if (tableRow.status === 'IN_GAME') {
        throw new DomainApiException(
          409,
          'INVALID_STATE',
          'La partida en esta mesa ya está en curso.',
          { reason: 'TABLE_ALREADY_STARTED' },
        );
      }
      if (tableRow.status !== 'WAITING') {
        throw new DomainApiException(
          409,
          'INVALID_STATE',
          'Esta mesa ya fue cerrada o finalizada.',
          { reason: 'TABLE_CLOSED' },
        );
      }

      const activeSeats = await tx
        .select()
        .from(tableSeatsTable)
        .where(and(eq(tableSeatsTable.tableId, tableRow.id), eq(tableSeatsTable.isActive, true)))
        .orderBy(asc(tableSeatsTable.seat));

      if (activeSeats.some((s) => s.userId === input.userId)) {
        return { row: tableRow, activeSeats };
      }

      if (input.requirePublicVisibility && tableRow.visibility !== 'PUBLIC') {
        throw new DomainApiException(
          403,
          'FORBIDDEN',
          'Las mesas privadas requieren código o enlace de invitación firmado.',
          { reason: 'PRIVATE_TABLE_REQUIRES_INVITE' },
        );
      }

      const otherSeat = await tx
        .select({ tableId: tableSeatsTable.tableId })
        .from(tableSeatsTable)
        .where(and(eq(tableSeatsTable.userId, input.userId), eq(tableSeatsTable.isActive, true)))
        .limit(1);

      if (otherSeat[0]) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'Ya participás de otra mesa o partida activa.',
          { reason: 'ALREADY_IN_ACTIVE_TABLE', activeTableId: otherSeat[0].tableId },
        );
      }

      const maxSeats = maxSeatsForMode(tableRow.mode);
      if (activeSeats.length >= maxSeats) {
        throw new DomainApiException(
          409,
          'ROOM_FULL',
          'La mesa acaba de completarse; no quedan asientos libres.',
          { reason: 'TABLE_FULL' },
        );
      }

      const occupiedSet = new Set(activeSeats.map((s) => s.seat));
      let nextSeat = -1;
      if (
        input.preferredSeat !== undefined &&
        input.preferredSeat >= 0 &&
        input.preferredSeat < maxSeats &&
        !occupiedSet.has(input.preferredSeat)
      ) {
        nextSeat = input.preferredSeat;
      } else {
        nextSeat = 0;
        while (occupiedSet.has(nextSeat) && nextSeat < maxSeats) {
          nextSeat += 1;
        }
      }

      try {
        const insertedSeat = await tx
          .insert(tableSeatsTable)
          .values({
            tableId: tableRow.id,
            seat: nextSeat,
            team: nextSeat % 2,
            userId: input.userId,
            nickname: input.nickname,
            isActive: true,
            joinedAt: input.now,
          })
          .returning();

        const nextExpiresAt = new Date(input.now.getTime() + input.tableTtlMs);
        const updatedTable = await tx
          .update(tablesTable)
          .set({ updatedAt: input.now, expiresAt: nextExpiresAt })
          .where(eq(tablesTable.id, tableRow.id))
          .returning();

        return {
          row: updatedTable[0]!,
          activeSeats: [...activeSeats, insertedSeat[0]!].sort((a, b) => a.seat - b.seat),
        };
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          throw new DomainApiException(
            409,
            'CONFLICT',
            'Ya participás de una mesa o partida activa.',
            { reason: 'ALREADY_IN_ACTIVE_TABLE' },
          );
        }
        throw err;
      }
    });
  }

  async leaveTableDeterministicallyTx(input: {
    readonly tableId: string;
    readonly userId: string;
    readonly now: Date;
  }): Promise<LeaveTableOutcome> {
    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(tablesTable)
        .where(eq(tablesTable.id, input.tableId))
        .for('update');
      const tableRow = locked[0];
      if (!tableRow) {
        throw new DomainApiException(404, 'NOT_FOUND', 'La mesa solicitada no existe.', {
          reason: 'TABLE_NOT_FOUND',
        });
      }
      if (tableRow.status === 'IN_GAME') {
        throw new DomainApiException(
          409,
          'INVALID_STATE',
          'No podés salir por lobby de una partida ya iniciada.',
          { reason: 'TABLE_ALREADY_STARTED' },
        );
      }
      if (tableRow.status !== 'WAITING') {
        throw new DomainApiException(409, 'INVALID_STATE', 'La mesa ya está cerrada.', {
          reason: 'TABLE_CLOSED',
        });
      }

      const activeSeats = await tx
        .select()
        .from(tableSeatsTable)
        .where(and(eq(tableSeatsTable.tableId, tableRow.id), eq(tableSeatsTable.isActive, true)))
        .orderBy(asc(tableSeatsTable.joinedAt), asc(tableSeatsTable.seat));

      const leavingSeat = activeSeats.find((s) => s.userId === input.userId);
      if (!leavingSeat) {
        throw new DomainApiException(403, 'FORBIDDEN', 'No estás sentado en esta mesa.');
      }

      await tx
        .delete(tableSeatsTable)
        .where(
          and(eq(tableSeatsTable.tableId, tableRow.id), eq(tableSeatsTable.userId, input.userId)),
        );

      const remaining = activeSeats.filter((s) => s.userId !== input.userId);
      if (remaining.length === 0) {
        await tx
          .update(tablesTable)
          .set({ status: 'CLOSED', closedReason: 'OWNER_LEFT_EMPTY', updatedAt: input.now })
          .where(eq(tablesTable.id, tableRow.id));
        return {
          kind: 'CLOSED',
          tableId: tableRow.id,
          visibility: tableRow.visibility as TableVisibility,
        };
      }

      const nextOwner =
        tableRow.ownerId === input.userId
          ? remaining[0]!
          : (remaining.find((s) => s.userId === tableRow.ownerId) ?? remaining[0]!);

      const updated = await tx
        .update(tablesTable)
        .set({ ownerId: nextOwner.userId, updatedAt: input.now })
        .where(eq(tablesTable.id, tableRow.id))
        .returning();

      return {
        kind: 'LEFT',
        aggregate: {
          row: updated[0]!,
          activeSeats: remaining.slice().sort((a, b) => a.seat - b.seat),
        },
        newOwnerNickname: nextOwner.nickname,
      };
    });
  }

  async deleteTableByOwnerTx(input: {
    readonly tableId: string;
    readonly requesterUserId: string;
    readonly now: Date;
  }): Promise<{ readonly id: string; readonly visibility: TableVisibility }> {
    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(tablesTable)
        .where(eq(tablesTable.id, input.tableId))
        .for('update');
      const tableRow = locked[0];
      if (!tableRow) {
        throw new DomainApiException(404, 'NOT_FOUND', 'La mesa solicitada no existe.', {
          reason: 'TABLE_NOT_FOUND',
        });
      }
      if (tableRow.ownerId !== input.requesterUserId) {
        throw new DomainApiException(
          403,
          'FORBIDDEN',
          'Solo la persona dueña de la mesa puede cerrarla.',
          { reason: 'NOT_TABLE_OWNER' },
        );
      }
      if (tableRow.status === 'IN_GAME') {
        throw new DomainApiException(
          409,
          'INVALID_STATE',
          'No se puede eliminar una mesa cuya partida ya comenzó.',
          { reason: 'TABLE_ALREADY_STARTED' },
        );
      }
      if (tableRow.status !== 'WAITING') {
        throw new DomainApiException(
          409,
          'INVALID_STATE',
          'La mesa ya fue cerrada anteriormente.',
          { reason: 'TABLE_CLOSED' },
        );
      }

      await tx
        .update(tablesTable)
        .set({ status: 'CLOSED', closedReason: 'OWNER_DELETED', updatedAt: input.now })
        .where(eq(tablesTable.id, tableRow.id));

      await tx
        .update(tableSeatsTable)
        .set({ isActive: false })
        .where(eq(tableSeatsTable.tableId, tableRow.id));

      return { id: tableRow.id, visibility: tableRow.visibility as TableVisibility };
    });
  }

  async expireStaleTablesTx(input: {
    readonly now: Date;
    readonly zombieInProgressBefore: Date;
  }): Promise<Array<{ readonly id: string; readonly visibility: TableVisibility }>> {
    return this.db.transaction(async (tx) => {
      const staleRows = await tx
        .select({
          id: tablesTable.id,
          visibility: tablesTable.visibility,
          status: tablesTable.status,
        })
        .from(tablesTable)
        .where(
          or(
            and(eq(tablesTable.status, 'WAITING'), lte(tablesTable.expiresAt, input.now)),
            and(
              eq(tablesTable.status, 'IN_GAME'),
              lte(tablesTable.updatedAt, input.zombieInProgressBefore),
            ),
          ),
        )
        .for('update');

      if (staleRows.length === 0) return [];

      const staleIds = staleRows.map((r) => r.id);
      await tx
        .update(tablesTable)
        .set({
          status: 'EXPIRED',
          closedReason: sql`CASE WHEN ${tablesTable.status} = 'WAITING' THEN 'TTL_EXPIRED' ELSE 'ABANDONED' END`,
          updatedAt: input.now,
        })
        .where(inArray(tablesTable.id, staleIds));

      await tx
        .update(tableSeatsTable)
        .set({ isActive: false })
        .where(inArray(tableSeatsTable.tableId, staleIds));

      return staleRows.map((r) => ({
        id: r.id,
        visibility: r.visibility as TableVisibility,
      }));
    });
  }
}
