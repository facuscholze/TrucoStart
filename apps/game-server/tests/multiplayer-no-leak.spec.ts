import { AR_CORTO_15_V1, createGame } from '@truco/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRngFromSeedHex, verifySeedCommitment } from '../src/security/commit-reveal.js';
import { createGameServer, type GameServerInstance } from '../src/server.js';
import {
  assertZeroInformationLeakageAcrossTranscript,
  TestWsClient,
} from './helpers/ws-test-client.js';

const TEST_SECRET = 'secreto-integracion-multijugador-m2-trucostart-32c!';

async function driveMatchUntil(
  roomId: string,
  clients: readonly TestWsClient[],
  stopCondition?: () => boolean,
  maxSteps = 250,
): Promise<void> {
  for (let step = 0; step < maxSteps; step++) {
    if (stopCondition?.()) return;
    if (clients[0]!.transcript.some((e) => e.type === 'game.ended')) return;

    const latestViews = clients
      .map((c) => c.latestView)
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (latestViews.length === 0) {
      await new Promise((r) => setTimeout(r, 15));
      continue;
    }

    const activeSeat = latestViews.sort((a, b) => b.hand.handNumber - a.hand.handNumber)[0]!.hand
      .activeSeat;
    const actor = clients[activeSeat]!;

    const deadline = Date.now() + 2_000;
    while (
      Date.now() < deadline &&
      (!actor.latestView ||
        actor.latestView.hand.activeSeat !== actor.seat ||
        actor.latestView.legalActions.length === 0)
    ) {
      if (clients[0]!.transcript.some((e) => e.type === 'game.ended')) return;
      await new Promise((r) => setTimeout(r, 10));
    }

    if (clients[0]!.transcript.some((e) => e.type === 'game.ended')) return;
    if (stopCondition?.()) return;

    const view = actor.latestView!;
    const prevSeq = actor.lastSeq;
    const actions = view.legalActions;

    const respondEnvido = actions.find(
      (a) => a.type === 'RESPOND_ENVIDO' && a.decision === 'QUIERO',
    );
    const respondTruco = actions.find((a) => a.type === 'RESPOND_TRUCO' && a.decision === 'QUIERO');
    const respondFlor = actions.find(
      (a) => a.type === 'RESPOND_FLOR' && a.decision === 'CON_FLOR_QUIERO',
    );
    const raiseTruco = actions.find((a) => a.type === 'CALL_TRUCO');
    const playCard = actions.find((a) => a.type === 'PLAY_CARD');

    if (respondEnvido) {
      actor.send('game.respond', { roomId, call: 'ENVIDO', answer: 'QUIERO' });
    } else if (respondTruco) {
      actor.send('game.respond', { roomId, call: 'TRUCO', answer: 'QUIERO' });
    } else if (respondFlor) {
      actor.send('game.respond', { roomId, call: 'FLOR', answer: 'CON_FLOR_QUIERO' });
    } else if (raiseTruco && raiseTruco.type === 'CALL_TRUCO') {
      actor.send('game.call', { roomId, type: raiseTruco.bid });
    } else if (playCard && playCard.type === 'PLAY_CARD') {
      actor.send('game.playCard', { roomId, cardId: playCard.cardId });
    } else {
      actor.send('game.foldHand', { roomId });
    }

    await actor.waitFor((ev) => (ev.seq ?? 0) > prevSeq, `avance tras paso ${step}`);
  }
}

