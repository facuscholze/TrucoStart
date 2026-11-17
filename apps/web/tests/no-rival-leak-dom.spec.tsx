import { act, render, waitFor } from '@testing-library/react';
import {
  AR_STANDARD_V1,
  applyAction,
  type Card,
  createGameWithHands,
  createSeededRng,
  type GameState,
  viewFor,
} from '@truco/engine';
import type { RoomSeatInfo, WsEnvelope } from '@truco/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameTableView } from '../src/features/mesa/GameTableView.js';
import type { ServerPlayerView } from '../src/features/mesa/mesa-view-model.js';
import { useLiveGameRoom } from '../src/features/mesa/useLiveGameRoom.js';
import type * as ApiClientModule from '../src/lib/api-client.js';

type AuthFn = (cb: (data: { token?: string }) => void) => void | Promise<void>;

interface FakeSocket {
  auth: AuthFn;
  connected: boolean;
  listeners: Map<string, Set<(...args: unknown[]) => void>>;
  ioListeners: Map<string, Set<(...args: unknown[]) => void>>;
}

const fakeSockets: FakeSocket[] = [];

vi.mock('socket.io-client', () => ({
  io: (_url: string, opts: { auth: AuthFn }) => {
    const instance: FakeSocket = {
      auth: opts.auth,
      connected: false,
      listeners: new Map(),
      ioListeners: new Map(),
    };
    fakeSockets.push(instance);
    return {
      get connected() {
        return instance.connected;
      },
      on(ev: string, fn: (...args: unknown[]) => void) {
        if (!instance.listeners.has(ev)) instance.listeners.set(ev, new Set());
        instance.listeners.get(ev)!.add(fn);
        return this;
      },
      emit() {
        return this;
      },
      connect() {
        return this;
      },
      disconnect() {
        instance.connected = false;
        return this;
      },
      io: {
        on(ev: string, fn: (...args: unknown[]) => void) {
          if (!instance.ioListeners.has(ev)) instance.ioListeners.set(ev, new Set());
          instance.ioListeners.get(ev)!.add(fn);
        },
      },
    };
  },
}));

vi.mock('../src/lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    ensureGuestOrActiveSession: vi.fn().mockResolvedValue({
      id: '01950000-0000-7000-8000-000000000001',
      nickname: 'FacuCordoba',
      isGuest: true,
    }),
    mintSingleUseWsTicket: vi.fn().mockResolvedValue({
      ticket:
        btoa(
          JSON.stringify({
            v: 1,
            jti: 'jti-leak-check',
            userId: '01950000-0000-7000-8000-000000000001',
            sessionId: '01950000-0000-7000-8000-000000000099',
          }),
        )
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '') + '.sig',
      expiresAt: 1_900_000_000_000,
    }),
  };
});

/**
 * Recorre exhaustivamente todo el subárbol DOM (incluyendo nodos `hidden`,
 * `aria-hidden="true"`, `display: none`, todos los atributos HTML/SVG/ARIA/data-*
 * y todos los nodos de texto y comentarios) y devuelve un corpus concatenado para
 * verificar ausencia absoluta de filtraciones.
 */
function collectCompleteDomCorpus(root: HTMLElement): string {
  const chunks: string[] = [root.outerHTML];

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT,
  );

  let current: Node | null = walker.currentNode;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element;
      for (const attr of Array.from(el.attributes)) {
        chunks.push(`${attr.name}=${attr.value}`);
      }
    } else if (current.nodeValue) {
      chunks.push(current.nodeValue);
    }
    current = walker.nextNode();
  }

  return chunks.join('\n');
}

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { id: `${rank}-${suit}`, rank, suit };
}

function mustApply(state: GameState, action: Parameters<typeof applyAction>[1]): GameState {
  const res = applyAction(state, action);
  if (!res.ok) {
    throw new Error(`Acción rechazada en test: ${res.error.code} (${res.error.message})`);
  }
  return res.value.state;
}

function LiveHarness({ roomId }: { roomId: string }) {
  const session = useLiveGameRoom({ roomId, wsBaseUrl: 'http://127.0.0.1:3002' });
  return <GameTableView {...session} onLeaveTable={() => undefined} />;
}

