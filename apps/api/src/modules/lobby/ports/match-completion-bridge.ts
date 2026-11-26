import { Injectable } from '@nestjs/common';

/** Datos mínimos de una partida terminada que sirven para cerrar un cruce de torneo. */
export interface CompletedMatchInfo {
  /** Sala (= tabla) donde se jugó; es la misma que el torneo guardó en su cruce. */
  readonly roomId: string;
  readonly matchId: string;
  /** 0 = local, 1 = visitante, igual que el resultado persistido de la partida. */
  readonly winnerTeam: number;
  readonly endedAt: Date;
}

/** Cierra el cruce de torneo de esa sala. Devuelve `false` si la sala no era un cruce. */
export type MatchCompletionHandler = (info: CompletedMatchInfo) => Promise<boolean>;

/**
 * Puente entre el lobby y los torneos.
 *
 * El lobby sabe cuándo termina una partida; los torneos saben qué hacer con ella. Si el
 * lobby importara el módulo de torneos habría un ciclo (torneos importa el lobby para
 * aprovisionar la sala de cada cruce), y el `forwardRef` no lo resuelve porque
 * `TournamentsModule` es dinámico: la referencia de clase apunta a los metadatos vacíos.
 *
 * Por eso el lobby sólo conoce esta interfaz y es el módulo de torneos el que se anota
 * al arrancar. El grafo de dependencias queda en una sola dirección.
 */
@Injectable()
export class MatchCompletionBridge {
  private handler: MatchCompletionHandler | null = null;

  /** Lo llama el módulo de torneos al construirse, antes de que el lobby consuma eventos. */
  register(handler: MatchCompletionHandler): void {
    this.handler = handler;
  }

  /**
   * Avisa al torneo, si hay uno escuchando. Un fallo no se propaga: el resultado de la
   * partida ya está persistido y el cierre del cruce se puede reintentar sin duplicar
   * nada (es idempotente por `matchId`).
   */
  async complete(info: CompletedMatchInfo): Promise<boolean> {
    if (!this.handler) return false;
    return this.handler(info);
  }
}