describe('M2 Authoritative Multiplayer Integration (1v1 & 2v2) — Zero Card/Signal Leakage', () => {
  let server: GameServerInstance;
  let port = 0;

  beforeAll(async () => {
    server = createGameServer({
      appName: 'Mesa de Truco M2 Integration',
      sessionSecret: TEST_SECRET,
      seedEncryptionKey: TEST_SECRET,
      defaultTurnTimeoutMs: 15_000,
      reconnectGraceMs: 45_000,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 500,
        chatMax: 50,
        tableMax: 50,
        connectionTotalMax: 800,
      },
    });
    port = await server.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await server.close();
  });

  it('plays a complete 2-client (1v1) match verifying commit-reveal reproducibility and zero card leakage across every message', async () => {
    const roomId = 'mesa-1v1-completa';

    const p0 = new TestWsClient({
      port,
      secret: TEST_SECRET,
      userId: 'u-1v1-0',
      nickname: 'Martín',
      sessionId: 'sess-1v1-martin-00',
      seat: 0,
      team: 0,
    });
    const p1 = new TestWsClient({
      port,
      secret: TEST_SECRET,
      userId: 'u-1v1-1',
      nickname: 'Sofía',
      sessionId: 'sess-1v1-sofia-01',
      seat: 1,
      team: 1,
    });
    const clients = [p0, p1];

    try {
      await Promise.all(clients.map((c) => c.connectToPort(port)));

      p0.send('table.join', {
        roomId,
        mode: '1v1',
        rulesetCode: 'ar-corto-15-v1',
        preferredSeat: 0,
      });
      await p0.waitFor((e) => e.type === 'table.state', 'table.state p0');

      p1.send('table.join', { roomId, preferredSeat: 1 });
      await p1.waitFor((e) => e.type === 'table.state', 'table.state p1');

      for (const c of clients) {
        c.send('table.ready', { roomId, ready: true });
      }

      const started0 = await p0.waitFor((e) => e.type === 'game.started', 'game.started p0');
      const dealt0 = await p0.waitFor((e) => e.type === 'game.dealt', 'game.dealt p0');
      const dealt1 = await p1.waitFor((e) => e.type === 'game.dealt', 'game.dealt p1');
      await p0.waitFor((e) => e.type === 'game.turn', 'game.turn inicial p0');
      await p1.waitFor((e) => e.type === 'game.turn', 'game.turn inicial p1');

      const seedCommitment = started0.payload['seedCommitment'] as string;
      expect(seedCommitment).toMatch(/^[0-9a-f]{64}$/);
      expect(started0.payload['seedReveal']).toBeUndefined();

      // Chat rápido validado por catálogo
      p0.send('chat.quick', { roomId, phraseId: 'buenas' });
      const chatEv = await p1.waitFor((e) => e.type === 'chat.quickMessage', 'chat en p1');
      expect(chatEv.payload['text']).toBe('¡Buenas!');

      // Canto inicial de Real Envido en Mano 1
      p0.send('game.call', { roomId, type: 'REAL_ENVIDO' });
      await p1.waitFor((e) => e.type === 'game.callMade', 'Real Envido en p1');
      p1.send('game.respond', { roomId, call: 'ENVIDO', answer: 'QUIERO' });
      await p0.waitFor((e) => e.type === 'game.callResolved', 'Resolución Real Envido');

      // Conducir partida completa hasta 15 puntos
      await driveMatchUntil(roomId, clients);

      const ended0 = await p0.waitFor((e) => e.type === 'game.ended', 'game.ended p0');
      const ended1 = await p1.waitFor((e) => e.type === 'game.ended', 'game.ended p1');

      const seedReveal = ended0.payload['seedReveal'] as string;
      expect(seedReveal).toBe(ended1.payload['seedReveal']);
      expect(ended0.payload['seedCommitment']).toBe(seedCommitment);
      expect(verifySeedCommitment(seedReveal, seedCommitment)).toBe(true);

      // Verificar reproducibilidad criptográfica exacta del reparto de la Mano #1 con el seed revelado
      const replayedInitialState = createGame(
        AR_CORTO_15_V1,
        [
          { seat: 0, team: 0, playerId: 'u-1v1-0' },
          { seat: 1, team: 1, playerId: 'u-1v1-1' },
        ],
        createRngFromSeedHex(seedReveal),
      );
      expect(replayedInitialState.hand.initialHandsBySeat[0]).toEqual(dealt0.payload['myCards']);
      expect(replayedInitialState.hand.initialHandsBySeat[1]).toEqual(dealt1.payload['myCards']);

      const audit = assertZeroInformationLeakageAcrossTranscript(clients);
      expect(audit.totalEnvelopesInspected).toBeGreaterThan(30);
      expect(audit.totalCardReferencesVerified).toBeGreaterThan(40);
    } finally {
      clients.forEach((c) => c.disconnect());
    }
  });

  it('plays a complete 4-client (2v2) match with private team signals, mid-hand disconnect/rejoin (lastSeq & resync), commit-reveal and zero leakage', async () => {
    const roomId = 'mesa-2v2-cuatro-clientes';

    const specs = [
      { seat: 0, team: 0, userId: 'u-2v2-facu', nickname: 'Facu', sessionId: 'sess-2v2-facu-000' },
      { seat: 1, team: 1, userId: 'u-2v2-vale', nickname: 'Vale', sessionId: 'sess-2v2-vale-001' },
      { seat: 2, team: 0, userId: 'u-2v2-nico', nickname: 'Nico', sessionId: 'sess-2v2-nico-002' },
      { seat: 3, team: 1, userId: 'u-2v2-luli', nickname: 'Luli', sessionId: 'sess-2v2-luli-003' },
    ] as const;

    const clients = specs.map((s) => new TestWsClient({ ...s, port, secret: TEST_SECRET }));
    const [facu, vale, nico, luli] = clients as [
      TestWsClient,
      TestWsClient,
      TestWsClient,
      TestWsClient,
    ];

    try {
      await Promise.all(clients.map((c) => c.connectToPort(port)));

      facu.send('table.join', {
        roomId,
        mode: '2v2',
        rulesetCode: 'ar-corto-15-v1',
        preferredSeat: 0,
      });
      await facu.waitFor((e) => e.type === 'table.state', 'join Facu');

      for (const c of [vale, nico, luli]) {
        c.send('table.join', { roomId, preferredSeat: c.seat });
        await c.waitFor((e) => e.type === 'table.state', `join ${c.nickname}`);
      }
      for (const c of clients) {
        c.send('table.ready', { roomId, ready: true });
      }

      const started = await facu.waitFor((e) => e.type === 'game.started', '2v2 started');
      for (const c of clients) {
        await c.waitFor((e) => e.type === 'game.turn', `turno inicial ${c.nickname}`);
      }

      const seedCommitment = started.payload['seedCommitment'] as string;

      // 1) Seña privada del Equipo 0 (Facu -> Nico): rivales Vale y Luli NO deben recibirla jamás
      facu.send('game.signal', { roomId, signalId: 'guino_ojo' });
      const sigNico = await nico.waitFor(
        (e) => e.type === 'game.signalSent',
        'seña en compañero Nico',
      );
      expect(sigNico.payload['signalId']).toBe('guino_ojo');
      expect(sigNico.payload['team']).toBe(0);
      expect(vale.transcript.some((e) => e.type === 'game.signalSent')).toBe(false);
      expect(luli.transcript.some((e) => e.type === 'game.signalSent')).toBe(false);

      // 2) En 2v2 (NEXT_IN_TURN): Facu (seat 0, mano) canta ENVIDO -> debe responder Vale (seat 1, rival siguiente en ronda)
      facu.send('game.call', { roomId, type: 'ENVIDO' });
      for (const c of clients) {
        await c.waitFor(
          (e) => e.type === 'game.turn' && e.payload['responderTeam'] === 1,
          `turno respuesta envido ${c.nickname}`,
        );
      }
      expect(vale.latestView?.hand.activeSeat).toBe(1);
      // Luli (seat 3, también equipo 1 pero no siguiente en turno) intenta responder -> RULE_VIOLATION
      luli.send('game.respond', { roomId, call: 'ENVIDO', answer: 'QUIERO' });
      const errLuli = await luli.waitFor(
        (e) => e.type === 'error',
        'rechazo respuesta fuera de turno',
      );
      expect(errLuli.payload['code']).toBe('RULE_VIOLATION');

      // Vale (seat 1) responde QUIERO legalmente
      vale.send('game.respond', { roomId, call: 'ENVIDO', answer: 'QUIERO' });
      await facu.waitFor((e) => e.type === 'game.callResolved', 'resolución envido 2v2');
      // Sincronizar vistas de Facu y Vale tras la resolución del Envido antes de la desconexión
      await facu.waitFor(
        (e) =>
          e.type === 'game.turn' && e.payload['seat'] === 0 && e.payload['responderTeam'] === null,
        'turno de carta en Facu tras envido',
      );

      // 3) Desconexión en mitad de la mano: Nico (seat 2) pierde conexión
      const nicoSeqBeforeDrop = nico.lastSeq;
      const nicoTranscriptLenBeforeDrop = nico.transcript.length;
      nico.disconnect();

      const discEv = await facu.waitFor(
        (e) => e.type === 'player.disconnected' && e.payload['seat'] === 2,
        'player.disconnected de Nico',
      );
      expect(typeof discEv.payload['graceDeadline']).toBe('number');

      // Mientras Nico está desconectado:
      // - Vale envía una seña privada del Equipo 1 a Luli (NO debe reenviarse a Nico al reconectar)
      // - Facu juega su primera carta en la mesa y Vale juega su primera carta
      vale.send('game.signal', { roomId, signalId: 'cejas_arriba' });
      await luli.waitFor(
        (e) => e.type === 'game.signalSent' && e.payload['signalId'] === 'cejas_arriba',
        'seña rival durante desconexión de Nico',
      );

      const facuCard0 = facu.latestView!.hand.myRemainingCards[0]!;
      facu.send('game.playCard', { roomId, cardId: facuCard0.id });
      await vale.waitFor(
        (e) => e.type === 'game.cardPlayed' && e.payload['seat'] === 0,
        'carta de Facu mientras Nico está offline',
      );
      await vale.waitFor(
        (e) => e.type === 'game.turn' && e.payload['seat'] === 1,
        'turno de Vale tras carta de Facu',
      );

      const valeCard0 = vale.latestView!.hand.myRemainingCards[0]!;
      vale.send('game.playCard', { roomId, cardId: valeCard0.id });
      await luli.waitFor(
        (e) => e.type === 'game.cardPlayed' && e.payload['seat'] === 1,
        'carta de Vale mientras Nico está offline',
      );

      // Ahora el turno activo es de Nico (seat 2). Nico reconecta con el mismo sessionId + lastSeq
      await nico.connectToPort(port);
      nico.send('game.rejoin', {
        roomId,
        sessionId: nico.sessionId,
        lastSeq: nicoSeqBeforeDrop,
      });

      await facu.waitFor(
        (e) => e.type === 'player.reconnected' && e.payload['seat'] === 2,
        'player.reconnected de Nico en Facu',
      );
      await nico.waitFor(
        (e) => e.type === 'player.reconnected' && e.payload['seat'] === 2,
        'player.reconnected en Nico',
      );

      const replayedToNico = nico.transcript.slice(nicoTranscriptLenBeforeDrop);
      // Nico recuperó las 2 cartas jugadas y su turno, pero CERO señas del Equipo 1
      expect(replayedToNico.filter((e) => e.type === 'game.cardPlayed')).toHaveLength(2);
      expect(replayedToNico.some((e) => e.type === 'game.signalSent')).toBe(false);
      expect(nico.latestView?.hand.activeSeat).toBe(2);

      // Nico juega su carta normalmente tras reconectar
      const nicoCard0 = nico.latestView!.hand.myRemainingCards[0]!;
      nico.send('game.playCard', { roomId, cardId: nicoCard0.id });
      await luli.waitFor(
        (e) => e.type === 'game.cardPlayed' && e.payload['seat'] === 2,
        'carta jugada por Nico tras reconectar',
      );

      // 4) Segunda reconexión: Vale cae y reconecta con lastSeq = 0 -> recibe `game.resync` completo filtrado con viewFor
      vale.disconnect();
      await facu.waitFor(
        (e) => e.type === 'player.disconnected' && e.payload['seat'] === 1,
        'desconexión breve de Vale',
      );
      await vale.connectToPort(port);
      vale.send('game.rejoin', {
        roomId,
        sessionId: vale.sessionId,
        lastSeq: 0,
      });
      const resyncEv = await vale.waitFor((e) => e.type === 'game.resync', 'game.resync en Vale');
      expect((resyncEv.payload['view'] as Record<string, unknown>)['mySeat']).toBe(1);
      await facu.waitFor(
        (e) => e.type === 'player.reconnected' && e.payload['seat'] === 1,
        'reconexión de Vale',
      );

      // 5) Completar toda la partida 2v2 hasta 15 puntos
      await driveMatchUntil(roomId, clients);

      const ended = await facu.waitFor((e) => e.type === 'game.ended', 'game.ended 2v2');
      const seedReveal = ended.payload['seedReveal'] as string;
      expect(verifySeedCommitment(seedReveal, seedCommitment)).toBe(true);

      // 6) Inspección exhaustiva sobre el 100% de los sobres recibidos por los 4 clientes
      const audit = assertZeroInformationLeakageAcrossTranscript(clients);
      expect(audit.totalEnvelopesInspected).toBeGreaterThan(100);
      expect(audit.totalCardReferencesVerified).toBeGreaterThan(150);
    } finally {
      clients.forEach((c) => c.disconnect());
    }
  });
});
