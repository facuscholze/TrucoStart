import type { DomainEvent } from './state.types.js';

export function formatDomainEvent(event: DomainEvent): string {
  switch (event.type) {
    case 'MATCH_STARTED':
      return `[PARTIDA] Inicio (${event.rulesetCode}, a ${event.targetScore} pts, ${event.seats.length} asientos)`;
    case 'HAND_STARTED':
      return `[MANO #${event.handNumber}] Reparto inicial · Es mano el asiento ${event.manoSeat}`;
    case 'CARD_PLAYED':
      return `[MANO #${event.handNumber} · R${event.roundIndex + 1}] Asiento ${event.seat} (Eq. ${event.team}) juega ${event.card.id}`;
    case 'ROUND_ENDED':
      return event.isParda
        ? `[MANO #${event.handNumber} · R${event.roundIndex + 1}] Ronda PARDA`
        : `[MANO #${event.handNumber} · R${event.roundIndex + 1}] Gana ronda Equipo ${event.winnerTeam} (asiento ${event.winningSeat})`;
    case 'ENVIDO_CALLED':
      return `[MANO #${event.handNumber}] Asiento ${event.seat} (Eq. ${event.team}) canta ${event.bid}${event.cancelledPendingTruco ? ' ("el envido está primero")' : ''}`;
    case 'ENVIDO_RESOLVED':
      return event.accepted
        ? `[MANO #${event.handNumber}] Envido QUERIDO · Gana Equipo ${event.winningTeam} (asiento ${event.winningSeat} con ${event.winningScore}) -> +${event.pointsAwarded} pts`
        : `[MANO #${event.handNumber}] Envido NO QUERIDO (responde asiento ${event.responderSeat}) -> +${event.pointsAwarded} pts para Equipo ${event.winningTeam}`;
    case 'FLOR_CALLED':
      return `[MANO #${event.handNumber}] Asiento ${event.seat} (Eq. ${event.team}) canta ${event.bid}`;
    case 'FLOR_RESOLVED':
      return event.accepted
        ? `[MANO #${event.handNumber}] Flor QUERIDA · Gana Equipo ${event.winningTeam} (asiento ${event.winningSeat} con ${event.winningScore}) -> +${event.pointsAwarded} pts`
        : `[MANO #${event.handNumber}] Flor resuelta sin compulsa -> +${event.pointsAwarded} pts para Equipo ${event.winningTeam}`;
    case 'TRUCO_CALLED':
      return `[MANO #${event.handNumber}] Asiento ${event.seat} (Eq. ${event.team}) canta ${event.bid}`;
    case 'TRUCO_ACCEPTED':
      return `[MANO #${event.handNumber}] Asiento ${event.responderSeat} dice QUIERO a ${event.bid} (mano en ${event.currentPoints} pts)`;
    case 'TRUCO_DECLINED':
      return `[MANO #${event.handNumber}] Asiento ${event.responderSeat} dice NO QUIERO a ${event.bid} -> +${event.pointsAwarded} pts para Equipo ${event.winningTeam}`;
    case 'PLAYER_FOLDED':
      return `[MANO #${event.handNumber}] Asiento ${event.seat} (Eq. ${event.team}) se va al mazo`;
    case 'SIGNAL_SENT':
      return `[MANO #${event.handNumber}] Asiento ${event.seat} (Eq. ${event.team}) envía seña "${event.signalId}"`;
    case 'SCORE_UPDATED':
      return `[TANTEADOR] Equipo ${event.team} suma +${event.delta} (${event.reason}) -> Total: ${event.newScore}`;
    case 'HAND_ENDED':
      return `[MANO #${event.handNumber}] Fin de mano (${event.reason}) · Ganador: Equipo ${event.winnerTeam}`;
    case 'SYSTEM_ACTION_APPLIED':
      return `[SISTEMA] ${event.actionKind} sobre asiento ${event.seat} -> ${event.resolvedAs}`;
    case 'MATCH_ENDED': {
      const scoreboard = Object.entries(event.scoresByTeam)
        .map(([team, pts]) => `Eq.${team}=${pts}`)
        .join(' vs ');
      return `[FIN DE PARTIDA] Ganador: Equipo ${event.winnerTeam} (${event.reason}) · Marcador final: ${scoreboard}`;
    }
  }
}

export function formatMatchLog(events: readonly DomainEvent[]): string {
  return events.map((ev) => formatDomainEvent(ev)).join('\n');
}
