import { signWsAuthTicket } from '@truco/shared';
import { io as createClient } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameServer, type GameServerInstance } from '../src/server.js';

const TEST_SECRET = 'secreto-proxy-trust-test-32-chars-min!!';

/**
 * Test de integración de la resolución de IP con proxies confiables (ADR-020).
 *
 * Verifica dos escenarios:
 *  1. Si no hay proxies confiables configurados, un cliente que envía
 *     `X-Forwarded-For` no puede falsear su IP para esquivar el límite por IP.
 *  2. Si la conexión viene de un CIDR confiable (en estos tests, el propio
 *     loopback 127.0.0.1/32), la IP real se toma de la cabecera configurada
 *     y sí se aplican límites sobre esa IP real.
 */
describe('@truco/game-server trusted-proxy IP resolution (ADR-020)', () => {
  let server: GameServerInstance;
  let port = 0;
  const liveClients: ReturnType<typeof createClient>[] = [];

  afterEach(async () => {
    for (const c of liveClients) c.disconnect();
    liveClients.length = 0;
    await server?.close();
  });

  function connectWith(overrides: {
    readonly tokenUserId: string;
    readonly extraHeaders?: Record<string, string>;
  }): Promise<{ client: ReturnType<typeof createClient>; ip: string }> {
    const token = signWsAuthTicket(
      {
        jti: `jti-${overrides.tokenUserId}-${Math.random().toString(36).slice(2)}`,
        userId: overrides.tokenUserId,
        sessionId: `sess-${overrides.tokenUserId}-abcdefgh`,
        nickname: `user-${overrides.tokenUserId}`,
        exp: Date.now() + 60_000,
      },
      TEST_SECRET,
    );
    const client = createClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      auth: { token },
      extraHeaders: overrides.extraHeaders,
    });
    liveClients.push(client);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout esperando conexión/error')), 4_000);
      client.once('connect', () => {
        clearTimeout(timer);
        // Leer la IP que el server le asignó desde el socket via un evento interno:
        // tiramos de la data del socket exponiéndola por medio de un emit de prueba.
        const sock = server.io.sockets.sockets.get(client.id!);
        resolve({ client, ip: sock?.data?.ip ?? 'unknown' });
      });
      client.once('connect_error', (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  describe('sin proxies confiables (default)', () => {
    beforeEach(async () => {
      server = createGameServer({
        appName: 'Trust-Proxy Test',
        sessionSecret: TEST_SECRET,
        seedEncryptionKey: TEST_SECRET,
        // Límite estricto para forzar el comportamiento.
        maxConnectionsPerIp: 1,
        maxConnectionsPerUser: 20,
      });
      port = await server.listen(0, '127.0.0.1');
    });

    it('un cliente que falsifica X-Forwarded-For NO puede eludir el límite por IP', async () => {
      // Primera conexión (sin cabecera) debería funcionar. La IP remota es
      // 127.0.0.1 (loopback); el límite es 1 por IP.
      const c1 = await connectWith({ tokenUserId: 'u1' });
      expect(c1.ip).toBe('127.0.0.1');

      // Segunda conexión intentando falsear IP 10.0.0.99 vía X-Forwarded-For.
      // Como 127.0.0.1 NO está en TRUSTED_PROXY_CIDRS, la cabecera debe
      // ignorarse y la IP vista sigue siendo 127.0.0.1 → límite alcanzado.
      await expect(
        connectWith({ tokenUserId: 'u2', extraHeaders: { 'x-forwarded-for': '10.0.0.99' } }),
      ).rejects.toMatchObject({ message: 'TOO_MANY_CONNECTIONS_FROM_IP' });
    });
  });

  describe('con loopback como proxy confiable (127.0.0.1/32)', () => {
    beforeEach(async () => {
      server = createGameServer({
        appName: 'Trust-Proxy Test',
        sessionSecret: TEST_SECRET,
        seedEncryptionKey: TEST_SECRET,
        maxConnectionsPerIp: 1,
        maxConnectionsPerUser: 20,
        trustedProxyCidrs: ['127.0.0.1/32'],
        trustedProxyHeader: 'x-forwarded-for',
      });
      port = await server.listen(0, '127.0.0.1');
    });

    it('toma la IP real de X-Forwarded-For cuando la conexión viene de un proxy confiable', async () => {
      const c1 = await connectWith({
        tokenUserId: 'u1',
        extraHeaders: { 'x-forwarded-for': '203.0.113.5' },
      });
      expect(c1.ip).toBe('203.0.113.5');
    });

    it('el límite por IP se aplica sobre la IP real de X-Forwarded-For (no sobre la IP del proxy)', async () => {
      const c1 = await connectWith({
        tokenUserId: 'u1',
        extraHeaders: { 'x-forwarded-for': '198.51.100.7' },
      });
      expect(c1.ip).toBe('198.51.100.7');

      // Otro cliente con MISMA IP spoofeada pero distinto userId → bloqueado.
      await expect(
        connectWith({
          tokenUserId: 'u2',
          extraHeaders: { 'x-forwarded-for': '198.51.100.7' },
        }),
      ).rejects.toMatchObject({ message: 'TOO_MANY_CONNECTIONS_FROM_IP' });

      // Otro cliente con DISTINTA IP real en X-Forwarded-For → se conecta.
      const c3 = await connectWith({
        tokenUserId: 'u3',
        extraHeaders: { 'x-forwarded-for': '203.0.113.5' },
      });
      expect(c3.ip).toBe('203.0.113.5');
    });

    it('X-Forwarded-For con múltiples IPs toma la primera (cliente más a la izquierda)', async () => {
      const c = await connectWith({
        tokenUserId: 'u4',
        extraHeaders: { 'x-forwarded-for': '203.0.113.42, 10.0.0.1, 127.0.0.1' },
      });
      expect(c.ip).toBe('203.0.113.42');
    });

    it('cabecera ausente → cae a la IP remota (127.0.0.1)', async () => {
      const c = await connectWith({ tokenUserId: 'u5' });
      expect(c.ip).toBe('127.0.0.1');
    });
  });
});
