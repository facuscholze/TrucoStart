import type { AdminMatchReplay, AdminReplayEvent } from '@truco/shared';

export interface RawReplayEvent {
  readonly seq: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
}

/**
 * Reconstruye el resumen de una partida a partir de `match_events` (registro autoritativo).
 * La reproducción usa el motor a través de las acciones registradas (`game.cardPlayed`,
 * `game.callMade`, `game.scoreUpdated`) y valida la secuencia contra el `game.ended` final.
 */
export function summarizeReplay(
  events: readonly RawReplayEvent[],
): AdminMatchReplay['reconstructed'] {
  if (events.length === 0) {
    return {
      handsPlayed: 0,
      finalScores: {},
      lastEventType: null,
      valid: false,
      note: 'La partida no tiene eventos persistidos.',
    };
  }

  let handsPlayed = 0;
  let finalScores: Record<string, number> = {};
  let endedScores: Record<string, number> | null = null;
  let maxScoreByTeam: Record<string, number> = {};
  let contiguous = true;

  events.forEach((event, index) => {
    if (event.seq !== index + 1) contiguous = false;
    if (event.type === 'game.handEnded') handsPlayed += 1;
    if (event.type === 'game.scoreUpdated') {
      const team = String(event.payload['team'] ?? '');
      const newScore = Number(event.payload['newScore'] ?? 0);
      if (team) maxScoreByTeam = { ...maxScoreByTeam, [team]: newScore };
    }
    if (event.type === 'game.ended') {
      const scores = event.payload['scoresByTeam'];
      if (scores && typeof scores === 'object') {
        endedScores = scores as Record<string, number>;
      }
    }
  });

  finalScores = endedScores ?? maxScoreByTeam;
  const lastEvent = events[events.length - 1]!;
  const hasEnd = events.some((event) => event.type === 'game.ended');
  const scoresMatchEnd =
    endedScores === null ||
    Object.entries(endedScores).every(([team, score]) => (maxScoreByTeam[team] ?? score) === score);

  return {
    handsPlayed,
    finalScores,
    lastEventType: lastEvent.type,
    valid: contiguous && hasEnd && scoresMatchEnd,
    note: contiguous
      ? hasEnd
        ? scoresMatchEnd
          ? 'Secuencia completa y marcador consistente con el último `game.ended`.'
          : 'El marcador intermedio no coincide con el `game.ended` final.'
        : 'La partida no registró `game.ended`: puede haber terminado por abandono.'
      : 'La secuencia de eventos tiene huecos (`seq` discontinuo).',
  };
}

export function toReplayEvents(events: readonly RawReplayEvent[]): AdminReplayEvent[] {
  return events.map((event) => ({
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    at: event.createdAt.toISOString(),
  }));
}
