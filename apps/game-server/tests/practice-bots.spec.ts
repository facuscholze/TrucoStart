import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AR_STANDARD_V1 } from '@truco/engine';
import type { Action, PlayerView } from '@truco/engine';
import type { RoomProvisionSpec } from '@truco/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryMatchLifecycleBus } from '../src/events/match-lifecycle-publisher.js';
import { createGameServer, type GameServerInstance } from '../src/server.js';
import { TestWsClient } from './helpers/ws-test-client.js';

const SECRET = 'secreto-practica-m6-minimo-32-chars!!!!';
const ROOM_ID = '019a7e40-0000-7000-8000-000000000a01';
const ROOM_ID_2V2 = '019a7e40-0000-7000-8000-000000000a02';
const ROOM_ID_NORMAL = '019a7e40-0000-7000-8000-000000000a03';

function buildSpec(roomId: string, mode: '1v1' | '2v2', practice?: boolean): RoomProvisionSpec {
  return {
    roomId,
    mode,
    visibility: 'PRIVATE',
    rulesetCode: 'ar-standard-v1',
    ruleset: AR_STANDARD_V1 as unknown as Record<string, unknown>,
    targetScore: 15,
    florEnabled: false,
    turnTimeoutMs: 20_000,
    ...(practice ? { practice: { difficulty: 'EASY' as const } } : {}),
  };
}

function createClient(port: number, seat: number, suffix: string): TestWsClient {
  return new TestWsClient({
    port,
    secret: SECRET,
    userId: `019a7e40-0000-7000-8000-0000000000${suffix}`,
    nickname: `Humano ${suffix}`,
    sessionId: `session-${suffix}-0001`,
    seat,
    team: seat % 2,
  });
}

