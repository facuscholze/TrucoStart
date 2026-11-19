/**
 * Utilidades para parsear CIDRs de proxies confiables y extraer la IP real del
 * cliente de forma segura (ADR-020).
 *
 * Regla: sólo se confía en la cabecera de IP real si la IP remota que abre la
 * conexión pertenece a uno de los CIDRs en `trustedProxyCidrs`. En caso
 * contrario se devuelve la IP del socket, ignorando cualquier cabecera que
 * un cliente pudiera falsificar.
 *
 * Las direcciones IPv4 se normalizan al rango ::ffff:a.b.c.d/128 (IPv4-mapped)
 * para comparar con un solo espacio numérico; los CIDR en notación IPv4
 * (`a.b.c.d/n`) se convierten al prefijo equivalente 96+n en el espacio 128-bit.
 */

export interface ParsedCidr {
  /** Dirección de red como bigint en el espacio IPv4-mapped-IPv6 (128 bits). */
  readonly network: bigint;
  /** Máscara ya en el espacio 128-bit (96 + n para CIDRs IPv4). */
  readonly prefix128: number;
}

const IPV4_MAPPED = 0xffffn << 32n;
const IPV4_MAPPED_MASK = (1n << 32n) - 1n;

function parseIpv4(raw: string): bigint | null {
  const parts = raw.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return (
    IPV4_MAPPED |
    (BigInt(parts[0]!) << 24n) |
    (BigInt(parts[1]!) << 16n) |
    (BigInt(parts[2]!) << 8n) |
    BigInt(parts[3]!)
  );
}

/** Parsea una IP (v4 o "::ffff:a.b.c.d") a bigint 128-bit en el espacio mapped. */
export function parseIp(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // IPv4 puro.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return parseIpv4(trimmed);

  // IPv4-mapped-IPv6 que emite Node.js al detrás de un proxy: ::ffff:a.b.c.d
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  if (mapped) {
    const v4 = parseIpv4(mapped[1]!);
    return v4;
  }

  // No hay necesidad de IPv6 nativo para esta versión (Cloudflare y el proxy
  // de Nginx conectan por IPv4 en el MVP).
  return null;
}

/**
 * Parsea un CIDR IPv4 (`a.b.c.d/n`) o IPv4-mapped (`::ffff:a.b.c.d/n`).
 * Devuelve `network` ya enmascarada y `prefix128` en el espacio 128-bit.
 */
export function parseCidr(cidr: string): ParsedCidr | null {
  const [rawIp, rawPrefix] = cidr.trim().split('/');
  if (!rawIp) return null;
  const ip = parseIp(rawIp);
  if (ip === null) return null;
  let prefix = rawPrefix === undefined ? 32 : Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  prefix += 96; // al espacio 128-bit
  const mask = prefix === 0 ? 0n : ((1n << 128n) - 1n) << BigInt(128 - prefix);
  return { network: ip & mask, prefix128: prefix };
}

function mask(ip: bigint, prefix128: number): bigint {
  if (prefix128 <= 0) return 0n;
  return ip & (((1n << 128n) - 1n) << BigInt(128 - prefix128));
}

/** Devuelve true si `ipStr` pertenece al CIDR `range`. */
export function ipInCidr(ipStr: string, range: ParsedCidr): boolean {
  const ip = parseIp(ipStr);
  if (ip === null) return false;
  // Sólo se aceptan IPs en el rango IPv4-mapped de ::ffff:0:0/96.
  if ((ip & ~IPV4_MAPPED_MASK) !== IPV4_MAPPED) return false;
  return mask(ip, range.prefix128) === range.network;
}

/**
 * Extrae la IP real del cliente. Si la IP remota no es un proxy confiable,
 * ignora todas las cabeceras y devuelve la IP remota (anti-spoofing).
 */
export function resolveClientIp(params: {
  readonly remoteAddress: string | undefined;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly trustedCidrs: readonly ParsedCidr[];
  readonly headerName: string;
}): string {
  const remote = (params.remoteAddress ?? '').replace(/^::ffff:/, '');
  const remoteIp = parseIp(remote);
  const isTrusted =
    remoteIp !== null && params.trustedCidrs.some((c) => mask(remoteIp, c.prefix128) === c.network);

  if (!isTrusted) return remote || 'unknown';

  const raw = params.headers[params.headerName];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return remote || 'unknown';

  // x-forwarded-for puede ser "client, proxy1, proxy2": se toma la primera IP válida.
  for (const part of header.split(',')) {
    const candidate = part.trim().split(':')[0]!;
    if (parseIp(candidate) !== null) return candidate;
  }
  return remote || 'unknown';
}
