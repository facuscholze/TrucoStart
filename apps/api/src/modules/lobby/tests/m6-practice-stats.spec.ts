import { describe, expect, it, vi } from 'vitest';
import type { MatchCompletedLifecycleEvent, MatchStartedLifecycleEvent } from '@truco/shared';
import type { AppDatabase } from '../../../db/database.provider.js';
import { MatchPersistenceService } from '../match-persistence.service.js';

/**
 * M6: una mesa de práctica (bots) nunca contamina estadísticas ni rankings competitivos.
 * Verificamos que la persistencia de la partida se saltea por completo antes de tocar la base.
 */
function buildService() {
  const dbTransaction = vi.fn(async () => {
    throw new Error('la práctica no debe abrir transacción de persistencia');
  });
  const db = { transaction: dbTransaction } as unknown as AppDatabase;
  const lobbyRepository = {
    findTableById: vi.fn(),
    updateTableStatus: vi.fn(),
    reactivateSeats: vi.fn(),
  };
  const realtimeGateway = { broadcastTableUpsert: vi.fn(), broadcastQueueSnapshot: vi.fn() };
  const provisioner = { provisionPracticeRoom: vi.fn(), provisionRoom: vi.fn() };
  const consumer = { start: vi.fn(), close: vi.fn() };

  const service = new MatchPersistenceService(
    db,
    lobbyRepository as never,
    realtimeGateway as never,
    provisioner as never,
    consumer as never,
    { processMatch: vi.fn() } as never,
  );
  return { service, dbTransaction, lobbyRepository, realtimeGateway, provisioner };
}

const ROOM_ID = '3f7f1e6a-9a1b-4c3d-8e2f-0a1b2c3d4e5f';

const startedEvent: MatchStartedLifecycleEvent = {
  kind: 'match.started',
  practice: true,
  roomId: ROOM_ID,
  matchId: '0f9a1b2c-3d4e-4f50-8a1b-2c3d4e5f6a7b',
  startedAtMs: 1_760_000_000_000,
  seats: [
    { seat: 0, team: 0, userId: 'humano' },
    { seat: 1, team: 1, userId: 'bot:seat:1' },
  ],
};

const completedEvent: MatchCompletedLifecycleEvent = {
  kind: 'match.completed',
  practice: true,
  matchId: '0f9a1b2c-3d4e-4f50-8a1b-2c3d4e5f6a7b',
  roomId: ROOM_ID,
  mode: '1v1',
  rulesetCode: 'AR_STANDARD_V1',
  seedCommitment: 'a'.repeat(64),
  seedReveal: 'b'.repeat(64),
  startedAtMs: 1_760_000_000_000,
  endedAtMs: 1_760_000_600_000,
  winnerTeam: 0,
  scoresByTeam: { '0': 15, '1': 9 },
  reason: 'TARGET_SCORE',
  players: [
    { seat: 0, team: 0, userId: 'humano', cardsPlayed: 6, envidoPoints: 29, trucoAccepted: 1 },
    { seat: 1, team: 1, userId: 'bot:seat:1', cardsPlayed: 6, envidoPoints: 25, trucoAccepted: 1 },
  ],
  events: [
    { seq: 1, type: 'hand.started', payload: { handNumber: 1 } },
    { seq: 2, type: 'match.completed', payload: { winnerTeam: 0 } },
  ],
} as unknown as MatchCompletedLifecycleEvent;

describe('M6 — las mesas de práctica no se persisten como competitivas', () => {
  it('match.started de práctica no toca la base ni el broadcast del lobby', async () => {
    const { service, dbTransaction, realtimeGateway } = buildService();
    await service.handleLifecycleEvent(startedEvent);
    expect(dbTransaction).not.toHaveBeenCalled();
    expect(realtimeGateway.broadcastTableUpsert).not.toHaveBeenCalled();
  });

  it('match.completed de práctica no crea partida, ni eventos, ni estadísticas', async () => {
    const { service, dbTransaction, realtimeGateway } = buildService();
    await service.handleLifecycleEvent(completedEvent);
    expect(dbTransaction).not.toHaveBeenCalled();
    expect(realtimeGateway.broadcastTableUpsert).not.toHaveBeenCalled();
  });
});
