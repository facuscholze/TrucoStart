import { randomBytes } from 'node:crypto';
import { createGame, type GameState, type PlayerSeat, type RuleSet, viewFor } from '@truco/engine';
import type { RoomSeatInfo, RulesetCode } from '@truco/shared';
import {
  computeSeedCommitment,
  createRngFromSeedHex,
  encryptSeedForStore,
  generateCommitRevealSeed,
} from '../security/commit-reveal.js';
import type { PersistedSequencedEvent } from '../store/game-store.interface.js';
import { resolveRulesetByCode } from './action-mapper.js';
import { buildSequencedEvent } from './event-projector.js';

function generateMatchUuidV7(nowMs: number): string {
  const bytes = randomBytes(16);
  const ts = BigInt(Math.max(0, Math.floor(nowMs)));
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface StartMatchParams {
  readonly roomId: string;
  readonly rulesetCode: RulesetCode;
  readonly ruleset?: RuleSet;
  readonly publicSeats: readonly RoomSeatInfo[];
  readonly seedEncryptionKey: string;
  readonly turnDeadline: number;
  readonly turnWarningAt: number;
  readonly nowMs: number;
  readonly tableStateEvent: PersistedSequencedEvent;
  readonly allocateSeq: () => number;
  /**
   * Semilla fija de reparto (solo tests/E2E): mantiene commit-reveal válido pero hace
   * la partida reproducible entre corridas.
   */
  readonly dealSeedHex?: string;
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

  const { seedHex, seedCommitment } = params.dealSeedHex
    ? { seedHex: params.dealSeedHex, seedCommitment: computeSeedCommitment(params.dealSeedHex) }
    : generateCommitRevealSeed();
  const ruleset = params.ruleset ?? resolveRulesetByCode(rulesetCode);
  const enginePlayers: PlayerSeat[] = publicSeats.map((s) => ({
    seat: s.seat,
    team: s.team,
    playerId: s.userId!,
  }));

  const matchId = generateMatchUuidV7(nowMs);
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
