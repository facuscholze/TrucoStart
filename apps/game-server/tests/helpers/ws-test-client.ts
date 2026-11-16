import { randomUUID } from 'node:crypto';
import type { Card, CardId, PlayerView } from '@truco/engine';
import {
  type ClientEventType,
  signWsAuthTicket,
  type WsEnvelope,
  WsEnvelopeSchema,
} from '@truco/shared';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { expect } from 'vitest';

const CARD_ID_REGEX = /^(1|2|3|4|5|6|7|10|11|12)-(espadas|bastos|oros|copas)$/;

export interface CreateTestClientParams {
  readonly port: number;
  readonly secret: string;
  readonly userId: string;
  readonly nickname: string;
  readonly sessionId: string;
  readonly seat: number;
  readonly team: number;
}

export class TestWsClient {
  readonly userId: string;
  readonly nickname: string;
  readonly sessionId: string;
  readonly seat: number;
  readonly team: number;
  private readonly secret: string;
  socket!: ClientSocket;

  readonly transcript: WsEnvelope[] = [];
  lastSeq = 0;
  latestView: PlayerView | null = null;
  private cursor = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(params: CreateTestClientParams) {
    this.userId = params.userId;
    this.nickname = params.nickname;
    this.sessionId = params.sessionId;
    this.seat = params.seat;
    this.team = params.team;
    this.secret = params.secret;
  }

