import { HealthResponseSchema, WsEnvelopeSchema } from '@truco/shared';
import { io as createClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer, type GameServerInstance } from '../src/server.js';

describe('@truco/game-server bootstrap & envelope validation (M0)', () => {
  let server: GameServerInstance;
  let port = 0;

  beforeAll(async () => {
    server = createGameServer({ appName: 'Mesa de Truco Test' });
    port = await server.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await server.close();
  });

  it('serves validated JSON health status at GET /health', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.service).toBe('game-server');
    expect(body.status).toBe('ok');
  });

  it('rejects malformed WebSocket envelopes with a standardized error envelope', async () => {
    const client = createClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
    });

    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout esperando respuesta WS')), 4000);
        client.once('envelope', (msg: unknown) => {
          clearTimeout(timer);
          resolve(msg);
        });
        client.once('connect_error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        client.emit('envelope', { malformed: true });
      });

      const parsed = WsEnvelopeSchema.parse(response);
      expect(parsed.type).toBe('error');
      expect(parsed.payload['code']).toBe('VALIDATION_ERROR');
    } finally {
      client.disconnect();
    }
  });
});
