import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';

/**
 * ADR-020 / ADR-022: la IP del cliente sólo se toma de cabeceras de proxy cuando
 * el socket pertenece a un proxy confiable. Estos tests ejercitan la app real
 * (Fastify `request.ip`) con cabeceras falsificadas y distintas políticas de
 * proxy, para demostrar que un cliente no puede cambiar la IP que ve la app.
 */
describe('IP real del cliente: cabeceras falsificadas no cambian el origen', () => {
  const FORGED_HEADERS = {
    'x-forwarded-for': '203.0.113.9',
    'cf-connecting-ip': '203.0.113.9',
    'x-real-ip': '203.0.113.9',
    'true-client-ip': '203.0.113.9',
  };

  async function appWithCidrs(trustProxyCidrs: readonly string[]): Promise<NestFastifyApplication> {
    const app = await createApiApp({ trustProxyCidrs });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  }

  describe('sin proxies confiables (default de desarrollo)', () => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      app = await appWithCidrs([]);
    });
    afterAll(async () => {
      await app.close();
    });

    it('ignora X-Forwarded-For, CF-Connecting-IP y X-Real-IP', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/health', headers: FORGED_HEADERS });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { clientIp?: string };
      expect(body.clientIp).toBeDefined();
      expect(body.clientIp).not.toBe('203.0.113.9');
      // La IP del socket de `inject` es loopback.
      expect(body.clientIp).toBe('127.0.0.1');
    });
  });

  describe('con un CIDR confiable que NO incluye el socket', () => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      // Un rango público cualquiera: el socket de `inject` (127.0.0.1) queda fuera.
      app = await appWithCidrs(['198.51.100.0/24']);
    });
    afterAll(async () => {
      await app.close();
    });

    it('sigue usando la IP del socket aunque la conexión podría ser de un proxy', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/health', headers: FORGED_HEADERS });
      const body = res.json() as { clientIp?: string };
      expect(body.clientIp).not.toBe('203.0.113.9');
      expect(body.clientIp).toBe('127.0.0.1');
    });
  });

  describe('con el socket dentro de un CIDR confiable (detrás de Caddy)', () => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      app = await appWithCidrs(['127.0.0.0/8']);
    });
    afterAll(async () => {
      await app.close();
    });

    it('acepta la primera IP de X-Forwarded-For escrita por el proxy', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/health',
        headers: { 'x-forwarded-for': '198.51.100.7' },
      });
      const body = res.json() as { clientIp?: string };
      expect(body.clientIp).toBe('198.51.100.7');
    });

    it('una IP prependeada por el cliente no gana: se parsea de derecha a izquierda', async () => {
      // Ataque: el cliente manda XFF=203.0.113.9 y el proxy appendea la IP real.
      // Fastify parsea de derecha a izquierda y descarta los saltos de proxy, así
      // que la IP del cliente es la última, no la que prependeó el atacante.
      const res = await app.inject({
        method: 'GET',
        url: '/v1/health',
        headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' },
      });
      const body = res.json() as { clientIp?: string };
      expect(body.clientIp).toBe('198.51.100.7');
      expect(body.clientIp).not.toBe('203.0.113.9');
    });
  });
});
