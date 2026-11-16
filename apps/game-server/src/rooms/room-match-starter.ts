import { randomUUID } from 'node:crypto';
import { createGame, type GameState, type PlayerSeat, viewFor } from '@truco/engine';
import type { RoomSeatInfo, RulesetCode } from '@truco/shared';
import {
  createRngFromSeedHex,
  encryptSeedForStore,
  generateCommitRevealSeed,
} from '../security/commit-reveal.js';
import type { PersistedSequencedEvent } from '../store/game-store.interface.js';
import { resolveRulesetByCode } from './action-mapper.js';
import { buildSequencedEvent } from './event-projector.js';

export interface StartMatchParams {
  readonly roomId: string;
  readonly rulesetCode: RulesetCode;
  readonly publicSeats: readonly RoomSeatInfo[];
  readonly seedEncryptionKey: string;
  readonly turnDeadline: number;
  readonly turnWarningAt: number;
  readonly nowMs: number;
  readonly tableStateEvent: PersistedSequencedEvent;
  readonly allocateSeq: () => number;
}

export interface StartedMatchBundle {
  readonly matchId: string;
  readonly seedHex: string;
  readonly seedCommitment: string;
  readonly encryptedSeed: string;
  readonly gameState: GameState;
  readonly events: readonly PersistedSequencedEvent[];
}

export function createMatchStartBundle(params: StartMatchParams): StartedMatchBundle {
  const {
    roomId,
    rulesetCode,
    publicSeats,
    seedEncryptionKey,
    turnDeadline,
    turnWarningAt,
    nowMs,
    tableStateEvent,
    allocateSeq,
  } = params;

  const { seedHex, seedCommitment } = generateCommitRevealSeed();
  const ruleset = resolveRulesetByCode(rulesetCode);
  const enginePlayers: PlayerSeat[] = publicSeats.map((s) => ({
    seat: s.seat,
    team: s.team,
    playerId: s.userId!,
  }));

  const matchId = randomUUID();
  const encryptedSeed = encryptSeedForStore(seedHex, seedEncryptionKey);
  const gameState = createGame(ruleset, enginePlayers, createRngFromSeedHex(seedHex));

  const events: PersistedSequencedEvent[] = [
    tableStateEvent,
    buildSequencedEvent(
      allocateSeq,
      nowMs,
      'game.started',
      {
        roomId,
        matchId,
        rulesetCode,
        targetScore: ruleset.targetScore,
        seats: publicSeats,
        seedCommitment,
      },
      { kind: 'ALL' },
    ),
  ];

  for (const s of publicSeats) {
    const seatView = viewFor(gameState, s.seat);
    events.push(
      buildSequencedEvent(
        allocateSeq,
        nowMs,
        'game.dealt',
        {
          roomId,
          handNumber: 1,
          manoSeat: 0,
          mySeat: s.seat,
          myCards: seatView.hand.myInitialCards,
          view: seatView as unknown as Record<string, unknown>,
        },
        { kind: 'SEAT', seat: s.seat },
      ),
    );
  }

  for (const s of publicSeats) {
    const seatView = viewFor(gameState, s.seat);
    events.push(
      buildSequencedEvent(
        allocateSeq,
        nowMs,
        'game.turn',
        {
          roomId,
          handNumber: 1,
          seat: gameState.hand.activeSeat,
          responderTeam: gameState.hand.responderTeam,
          deadline: turnDeadline,
          warningAt: turnWarningAt,
          view: seatView as unknown as Record<string, unknown>,
        },
        { kind: 'SEAT', seat: s.seat },
      ),
    );
  }

  return {
    matchId,
    seedHex,
    seedCommitment,
    encryptedSeed,
    gameState,
    events,
  };
}
