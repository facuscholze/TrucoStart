import { describe, expect, it, vi } from 'vitest';
import type { MatchCompletedLifecycleEvent, MatchStartedLifecycleEvent } from '@truco/shared';
import type { AppDatabase } from '../../../db/database.provider.js';
import { MatchPersistenceService } from '../match-persistence.service.js';

/** La práctica conserva su progreso simbólico, pero nunca se procesa como rating competitivo. */
function buildService() {
  const dbTransaction = vi.fn(async () => null);
  const db = { transaction: dbTransaction } as unknown as AppDatabase;
  const lobbyRepository = {
    ensureRulesetRow: vi.fn(async () => ({ id: '00000000-0000-7000-8000-000000000001' })),
    findTableById: vi.fn(),
    updateTableStatus: vi.fn(),
    reactivateSeats: vi.fn(),
  };
  const realtimeGateway = {
    broadcastTableUpsert: vi.fn(),
    broadcastQueueSnapshot: vi.fn(),
    refreshSocialPresence: vi.fn(),
  };
  const provisioner = {
    provisionPracticeRoom: vi.fn(),
    provisionRoom: vi.fn(),
    deleteRoom: vi.fn(),
  };
  const consumer = { start: vi.fn(), close: vi.fn() };
  const ratingsService = { processMatch: vi.fn() };
  const progressionService = { processCompletedMatch: vi.fn() };

  const service = new MatchPersistenceService(
    db,
    lobbyRepository as never,
    realtimeGateway as never,
    provisioner as never,
    consumer as never,
    ratingsService as never,
    progressionService as never,
  );
  return {
    service,
    dbTransaction,
    realtimeGateway,
    ratingsService,
    progressionService,
  };
}

const ROOM_ID = '3f7f1e6a-9a1b-4c3d-8e2f-0a1b2c3d4e5f';
const MATCH_ID = '0f9a1b2c-3d4e-4f50-8a1b-2c3d4e5f6a7b';

const startedEvent: MatchStartedLifecycleEvent = {
  kind: 'match.started',
  practice: true,
  roomId: ROOM_ID,
  matchId: MATCH_ID,
  startedAtMs: 1_760_000_000_000,
  seats: [
    { seat: 0, team: 0, userId: 'humano' },
    { seat: 1, team: 1, userId: 'bot:seat:1' },
  ],
};

const completedEvent: MatchCompletedLifecycleEvent = {
  kind: 'match.completed',
  practice: true,
  hasBots: true,
  matchId: MATCH_ID,
  roomId: ROOM_ID,
  mode: '1v1',
  rulesetCode: 'ar-standard-v1',
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
    { seq: 1, type: 'game.cardPlayed', payload: { handNumber: 1 } },
    { seq: 2, type: 'game.ended', payload: { winnerTeam: 0 } },
  ],
} as unknown as MatchCompletedLifecycleEvent;

describe('M6/M9c — práctica separada del rating y elegible para XP bot reducida', () => {
  it('match.started de práctica no cambia la mesa competitiva', async () => {
    const { service, dbTransaction, realtimeGateway } = buildService();
    await service.handleLifecycleEvent(startedEvent);
    expect(dbTransaction).not.toHaveBeenCalled();
    expect(realtimeGateway.broadcastTableUpsert).not.toHaveBeenCalled();
  });

  it('match.completed conserva el flujo de progresión, sin calcular rating', async () => {
    const { service, dbTransaction, realtimeGateway, ratingsService, progressionService } =
      buildService();
    await service.handleLifecycleEvent(completedEvent);
    expect(dbTransaction).toHaveBeenCalledOnce();
    expect(progressionService.processCompletedMatch).toHaveBeenCalledWith(MATCH_ID);
    expect(ratingsService.processMatch).not.toHaveBeenCalled();
    expect(realtimeGateway.broadcastTableUpsert).not.toHaveBeenCalled();
  });
});