describe('Pre-M5b Security Invariant — Zero rival signals or other players’ unplayed cards in DOM/attributes', () => {
  beforeEach(() => {
    fakeSockets.length = 0;
  });

  it('never renders unplayed cards of rivals/teammates or rival team signals anywhere in DOM, hidden nodes, or attributes (mobile & desktop)', () => {
    const players = [
      { seat: 0, team: 0, playerId: 'u0' },
      { seat: 1, team: 1, playerId: 'u1' },
      { seat: 2, team: 0, playerId: 'u2' },
      { seat: 3, team: 1, playerId: 'u3' },
    ];

    // Manos fijas distintas por asiento para detectar cualquier filtración
    const handsBySeat: Record<number, readonly Card[]> = {
      // Seat 0 (yo, Equipo 0)
      0: [card(1, 'espadas'), card(7, 'espadas'), card(3, 'oros')],
      // Seat 1 (rival, Equipo 1) — NINGUNA de estas puede aparecer en DOM ni atributos
      1: [card(12, 'espadas'), card(11, 'copas'), card(6, 'bastos')],
      // Seat 2 (compañero, Equipo 0) — Sus cartas ocultas TAMPOCO pueden aparecer en DOM ni atributos
      2: [card(1, 'bastos'), card(7, 'oros'), card(2, 'copas')],
      // Seat 3 (rival, Equipo 1) — NINGUNA de estas puede aparecer en DOM ni atributos
      3: [card(12, 'oros'), card(5, 'copas'), card(4, 'espadas')],
    };

    let state = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players,
      handsBySeat,
      manoSeat: 0,
      rng: createSeededRng(101),
    });

    // El rival (asiento 1, equipo 1) envía dos señas secretas a su compañero (asiento 3)
    state = mustApply(state, {
      type: 'SEND_SIGNAL',
      seat: 1,
      signalId: 'muesca_derecha',
    });
    state = mustApply(state, {
      type: 'SEND_SIGNAL',
      seat: 3,
      signalId: 'inflar_mejilla',
    });

    // Nuestro compañero (asiento 2, equipo 0) envía una seña legítima para nuestro equipo
    state = mustApply(state, {
      type: 'SEND_SIGNAL',
      seat: 2,
      signalId: 'cejas_arriba',
    });

    const myView = viewFor(state, 0) as unknown as ServerPlayerView;
    const roomSeats: RoomSeatInfo[] = [
      {
        seat: 0,
        team: 0,
        userId: 'u0',
        nickname: 'FacuCordoba',
        ready: true,
        isBot: false,
        connected: true,
      },
      {
        seat: 1,
        team: 1,
        userId: 'u1',
        nickname: 'RivalNorte',
        ready: true,
        isBot: false,
        connected: true,
      },
      {
        seat: 2,
        team: 0,
        userId: 'u2',
        nickname: 'CompaSur',
        ready: true,
        isBot: false,
        connected: true,
      },
      {
        seat: 3,
        team: 1,
        userId: 'u3',
        nickname: 'RivalOeste',
        ready: true,
        isBot: false,
        connected: true,
      },
    ];

    for (const width of [360, 1280]) {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: width,
      });

      const { container, unmount } = render(
        <GameTableView
          roomId="room-leak-audit"
          joinCode="AUDIT6"
          connectionStatus="connected"
          tableStatus="IN_GAME"
          seats={roomSeats}
          myUserId="u0"
          view={myView}
          seedCommitment={'f'.repeat(64)}
          turnDeadlineMs={Date.now() + 20_000}
          isTurnWarning={false}
          peerGraceDeadlinesBySeat={new Map()}
          speechBubblesBySeat={new Map()}
          eventFeed={[]}
          matchEnded={null}
          toastMessage={null}
          onDismissToast={() => undefined}
          onMarkReady={() => undefined}
          onPlayCard={() => undefined}
          onCallBid={() => undefined}
          onRespondCall={() => undefined}
          onFoldHand={() => undefined}
          onSendSignal={() => undefined}
          onSendQuickChat={() => undefined}
          onRequestRematch={() => undefined}
          onLeaveTable={() => undefined}
        />,
      );

      const corpus = collectCompleteDomCorpus(container);

      // Mis propias cartas SÍ están renderizadas (IDs y etiquetas accesibles)
      expect(corpus).toContain('data-card-id=1-espadas');
      expect(corpus).toContain('data-card-id=7-espadas');
      expect(corpus).toContain('data-card-id=3-oros');
      expect(corpus).toContain('Siete de espadas');

      // CERO cartas ocultas ajenas (ni de rivales ni del propio compañero) en DOM, nodos ocultos ni atributos
      const forbiddenForeignCards = [
        '12-espadas',
        'Rey de espadas',
        '11-copas',
        'Caballo de copas',
        '6-bastos',
        'Seis de bastos',
        '1-bastos',
        'Ancho de bastos',
        '7-oros',
        'Siete de oros',
        '2-copas',
        'Dos de copas',
        '12-oros',
        'Rey de oros',
        '5-copas',
        'Cinco de copas',
        '4-espadas',
        'Cuatro de espadas',
      ];
      // Nota: "1 de bastos" aparece únicamente como texto descriptivo estático del botón de seña
      // propia "Cejas (1 de bastos)" cuando la bandeja lateral está visible en desktop; jamás como carta ajena.
      for (const token of forbiddenForeignCards) {
        expect(corpus).not.toContain(token);
      }

      // CERO señas enviadas por el equipo rival en el DOM ni en atributos
      expect(corpus).not.toContain('inflar_mejilla');
      expect(corpus).not.toContain('Mejilla (Tengo Flor)');

      unmount();
    }
  });

  it('drops any spoofed/unexpected rival game.signalSent WS envelope so rival signals never enter DOM or attributes', async () => {
    const players = [
      { seat: 0, team: 0, playerId: '01950000-0000-7000-8000-000000000001' },
      { seat: 1, team: 1, playerId: 'u1' },
      { seat: 2, team: 0, playerId: 'u2' },
      { seat: 3, team: 1, playerId: 'u3' },
    ];

    const handsBySeat: Record<number, readonly Card[]> = {
      0: [card(1, 'espadas'), card(3, 'oros'), card(4, 'bastos')],
      1: [card(12, 'espadas'), card(11, 'copas'), card(6, 'bastos')],
      2: [card(2, 'oros'), card(7, 'copas'), card(5, 'bastos')],
      3: [card(12, 'oros'), card(5, 'copas'), card(4, 'espadas')],
    };

    const state = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players,
      handsBySeat,
      manoSeat: 1, // Turno inicial del asiento 1 para que asiento 0 no tenga botones propios de señas abiertos
      rng: createSeededRng(202),
    });
    const myView = viewFor(state, 0);

    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 360,
    });

    const roomId = '01950000-0000-7000-8000-000000000888';
    const { container, unmount } = render(<LiveHarness roomId={roomId} />);

    await waitFor(() => {
      expect(fakeSockets).toHaveLength(1);
    });
    const sock = fakeSockets[0]!;

    const emitServerEnvelope = (env: WsEnvelope) => {
      for (const fn of sock.listeners.get('envelope') ?? []) fn(env);
    };

    act(() => {
      sock.connected = true;
      for (const fn of sock.listeners.get('connect') ?? []) fn();
      emitServerEnvelope({
        eventId: '01950000-0000-7000-8000-000000000201',
        ts: Date.now(),
        seq: 1,
        type: 'game.started',
        payload: {
          roomId,
          matchId: '01950000-0000-7000-8000-000000000202',
          yourSeat: 0,
          seedCommitment: 'a'.repeat(64),
          seats: [
            {
              seat: 0,
              team: 0,
              userId: '01950000-0000-7000-8000-000000000001',
              nickname: 'FacuCordoba',
              ready: true,
              isBot: false,
              connected: true,
            },
            {
              seat: 1,
              team: 1,
              userId: 'u1',
              nickname: 'RivalUno',
              ready: true,
              isBot: false,
              connected: true,
            },
            {
              seat: 2,
              team: 0,
              userId: 'u2',
              nickname: 'CompaDos',
              ready: true,
              isBot: false,
              connected: true,
            },
            {
              seat: 3,
              team: 1,
              userId: 'u3',
              nickname: 'RivalTres',
              ready: true,
              isBot: false,
              connected: true,
            },
          ],
        },
      });
      emitServerEnvelope({
        eventId: '01950000-0000-7000-8000-000000000203',
        ts: Date.now(),
        seq: 2,
        type: 'game.dealt',
        payload: {
          roomId,
          view: myView as unknown as Record<string, unknown>,
        },
      });
      // Intento de inyección de seña rival (asiento 1, equipo 1)
      emitServerEnvelope({
        eventId: '01950000-0000-7000-8000-000000000204',
        ts: Date.now(),
        seq: 3,
        type: 'game.signalSent',
        payload: {
          roomId,
          seat: 1,
          team: 1,
          signalId: 'guino_ojo',
        },
      });
      // Seña válida del propio compañero (asiento 2, equipo 0)
      emitServerEnvelope({
        eventId: '01950000-0000-7000-8000-000000000205',
        ts: Date.now(),
        seq: 4,
        type: 'game.signalSent',
        payload: {
          roomId,
          seat: 2,
          team: 0,
          signalId: 'morder_labio',
        },
      });
    });

    const corpus = collectCompleteDomCorpus(container);

    // La seña del rival jamás aparece ni en texto visible, ni en nodos ocultos, ni en atributos
    expect(corpus).not.toContain('guino_ojo');
    expect(corpus).not.toContain('Guiño (1 de espadas)');

    // La seña legítima de nuestro compañero sí se muestra
    expect(corpus).toContain('Morder labio (Tres)');

    unmount();
  });
});
