import { DEFAULT_RECONNECT_GRACE_MS } from '@truco/shared';
import { describe, expect, it } from 'vitest';
import { verifySeedCommitment } from '../src/security/commit-reveal.js';
import { createGameServer } from '../src/server.js';
import { InMemoryGameStore } from '../src/store/in-memory-game-store.js';
import {
  assertZeroInformationLeakageAcrossTranscript,
  TestWsClient,
} from './helpers/ws-test-client.js';

const TEST_SECRET = 'secreto-resiliencia-crash-recovery-m2-truco-32ch!';

describe('M2 Resilience: Crash Recovery from GameStore, Turn Timers, Grace Abandon & Active-Room Lock', () => {
  it('recovers an in-progress match seamlessly on a second server instance after simulated process crash', async () => {
    const sharedStore = new InMemoryGameStore();
    const roomId = 'mesa-crash-recovery-1v1';

    const server1 = createGameServer({
      store: sharedStore,
      sessionSecret: TEST_SECRET,
      seedEncryptionKey: TEST_SECRET,
      serverId: 'gs-node-1',
      ownerLeaseTtlMs: 80,
      defaultTurnTimeoutMs: 15_000,
      reconnectGraceMs: 15_000,
    });

    const port1 = await server1.listen(0, '127.0.0.1');

    const p0 = new TestWsClient({
      port: port1,
      secret: TEST_SECRET,
      userId: 'u-crash-0',
      nickname: 'Agustín',
      sessionId: 'sess-crash-agus-00',
      seat: 0,
      team: 0,
    });
    const p1 = new TestWsClient({
      port: port1,
      secret: TEST_SECRET,
      userId: 'u-crash-1',
      nickname: 'Camila',
      sessionId: 'sess-crash-cami-01',
      seat: 1,
      team: 1,
    });

    let server2: ReturnType<typeof createGameServer> | null = null;
    try {
      await Promise.all([p0.connectToPort(port1), p1.connectToPort(port1)]);

      p0.send('table.join', {
        roomId,
        mode: '1v1',
        rulesetCode: 'ar-corto-15-v1',
        preferredSeat: 0,
      });
      await p0.waitFor((e) => e.type === 'table.state', 'join p0');

      p1.send('table.join', { roomId, preferredSeat: 1 });
      await p1.waitFor((e) => e.type === 'table.state', 'join p1');

      for (const c of [p0, p1]) {
        c.send('table.ready', { roomId, ready: true });
      }

      const started = await p0.waitFor((e) => e.type === 'game.started', 'started en server1');
      await p0.waitFor((e) => e.type === 'game.turn', 'turno inicial p0');
      await p1.waitFor((e) => e.type === 'game.turn', 'turno inicial p1');
      const seedCommitment = started.payload['seedCommitment'] as string;

      // Avance parcial en server1: p0 juega su primera carta y el estado se persiste tras la acción
      const card0 = p0.latestView!.hand.myRemainingCards[0]!;
      p0.send('game.playCard', { roomId, cardId: card0.id });
      await p1.waitFor((e) => e.type === 'game.cardPlayed', 'primera carta persistida en server1');
      await p1.waitFor(
        (e) => e.type === 'game.turn' && e.payload['seat'] === 1,
        'turno de p1 antes del crash',
      );

      // Verificar que en el store el snapshot persiste el seed CIFRADO y nunca en texto plano
      const snapMidGame = await sharedStore.loadRoomSnapshot(roomId);
      expect(snapMidGame).not.toBeNull();
      expect(snapMidGame!.status).toBe('IN_GAME');
      expect(snapMidGame!.encryptedSeed).toBeTruthy();
      expect(snapMidGame!.revealedSeed).toBeNull();
      expect(snapMidGame!.gameState?.hand.activeSeat).toBe(1);

      const p0SeqBeforeCrash = p0.lastSeq;

      // SIMULAR CAÍDA ABRUPTA DE SERVER 1 (no libera lease ni borra estado del store)
      await server1.close({ simulateCrash: true });
      p0.disconnect();
      p1.disconnect();

      // Esperar que venza el TTL corto (80ms) del lease single-writer de gs-node-1
      await new Promise((r) => setTimeout(r, 110));

      // Levantar SERVER 2 conectado al mismo GameStore
      server2 = createGameServer({
        store: sharedStore,
        sessionSecret: TEST_SECRET,
        seedEncryptionKey: TEST_SECRET,
        serverId: 'gs-node-2',
        ownerLeaseTtlMs: 5_000,
        defaultTurnTimeoutMs: 15_000,
        reconnectGraceMs: 15_000,
      });
      const port2 = await server2.listen(0, '127.0.0.1');

      // Ambos jugadores reconectan contra server2 (p0 vía lastSeq y p1 vía resync lastSeq=0)
      await Promise.all([p0.connectToPort(port2), p1.connectToPort(port2)]);
      p0.send('game.rejoin', { roomId, sessionId: p0.sessionId, lastSeq: p0SeqBeforeCrash });
      p1.send('game.rejoin', { roomId, sessionId: p1.sessionId, lastSeq: 0 });

      await p0.waitFor(
        (e) => e.type === 'player.reconnected' && e.payload['seat'] === 0,
        'p0 reconectado en server2',
      );
      const resyncP1 = await p1.waitFor((e) => e.type === 'game.resync', 'p1 resync en server2');
      expect((resyncP1.payload['view'] as Record<string, unknown>)['mySeat']).toBe(1);
      await p1.waitFor(
        (e) => e.type === 'player.reconnected' && e.payload['seat'] === 1,
        'p1 reconectado en server2',
      );

      // Verificar que la partida continúa exactamente en el turno de p1 (seat 1) en server2
      expect(p1.latestView?.hand.activeSeat).toBe(1);
      const p1Card0 = p1.latestView!.hand.myRemainingCards[0]!;
      p1.send('game.playCard', { roomId, cardId: p1Card0.id });
      await p0.waitFor(
        (e) => e.type === 'game.cardPlayed' && e.payload['seat'] === 1,
        'jugada de p1 procesada por server2 recuperado',
      );

      // Cierre de partida por abandono voluntario (`table.leave`) para verificar que server2 descifró y revela el seed original
      p0.send('table.leave', { roomId });
      const ended = await p1.waitFor((e) => e.type === 'game.ended', 'fin de partida en server2');
      expect(ended.payload['winnerTeam']).toBe(1);
      expect(ended.payload['seedCommitment']).toBe(seedCommitment);
      expect(verifySeedCommitment(ended.payload['seedReveal'] as string, seedCommitment)).toBe(
        true,
      );

      assertZeroInformationLeakageAcrossTranscript([p0, p1]);
    } finally {
      p0.disconnect();
      p1.disconnect();
      if (server2) await server2.close();
      await sharedStore.close();
    }
  });

  it('emits pre-timeout warning (isWarning=true) and applies SYSTEM_TIMEOUT when active player does not act', async () => {
    const server = createGameServer({
      sessionSecret: TEST_SECRET,
      seedEncryptionKey: TEST_SECRET,
      defaultTurnTimeoutMs: 140,
      reconnectGraceMs: 10_000,
    });
    const port = await server.listen(0, '127.0.0.1');
    const roomId = 'mesa-turn-timeout';

    const p0 = new TestWsClient({
      port,
      secret: TEST_SECRET,
      userId: 'u-to-0',
      nickname: 'Lento',
      sessionId: 'sess-to-00000',
      seat: 0,
      team: 0,
    });
    const p1 = new TestWsClient({
      port,
      secret: TEST_SECRET,
      userId: 'u-to-1',
      nickname: 'Atento',
      sessionId: 'sess-to-00001',
      seat: 1,
      team: 1,
    });

    try {
      await Promise.all([p0.connectToPort(port), p1.connectToPort(port)]);
      p0.send('table.join', {
        roomId,
        mode: '1v1',
        rulesetCode: 'ar-corto-15-v1',
        preferredSeat: 0,
      });
      await p0.waitFor((e) => e.type === 'table.state', 'join p0');

      p1.send('table.join', { roomId, preferredSeat: 1 });
      await p1.waitFor((e) => e.type === 'table.state', 'join p1');

      for (const c of [p0, p1]) {
        c.send('table.ready', { roomId, ready: true });
      }

      await p1.waitFor((e) => e.type === 'game.turn', 'turno inicial mano');
      const warnEv = await p1.waitFor(
        (e) => e.type === 'game.turn' && e.payload['isWarning'] === true,
        'aviso previo de vencimiento de turno',
      );
      expect(warnEv.payload['seat']).toBe(0);

      const handEndedEv = await p1.waitFor(
        (e) => e.type === 'game.handEnded',
        'resolución automática por SYSTEM_TIMEOUT',
      );
      expect(handEndedEv.payload['winnerTeam']).toBe(1);
    } finally {
      p0.disconnect();
      p1.disconnect();
      await server.close();
    }
  });

  it('enforces 45s default grace config, triggers SYSTEM_ABANDON after grace expiration, and blocks multi-room join with CONFLICT', async () => {
    expect(DEFAULT_RECONNECT_GRACE_MS).toBe(45_000);

    const server = createGameServer({
      sessionSecret: TEST_SECRET,
      seedEncryptionKey: TEST_SECRET,
      defaultTurnTimeoutMs: 10_000,
      reconnectGraceMs: 120,
    });
    const port = await server.listen(0, '127.0.0.1');

    const p0 = new TestWsClient({
      port,
      secret: TEST_SECRET,
      userId: 'u-grace-0',
      nickname: 'DobleMesa',
      sessionId: 'sess-grace-000',
      seat: 0,
      team: 0,
    });
    const p1 = new TestWsClient({
      port,
      secret: TEST_SECRET,
      userId: 'u-grace-1',
      nickname: 'Firme',
      sessionId: 'sess-grace-001',
      seat: 1,
      team: 1,
    });

    try {
      await Promise.all([p0.connectToPort(port), p1.connectToPort(port)]);
      p0.send('table.join', {
        roomId: 'mesa-gracia-a',
        mode: '1v1',
        rulesetCode: 'ar-corto-15-v1',
        preferredSeat: 0,
      });
      await p0.waitFor((e) => e.type === 'table.state', 'join mesa A');

      // Intentar sentarse simultáneamente en otra sala activa -> CONFLICT
      p0.send('table.join', {
        roomId: 'mesa-gracia-b',
        mode: '1v1',
        rulesetCode: 'ar-corto-15-v1',
        preferredSeat: 0,
      });
      const conflictEv = await p0.waitFor((e) => e.type === 'error', 'rechazo CONFLICT');
      expect(conflictEv.payload['code']).toBe('CONFLICT');

      p1.send('table.join', { roomId: 'mesa-gracia-a', preferredSeat: 1 });
      await p1.waitFor((e) => e.type === 'table.state', 'join p1 mesa A');

      p0.send('table.ready', { roomId: 'mesa-gracia-a', ready: true });
      p1.send('table.ready', { roomId: 'mesa-gracia-a', ready: true });
      await p1.waitFor((e) => e.type === 'game.started', 'inicio partida gracia');

      // p0 se desconecta y NO vuelve antes de que venza el plazo de gracia (120ms en test)
      p0.disconnect();
      await p1.waitFor((e) => e.type === 'player.disconnected', 'aviso desconexión p0');

      const ended = await p1.waitFor((e) => e.type === 'game.ended', 'victoria por SYSTEM_ABANDON');
      expect(ended.payload['winnerTeam']).toBe(1);
      expect(ended.payload['reason']).toBe('ABANDON');
    } finally {
      p0.disconnect();
      p1.disconnect();
      await server.close();
    }
  });
});