  async connectToPort(port: number): Promise<void> {
    const token = signWsAuthTicket(
      {
        userId: this.userId,
        sessionId: this.sessionId,
        nickname: this.nickname,
        exp: Date.now() + 120_000,
      },
      this.secret,
    );

    this.socket = createClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token },
    });

    this.socket.on('envelope', (raw: unknown) => {
      const parsed = WsEnvelopeSchema.parse(raw);
      this.transcript.push(parsed);
      if (typeof parsed.seq === 'number' && parsed.seq > this.lastSeq) {
        this.lastSeq = parsed.seq;
      }
      if (parsed.payload['view'] && typeof parsed.payload['view'] === 'object') {
        this.latestView = parsed.payload['view'] as unknown as PlayerView;
      }
      const pending = this.waiters.splice(0, this.waiters.length);
      for (const wake of pending) wake();
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout conectando ${this.nickname}`)),
        4_000,
      );
      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  send(type: ClientEventType, payload: Record<string, unknown>): string {
    const eventId = randomUUID();
    this.socket.emit('envelope', {
      eventId,
      ts: Date.now(),
      type,
      payload,
    });
    return eventId;
  }

  async waitFor(
    predicate: (env: WsEnvelope) => boolean,
    label: string,
    timeoutMs = 4_000,
  ): Promise<WsEnvelope> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      while (this.cursor < this.transcript.length) {
        const env = this.transcript[this.cursor]!;
        this.cursor += 1;
        if (predicate(env)) return env;
      }
      const remaining = Math.max(10, deadline - Date.now());
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(remaining, 100));
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    throw new Error(
      `Timeout esperando [${label}] en cliente ${this.nickname} (seat=${this.seat}). Recibidos=${this.transcript.map((e) => `${e.type}#${e.seq ?? '-'}`).join(', ')}`,
    );
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

function isCardObject(val: unknown): val is Card {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const rec = val as Record<string, unknown>;
  return (
    typeof rec['id'] === 'string' &&
    CARD_ID_REGEX.test(rec['id']) &&
    typeof rec['rank'] === 'number' &&
    typeof rec['suit'] === 'string'
  );
}

function collectAllCardReferences(
  node: unknown,
  out: Array<{ path: string; cardId: CardId }>,
  path = '',
): void {
  if (typeof node === 'string') {
    if (CARD_ID_REGEX.test(node)) {
      out.push({ path, cardId: node as CardId });
    }
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (isCardObject(node)) {
    out.push({ path, cardId: node.id });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectAllCardReferences(item, out, `${path}[${idx}]`));
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    collectAllCardReferences(v, out, path ? `${path}.${k}` : k);
  }
}

/**
 * Inspecciona recursivamente el 100% de los sobres recibidos por cada cliente
 * (tanto objetos Card como strings CardId, PRNG interno y señas de equipo)
 * y verifica que JAMÁS se filtre una carta privada no jugada de otro jugador ni una seña rival.
 */
export function assertZeroInformationLeakageAcrossTranscript(clients: readonly TestWsClient[]): {
  totalEnvelopesInspected: number;
  totalCardReferencesVerified: number;
} {
  const truthByHandSeat = new Map<number, Map<number, Set<CardId>>>();
  const publicPlaySeqByHandCard = new Map<number, Map<CardId, number>>();

  for (const c of clients) {
    for (const ev of c.transcript) {
      if (ev.type === 'game.dealt') {
        const handNum = ev.payload['handNumber'] as number;
        const mySeat = ev.payload['mySeat'] as number;
        expect(mySeat).toBe(c.seat);
        const cards = ev.payload['myCards'] as Card[];
        let seatMap = truthByHandSeat.get(handNum);
        if (!seatMap) {
          seatMap = new Map();
          truthByHandSeat.set(handNum, seatMap);
        }
        seatMap.set(mySeat, new Set(cards.map((card) => card.id)));
      }
      if (ev.type === 'game.cardPlayed' && typeof ev.seq === 'number') {
        const handNum = ev.payload['handNumber'] as number;
        const card = ev.payload['card'] as Card;
        let pubMap = publicPlaySeqByHandCard.get(handNum);
        if (!pubMap) {
          pubMap = new Map();
          publicPlaySeqByHandCard.set(handNum, pubMap);
        }
        const prev = pubMap.get(card.id);
        if (prev === undefined || ev.seq < prev) {
          pubMap.set(card.id, ev.seq);
        }
      }
    }
  }

  let totalEnvelopesInspected = 0;
  let totalCardReferencesVerified = 0;

  for (const viewer of clients) {
    let activeHandForViewer = 1;

    for (const ev of viewer.transcript) {
      totalEnvelopesInspected += 1;

      if (typeof ev.payload['handNumber'] === 'number') {
        activeHandForViewer = ev.payload['handNumber'] as number;
      } else if (
        ev.payload['view'] &&
        typeof (ev.payload['view'] as Record<string, unknown>)['hand'] === 'object'
      ) {
        const viewHand = (ev.payload['view'] as Record<string, unknown>)['hand'] as Record<
          string,
          unknown
        >;
        if (typeof viewHand['handNumber'] === 'number') {
          activeHandForViewer = viewHand['handNumber'] as number;
        }
      }

      // A) Ningún evento `game.signalSent` puede llegar jamás al equipo rival
      if (ev.type === 'game.signalSent') {
        expect(ev.payload['team']).toBe(viewer.team);
      }

      // B) Si hay `view`, debe ser estrictamente `viewFor(state, viewer.seat)` sin estado interno
      if (ev.payload['view'] && typeof ev.payload['view'] === 'object') {
        const v = ev.payload['view'] as Record<string, unknown>;
        expect(v['mySeat']).toBe(viewer.seat);
        expect(v['internalPrngState']).toBeUndefined();

        if (Array.isArray(v['seats'])) {
          for (const pubSeat of v['seats'] as Array<Record<string, unknown>>) {
            expect(pubSeat['initialCards']).toBeUndefined();
            expect(pubSeat['remainingCards']).toBeUndefined();
            expect(typeof pubSeat['remainingCardCount']).toBe('number');
          }
        }

        const handObj = v['hand'] as Record<string, unknown> | undefined;
        if (handObj) {
          expect(handObj['initialHandsBySeat']).toBeUndefined();
          expect(handObj['remainingHandsBySeat']).toBeUndefined();
          expect(handObj['signalsSentThisHand']).toBeUndefined();
          if (Array.isArray(handObj['visibleSignals'])) {
            for (const sig of handObj['visibleSignals'] as Array<Record<string, unknown>>) {
              expect(sig['team']).toBe(viewer.team);
            }
          }
        }
      }

      // C) Inspección recursiva de cada Card y cada CardId string en todo el árbol JSON del sobre
      const refs: Array<{ path: string; cardId: CardId }> = [];
      collectAllCardReferences(ev.payload, refs);
      const seatTruthMap = truthByHandSeat.get(activeHandForViewer);
      const pubSeqMap = publicPlaySeqByHandCard.get(activeHandForViewer);

      for (const { path, cardId } of refs) {
        totalCardReferencesVerified += 1;
        const ownCards = seatTruthMap?.get(viewer.seat);
        const isOwnCard = ownCards?.has(cardId) ?? false;
        const pubSeq = pubSeqMap?.get(cardId);
        const isPubliclyPlayedAtSeq =
          pubSeq !== undefined && (ev.seq === undefined || ev.seq >= pubSeq);

        if (!isOwnCard && !isPubliclyPlayedAtSeq) {
          throw new Error(
            `FUGA DE INFORMACIÓN DETECTADA: Cliente ${viewer.nickname} (seat=${viewer.seat}) recibió carta oculta ajena ${cardId} en sobre ${ev.type} (seq=${ev.seq ?? 'n/a'}, mano=${activeHandForViewer}, ruta=${path})`,
          );
        }
      }
    }
  }

  return { totalEnvelopesInspected, totalCardReferencesVerified };
}
