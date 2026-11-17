import { chooseBotAction, createSeededRng, type PlayerView, viewFor } from '@truco/engine';
import type { BotDifficulty, GameMode } from '@truco/shared';
import type { PersistedSeatBinding } from '../store/game-store.interface.js';

/** Identificador sintético de un asiento ocupado por un bot (nunca es una cuenta real). */
export function botUserId(seat: number): string {
  return `bot:seat:${seat}`;
}

const BOT_NICKNAMES: Readonly<Record<BotDifficulty, string>> = Object.freeze({
  EASY: 'Bot Mate Dulce',
  MEDIUM: 'Bot Mate Amargo',
  HARD: 'Bot Don Truco',
});

export function botNicknameFor(difficulty: BotDifficulty, seat: number): string {
  return `${BOT_NICKNAMES[difficulty]} ${seat + 1}`;
}

/** Cantidad de asientos de la mesa según el modo de juego. */
export function seatCountForMode(mode: GameMode): number {
  return mode === '2v2' ? 4 : 2;
}

/**
 * Construye los asientos ocupados por bots para una mesa de práctica.
 * Los asientos del jugador humano se reservan (`userId: null`) para que se una por WS.
 */
export function buildBotSeats(params: {
  readonly mode: GameMode;
  readonly difficulty: BotDifficulty;
  readonly humanSeat?: number;
}): PersistedSeatBinding[] {
  const total = seatCountForMode(params.mode);
  const humanSeat = params.humanSeat ?? 0;
  const seats: PersistedSeatBinding[] = [];
  for (let seat = 0; seat < total; seat++) {
    const team = seat % 2;
    if (seat === humanSeat) {
      seats.push({
        seat,
        team,
        userId: null,
        nickname: null,
        sessionId: null,
        ready: false,
        connected: false,
        disconnectedAt: null,
        graceDeadline: null,
        isBot: false,
      });
      continue;
    }
    seats.push({
      seat,
      team,
      userId: botUserId(seat),
      nickname: botNicknameFor(params.difficulty, seat),
      sessionId: null,
      ready: true,
      connected: true,
      disconnectedAt: null,
      graceDeadline: null,
      isBot: true,
    });
  }
  return seats;
}

/**
 * Decisión del bot: consume EXCLUSIVAMENTE `PlayerView` (por asiento), nunca el estado completo.
 * Esta es la frontera de información que garantiza que el bot no puede ver cartas ajenas.
 */
export function decideBotActionForSeat(params: {
  readonly view: PlayerView;
  readonly difficulty: BotDifficulty;
  readonly seed: number;
}) {
  return chooseBotAction(params.view, createSeededRng(params.seed), params.difficulty);
}

/** Frontera explícita usada por el `RoomActor` y por los tests anti-fuga. */
export function buildBotViewForSeat(
  state: Parameters<typeof viewFor>[0],
  seat: number,
): PlayerView {
  return viewFor(state, seat);
}

/** Demora humana simulada configurable por mesa (determinista en tests). */
export function pickBotDelayMs(params: {
  readonly minMs: number;
  readonly maxMs: number;
  readonly random01: number;
}): number {
  const min = Math.max(0, Math.floor(params.minMs));
  const max = Math.max(min, Math.floor(params.maxMs));
  if (max === min) return min;
  return min + Math.floor(params.random01 * (max - min));
}
