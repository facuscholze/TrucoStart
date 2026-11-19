import { describe, expect, it } from 'vitest';
import { ipInCidr, parseCidr, parseIp, resolveClientIp } from '../src/network/cidr.js';

describe('shared/network/cidr — CIDR parsing and trusted-proxy IP resolution (ADR-020)', () => {
  it('parses IPv4 addresses as IPv4-mapped IPv6 bigints', () => {
    const a = parseIp('192.168.1.1');
    expect(a).not.toBeNull();
    expect(parseIp('256.0.0.1')).toBeNull();
    expect(parseIp('abc')).toBeNull();
    // ::ffff:10.0.0.1 debe normalizarse al mismo valor que 10.0.0.1.
    expect(parseIp('::ffff:10.0.0.1')).toBe(parseIp('10.0.0.1'));
  });

  it('matches IPv4 addresses against /24 and /32 CIDRs', () => {
    const block24 = parseCidr('10.0.0.0/24');
    expect(block24).not.toBeNull();
    expect(ipInCidr('10.0.0.1', block24!)).toBe(true);
    expect(ipInCidr('10.0.0.255', block24!)).toBe(true);
    expect(ipInCidr('10.0.1.1', block24!)).toBe(false);

    const single = parseCidr('127.0.0.1/32');
    expect(ipInCidr('127.0.0.1', single!)).toBe(true);
    expect(ipInCidr('127.0.0.2', single!)).toBe(false);
  });

  it('ignores x-forwarded-for when the remote address is NOT a trusted proxy', () => {
    const cidrs = [parseCidr('10.0.0.0/8')!];
    const ip = resolveClientIp({
      remoteAddress: '203.0.113.7',
      headers: { 'x-forwarded-for': '1.2.3.4' },
      trustedCidrs: cidrs,
      headerName: 'x-forwarded-for',
    });
    // Se ignora la cabecera (spoofeable).
    expect(ip).toBe('203.0.113.7');
  });

  it('trusts x-forwarded-for only when remote IP is inside trusted CIDRs', () => {
    const cidrs = [parseCidr('10.0.0.0/8')!, parseCidr('192.168.0.0/16')!];
    const ip = resolveClientIp({
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '203.0.113.42, 10.0.0.5' },
      trustedCidrs: cidrs,
      headerName: 'x-forwarded-for',
    });
    expect(ip).toBe('203.0.113.42');
  });

  it('supports configurable header name (e.g. CF-Connecting-IP)', () => {
    const cidrs = [parseCidr('172.16.0.0/12')!];
    const ip = resolveClientIp({
      remoteAddress: '172.16.0.1',
      headers: {
        'x-forwarded-for': '1.2.3.4',
        'cf-connecting-ip': '198.51.100.7',
      },
      trustedCidrs: cidrs,
      headerName: 'cf-connecting-ip',
    });
    expect(ip).toBe('198.51.100.7');
  });

  it('parsea XFF de derecha a izquierda: una IP prependeada por el cliente no gana (M8c)', () => {
    const cidrs = [parseCidr('172.16.0.0/12')!];
    // El cliente manda "203.0.113.9" como X-Forwarded-For; Caddy (proxy confiable)
    // appendea la IP real del socket. La IP del cliente debe ser la ÚLTIMA, no la
    // primera que prependeó el atacante.
    const ip = resolveClientIp({
      remoteAddress: '172.18.0.5',
      headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' },
      trustedCidrs: cidrs,
      headerName: 'x-forwarded-for',
    });
    expect(ip).toBe('198.51.100.7');
  });

  it('salta varios saltos confiables hasta el primer no confiable por la derecha', () => {
    const cidrs = [parseCidr('10.0.0.0/8')!, parseCidr('172.16.0.0/12')!];
    const ip = resolveClientIp({
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '1.1.1.1, 198.51.100.7, 172.18.0.2, 10.0.0.9' },
      trustedCidrs: cidrs,
      headerName: 'x-forwarded-for',
    });
    // 10.0.0.9 y 172.18.0.2 son proxies confiables; 198.51.100.7 es el cliente.
    expect(ip).toBe('198.51.100.7');
  });

  it('cae a la IP del socket si todos los saltos son proxies confiables', () => {
    const cidrs = [parseCidr('10.0.0.0/8')!];
    const ip = resolveClientIp({
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '10.0.0.6, 10.0.0.7' },
      trustedCidrs: cidrs,
      headerName: 'x-forwarded-for',
    });
    expect(ip).toBe('10.0.0.5');
  });

  it('falls back to remote IP when header is missing/invalid even from a trusted proxy', () => {
    const cidrs = [parseCidr('10.0.0.0/8')!];
    const ip = resolveClientIp({
      remoteAddress: '10.1.2.3',
      headers: {},
      trustedCidrs: cidrs,
      headerName: 'x-forwarded-for',
    });
    expect(ip).toBe('10.1.2.3');
  });
});
