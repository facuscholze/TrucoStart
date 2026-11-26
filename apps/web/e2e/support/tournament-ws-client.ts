import { randomUUID } from 'node:crypto';
import { chooseBotAction, type PlayerView } from '@truco/engine';
import { type WsEnvelope, WsEnvelopeSchema } from '@truco/shared';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';

/**
 * Cliente de juego sin navegador para los E2E de torneo.
 *
 * Jugar un cruce con cuatro navegadores reales cuesta minutos por partida (cada turno espera
 * al DOM de cuatro pestañas), y un torneo 2v2 tiene tres cruces: se pasaba del tiempo del
 * runner. Acá los cuatro asientos juegan por WebSocket contra el game-server real, con las
 * mismas reglas, el mismo motor y la misma persistencia; el navegador queda para lo que
 * tiene que verse en pantalla: inscripción, llave y resultado.
 *
 * Las decisiones se piden al bot del motor (`chooseBotAction`): no valida la interfaz, pero
 * sí valida turnos, cantos y resolución del cruce, que es lo que mira el torneo.
 */
export class TournamentWsPlayer {
  readonly userId: string;
  readonly nickname: string;
  socket!: ClientSocket;
  latestView: PlayerView | null = null;
  private readonly transcript: WsEnvelope[] = [];
  private lastSeq = 0;

  constructor(input: { readonly userId: string; readonly nickname: string }) {
    this.userId = input.userId;
    this.nickname = input.nickname;
  }

  async connect(gameServerUrl: string, ticket: string): Promise<void> {
    this.socket = createSocketClient(gameServerUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: ticket },
    });
    this.socket.on('envelope', (raw: unknown) => {
      const parsed = WsEnvelopeSchema.parse(raw);
      this.transcript.push(parsed);
      if (typeof parsed.seq === 'number' && parsed.seq > this.lastSeq) this.lastSeq = parsed.seq;
      const view = parsed.payload['view'];
      if (view && typeof view === 'object') this.latestView = view as unknown as PlayerView;
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timeout conectando al game-server')),
        10_000,
      );
      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  send(type: string, payload: Record<string, unknown>): void {
    this.socket.emit('envelope', { eventId: randomUUID(), ts: Date.now(), type, payload });
  }

  ended(): boolean {
    return this.transcript.some((event) => event.type === 'game.ended');
  }

  disconnect(): void {
    this.socket?.disconnect();
  }

  /** Juega hasta que la partida termina, usando las decisiones del bot del motor. */
  async playToEnd(roomId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.ended()) return;
      const view = this.latestView;
      if (!view) {
        await sleep(20);
        continue;
      }
      // Sólo actúa a quien le toca y tiene una acción legal pendiente.
      if (view.hand.activeSeat !== view.mySeat || view.legalActions.length === 0) {
        await sleep(15);
        continue;
      }
      const before = this.lastSeq;
      this.applyBotDecision(roomId, view);
      const waitUntil = Date.now() + 2_000;
      while (Date.now() < waitUntil && this.lastSeq <= before && !this.ended()) await sleep(10);
    }
    throw new Error(`La partida del torneo no terminó en ${timeoutMs} ms (${this.nickname}).`);
  }

  private applyBotDecision(roomId: string, view: PlayerView): void {
    const action = chooseBotAction(view);
    if (action.type === 'PLAY_CARD') {
      this.send('game.playCard', { roomId, cardId: action.cardId });
    } else if (action.type === 'FOLD_HAND') {
      this.send('game.foldHand', { roomId });
    } else if (
      action.type === 'CALL_TRUCO' ||
      action.type === 'CALL_ENVIDO' ||
      action.type === 'CALL_FLOR'
    ) {
      this.send('game.call', { roomId, type: action.bid });
    } else if (action.type === 'RESPOND_TRUCO') {
      this.send('game.respond', { roomId, call: 'TRUCO', answer: action.decision });
    } else if (action.type === 'RESPOND_ENVIDO') {
      this.send('game.respond', { roomId, call: 'ENVIDO', answer: action.decision });
    } else if (action.type === 'RESPOND_FLOR') {
      this.send('game.respond', { roomId, call: 'FLOR', answer: action.decision });
    } else {
      this.send('game.foldHand', { roomId });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