describe('M6 — bots como asientos del game-server y modo práctica', () => {
  let server: GameServerInstance | null = null;
  let clients: TestWsClient[] = [];

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    clients = [];
    if (server) {
      await server.close();
      server = null;
    }
  });

  async function startPracticeServer(
    bus: InMemoryMatchLifecycleBus,
    extra: { replaceDisconnectedWithBot?: boolean } = {},
  ): Promise<number> {
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: bus,
      allowAdHocRooms: false,
      idleSweepIntervalMs: 0,
      botDecisionMinDelayMs: 0,
      botDecisionMaxDelayMs: 1,
      ...(extra.replaceDisconnectedWithBot !== undefined
        ? { replaceDisconnectedWithBot: extra.replaceDisconnectedWithBot }
        : {}),
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 5_000,
        chatMax: 500,
        tableMax: 500,
        connectionTotalMax: 900,
      },
    });
    await server.listen(0, '127.0.0.1');
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Sin puerto de escucha');
    return address.port;
  }

  it('crea la mesa de práctica con bots listos y arranca la partida al entrar el humano', async () => {
    const bus = new InMemoryMatchLifecycleBus();
    const port = await startPracticeServer(bus);
    await server!.provisionRoom(buildSpec(ROOM_ID, '1v1', true));

    const human = createClient(port, 0, 'c1');
    clients.push(human);
    await human.connectToPort(port);
    human.send('table.join', { roomId: ROOM_ID });

    const state = await human.waitFor(
      (env) => env.type === 'table.state' && (env.payload['seats'] as unknown[])?.length === 2,
      'table.state con bots',
    );
    const seats = state.payload['seats'] as Array<{ seat: number; isBot: boolean; ready: boolean }>;
    expect(seats[1]).toMatchObject({ seat: 1, isBot: true, ready: true });
    expect(seats[0]?.isBot).toBe(false);

    const started = await human.waitFor((env) => env.type === 'game.started', 'game.started');
    expect(started.payload['matchId']).toBeTruthy();

    const dealt = await human.waitFor((env) => env.type === 'game.dealt', 'game.dealt');
    expect((dealt.payload['myCards'] as unknown[]).length).toBe(3);

    // El humano es mano: juega una carta y el bot responde solo, sin intervención humana.
    const turn = await human.waitFor((env) => env.type === 'game.turn', 'game.turn');
    const view = turn.payload['view'] as unknown as PlayerView;
    const card = view.legalActions.find((a) => a.type === 'PLAY_CARD');
    expect(card).toBeTruthy();
    if (card) sendEngineAction(human, ROOM_ID, card);

    await human.waitFor(
      (env) => env.type === 'game.cardPlayed' && (env.payload['seat'] as number) === 1,
      'primera acción del bot',
      8_000,
    );
  }, 20_000);

  it('juega una partida 1v1 completa: el bot reemplaza al humano que se cae', async () => {
    const bus = new InMemoryMatchLifecycleBus();
    const port = await startPracticeServer(bus, { replaceDisconnectedWithBot: true });
    await server!.provisionRoom(buildSpec(ROOM_ID, '1v1', true));

    const human = createClient(port, 0, 'c2');
    clients.push(human);
    await human.connectToPort(port);
    human.send('table.join', { roomId: ROOM_ID });
    await human.waitFor((env) => env.type === 'game.dealt', 'game.dealt');

    human.disconnect();

    const deadline = Date.now() + 45_000;
    let ended = false;
    while (Date.now() < deadline && !ended) {
      const snapshot = await server!.store.loadRoomSnapshot(ROOM_ID);
      if (!snapshot) break;
      ended = snapshot.status === 'FINISHED';
      if (!ended) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ended).toBe(true);
    // La partida de práctica no genera partidas competitivas.
    expect(bus.getPublishedEvents().filter((e) => e.kind === 'match.completed')).toHaveLength(0);
  }, 60_000);

  it('arma 2v2 con compañero bot y dos rivales bot', async () => {
    const bus = new InMemoryMatchLifecycleBus();
    const port = await startPracticeServer(bus);
    await server!.provisionRoom(buildSpec(ROOM_ID_2V2, '2v2', true));

    const human = createClient(port, 0, 'c3');
    clients.push(human);
    await human.connectToPort(port);
    human.send('table.join', { roomId: ROOM_ID_2V2 });

    const started = await human.waitFor((env) => env.type === 'game.started', 'game.started 2v2');
    const seats = started.payload['seats'] as Array<{ seat: number; team: number; isBot: boolean }>;
    expect(seats).toHaveLength(4);
    expect(seats.filter((s) => s.isBot)).toHaveLength(3);
    expect(seats.find((s) => s.seat === 2)).toMatchObject({ isBot: true, team: 0 });
  });

  it('responde pistas de entrenamiento solo en mesas de práctica', async () => {
    const bus = new InMemoryMatchLifecycleBus();
    const port = await startPracticeServer(bus);
    await server!.provisionRoom(buildSpec(ROOM_ID, '1v1', true));
    await server!.provisionRoom(buildSpec(ROOM_ID_NORMAL, '1v1'));

    const human = createClient(port, 0, 'c4');
    clients.push(human);
    await human.connectToPort(port);
    human.send('table.join', { roomId: ROOM_ID });
    await human.waitFor((env) => env.type === 'game.dealt', 'game.dealt');

    human.send('practice.hint', { roomId: ROOM_ID });
    const hint = await human.waitFor((env) => env.type === 'practice.hint', 'practice.hint');
    expect(hint.payload['seat']).toBe(0);
    expect(String(hint.payload['suggestedAction'])).toMatch(/^[A-Z_]+/);
    expect(String(hint.payload['explanation']).length).toBeGreaterThan(8);
    expect(hint.payload['difficulty']).toBe('EASY');

    // Mesa común: la pista se rechaza explícitamente.
    const normal = createClient(port, 0, 'c5');
    clients.push(normal);
    await normal.connectToPort(port);
    normal.send('table.join', { roomId: ROOM_ID_NORMAL });
    await normal.waitFor((env) => env.type === 'table.state', 'table.state normal');
    normal.send('practice.hint', { roomId: ROOM_ID_NORMAL });
    const error = await normal.waitFor((env) => env.type === 'error', 'error de pista');
    expect(error.payload['code']).toBe('FORBIDDEN');
  });

  it('los bots solo consumen PlayerView y nunca el estado completo', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.resolve(currentDir, '../src/rooms/bot-seats.ts'), 'utf8');
    expect(source).not.toContain('GameState');
    expect(source).not.toContain('remainingHandsBySeat');
    expect(source).not.toContain('initialHandsBySeat');

    const actorSource = fs.readFileSync(
      path.resolve(currentDir, '../src/rooms/room-actor.ts'),
      'utf8',
    );
    // Las únicas construcciones de vista para bots pasan por viewFor(estado, asiento).
    expect(actorSource).toContain('const view = viewFor(this.gameState, seat);');
    expect(actorSource).toContain('const view = viewFor(this.gameState, seatIdx);');
  });
});

function sendEngineAction(client: TestWsClient, roomId: string, action: Action) {
  switch (action.type) {
    case 'PLAY_CARD':
      client.send('game.playCard', { roomId, cardId: action.cardId });
      return;
    case 'CALL_ENVIDO':
      client.send('game.call', { roomId, type: action.bid });
      return;
    case 'CALL_TRUCO':
      client.send('game.call', { roomId, type: action.bid });
      return;
    case 'CALL_FLOR':
      client.send('game.call', { roomId, type: action.bid });
      return;
    case 'RESPOND_ENVIDO':
      client.send('game.respond', { roomId, call: 'ENVIDO', answer: action.decision });
      return;
    case 'RESPOND_TRUCO':
      client.send('game.respond', { roomId, call: 'TRUCO', answer: action.decision });
      return;
    case 'RESPOND_FLOR':
      client.send('game.respond', {
        roomId,
        call: 'FLOR',
        answer: action.decision === 'CON_FLOR_QUIERO' ? 'CON_FLOR_QUIERO' : 'ACHICO',
      });
      return;
    case 'SEND_SIGNAL':
      client.send('game.signal', { roomId, signalId: action.signalId });
      return;
    case 'FOLD_HAND':
      client.send('game.foldHand', { roomId });
      return;
    default:
      client.send('game.foldHand', { roomId });
  }
}
