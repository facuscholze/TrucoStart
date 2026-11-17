import { describe, expect, it } from 'vitest';
import {
  isIpAllowed,
  normalizeIp,
  parseAllowedNetworks,
  parseNetwork,
} from '../security/network-policy.js';
import { buildAdminRuntimeConfig } from '../admin.config.js';

describe('M8a — restricción del panel admin por red', () => {
  it('parsea IPv4 con prefijo y direcciones sueltas', () => {
    expect(parseNetwork('10.0.0.0/8')?.prefix).toBe(8);
    expect(parseNetwork('192.168.1.0/24')?.family).toBe(4);
    expect(parseNetwork('203.0.113.7')?.prefix).toBe(32);
    expect(parseNetwork(' 127.0.0.1 ')).not.toBeNull();
    expect(parseNetwork('10.0.0.0/33')).toBeNull();
    expect(parseNetwork('no-es-ip')).toBeNull();
    expect(parseNetwork('')).toBeNull();
  });

  it('parsea IPv6, incluido loopback y forma mapeada', () => {
    expect(parseNetwork('::1')?.family).toBe(6);
    expect(parseNetwork('::1')?.prefix).toBe(128);
    expect(parseNetwork('fd00::/8')?.prefix).toBe(8);
    expect(parseNetwork('2001:db8::/32')?.family).toBe(6);
    expect(parseNetwork('::ffff:192.168.0.0/120')?.family).toBe(6);
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('::ffff:10.1.2.3')).toBe('10.1.2.3');
  });

  it('permite todo cuando no hay redes configuradas', () => {
    expect(isIpAllowed('8.8.8.8', [])).toBe(true);
    expect(isIpAllowed(undefined, [])).toBe(true);
  });

  it('sólo permite IPs dentro de las redes declaradas', () => {
    const networks = parseAllowedNetworks(['10.0.0.0/8', '192.168.1.0/24', '::1', '203.0.113.7']);

    expect(isIpAllowed('10.20.30.40', networks)).toBe(true);
    expect(isIpAllowed('192.168.1.77', networks)).toBe(true);
    expect(isIpAllowed('203.0.113.7', networks)).toBe(true);
    expect(isIpAllowed('::1', networks)).toBe(true);
    // La forma mapeada de una IP permitida también entra.
    expect(isIpAllowed('::ffff:10.0.0.9', networks)).toBe(true);

    expect(isIpAllowed('192.168.2.10', networks)).toBe(false);
    expect(isIpAllowed('11.0.0.1', networks)).toBe(false);
    expect(isIpAllowed('203.0.113.8', networks)).toBe(false);
    expect(isIpAllowed('2001:db8::1', networks)).toBe(false);
    expect(isIpAllowed(undefined, networks)).toBe(false);
    expect(isIpAllowed('basura', networks)).toBe(false);
  });

  it('respeta el límite del prefijo en el borde de la red', () => {
    const networks = parseAllowedNetworks(['192.168.0.0/16']);
    expect(isIpAllowed('192.168.255.255', networks)).toBe(true);
    expect(isIpAllowed('192.169.0.0', networks)).toBe(false);
    expect(isIpAllowed('192.167.255.255', networks)).toBe(false);
  });

  it('construye la configuración desde ADMIN_ALLOWED_NETWORKS', () => {
    const previous = process.env['ADMIN_ALLOWED_NETWORKS'];
    process.env['ADMIN_ALLOWED_NETWORKS'] = '10.0.0.0/8, 172.16.0.0/12';
    try {
      const config = buildAdminRuntimeConfig();
      expect(config.allowedNetworks).toHaveLength(2);
      expect(isIpAllowed('172.20.0.5', config.allowedNetworks)).toBe(true);
      expect(isIpAllowed('8.8.8.8', config.allowedNetworks)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env['ADMIN_ALLOWED_NETWORKS'];
      else process.env['ADMIN_ALLOWED_NETWORKS'] = previous;
    }
  });

  it('un override explícito vacío deja el panel abierto (documentado)', () => {
    const config = buildAdminRuntimeConfig({ allowedNetworks: [] });
    expect(config.allowedNetworks).toHaveLength(0);
    expect(isIpAllowed('8.8.8.8', config.allowedNetworks)).toBe(true);
  });
});
