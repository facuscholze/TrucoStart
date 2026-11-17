import { HealthResponseSchema, signWsAuthTicket, WsEnvelopeSchema } from '@truco/shared';
import { io as createClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer, type GameServerInstance } from '../src/server.js';

const TEST_SECRET = 'secreto-de-prueba-ws-autenticado-minimo-32-chars!!';

describe('@truco/game-server handshake auth, Zod validation & WS rate limit', () => {
  let server: GameServerInstance;
  let port = 0;

  beforeAll(async () => {
    server = createGameServer({
      appName: 'Mesa de Truco Test',
      sessionSecret: TEST_SECRET,
      seedEncryptionKey: TEST_SECRET,
      rateLimiter: { windowMs: 5_000, chatMax: 2, actionMax: 20, tableMax: 10 },
    });
    port = await server.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await server.close();
  });

  it('serves validated JSON health status at GET /health and 404 elsewhere', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.service).toBe('game-server');
    expect(body.status).toBe('ok');

    const res404 = await fetch(`http://127.0.0.1:${port}/inexistente`);
    expect(res404.status).toBe(404);
  });

  it('rejects unauthenticated WebSocket handshakes with UNAUTHORIZED', async () => {
    const unauthClient = createClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
    });

    try {
      const err = await new Promise<Error>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Esperaba connect_error')), 3_000);
        unauthClient.once('connect_error', (e) => {
          clearTimeout(timer);
          resolve(e);
        });
        unauthClient.once('connect', () => {
          clearTimeout(timer);
          reject(new Error('No debía conectar sin token'));
        });
      });
      expect(err.message).toBe('UNAUTHORIZED');
    } finally {
      unauthClient.disconnect();
    }
  });

  it('validates Zod envelopes/payloads and enforces per-category WS rate limits', async () => {
    const token = signWsAuthTicket(
      {
        jti: 'jti-val-single-use-01',
        userId: 'user-val-1',
        sessionId: 'sess-val-123456',
        nickname: 'Validador',
        exp: Date.now() + 60_000,
      },
      TEST_SECRET,
    );

    const client = createClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      auth: { token },
    });

    const waitNextEnvelope = () =>
      new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout esperando respuesta WS')), 4_000);
        client.once('envelope', (msg: unknown) => {
          clearTimeout(timer);
          resolve(msg);
        });
      });

    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', () => resolve());
        client.once('connect_error', reject);
      });

      // 1) Envelope malformado -> VALIDATION_ERROR
      const p1 = waitNextEnvelope();
      client.emit('envelope', { malformed: true });
      const r1 = WsEnvelopeSchema.parse(await p1);
      expect(r1.type).toBe('error');
      expect(r1.payload['code']).toBe('VALIDATION_ERROR');

      // 2) Payload inválido para tipo válido -> VALIDATION_ERROR
      const p2 = waitNextEnvelope();
      client.emit('envelope', {
        eventId: 'evt-bad-payload-1',
        ts: Date.now(),
        type: 'table.join',
        payload: { roomId: 'x' }, // menor a 3 chars
      });
      const r2 = WsEnvelopeSchema.parse(await p2);
      expect(r2.type).toBe('error');
      expect(r2.payload['code']).toBe('VALIDATION_ERROR');

      // 3) Rate limit específico de chat (chatMax = 2) -> el 3er envío devuelve RATE_LIMITED
      for (let i = 1; i <= 2; i++) {
        const pn = waitNextEnvelope();
        client.emit('envelope', {
          eventId: `evt-chat-rl-${i}`,
          ts: Date.now(),
          type: 'chat.quick',
          payload: { roomId: 'sala-no-existe', phraseId: 'buenas' },
        });
        await pn;
      }
      const pLimited = waitNextEnvelope();
      client.emit('envelope', {
        eventId: 'evt-chat-rl-3',
        ts: Date.now(),
        type: 'chat.quick',
        payload: { roomId: 'sala-no-existe', phraseId: 'buenas' },
      });
      const rLimited = WsEnvelopeSchema.parse(await pLimited);
      expect(rLimited.type).toBe('error');
      expect(rLimited.payload['code']).toBe('RATE_LIMITED');
    } finally {
      client.disconnect();
    }
  });

  it('enforces single-use WS tickets by rejecting any second handshake with the same jti', async () => {
    const singleUseToken = signWsAuthTicket(
      {
        jti: 'jti-single-use-replay-test-01',
        userId: 'user-replay-1',
        sessionId: 'sess-replay-123456',
        nickname: 'JugadorUnUso',
        exp: Date.now() + 60_000,
      },
      TEST_SECRET,
    );

    const firstClient = createClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: singleUseToken },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        firstClient.once('connect', () => resolve());
        firstClient.once('connect_error', reject);
      });
    } finally {
      firstClient.disconnect();
    }

    const replayClient = createClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: singleUseToken },
    });

    try {
      const err = await new Promise<Error>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Esperaba rechazo por replay')), 3_000);
        replayClient.once('connect_error', (e) => {
          clearTimeout(timer);
          resolve(e);
        });
        replayClient.once('connect', () => {
          clearTimeout(timer);
          reject(new Error('No debía permitir reutilizar un ticket WS ya consumido'));
        });
      });
      expect(err.message).toBe('UNAUTHORIZED');
    } finally {
      replayClient.disconnect();
    }
  });
});
