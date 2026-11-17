/**
 * Restricción del panel administrativo por IP / red privada.
 *
 * `ADMIN_ALLOWED_NETWORKS="10.0.0.0/8,192.168.0.0/16,203.0.113.7"` (vacío = sin restricción).
 * La comprobación se hace en el servidor en cada request del panel, antes de mirar la cookie:
 * aunque alguien robe una sesión, desde otra red no puede usarla.
 */

export interface ParsedNetwork {
  readonly raw: string;
  readonly family: 4 | 6;
  readonly bytes: readonly number[];
  readonly prefix: number;
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(value: string): number[] | null {
  const match = IPV4_PATTERN.exec(value);
  if (!match) return null;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets;
}

function parseIpv6(value: string): number[] | null {
  if (!value.includes(':')) return null;
  const withoutZone = value.split('%')[0] ?? value;
  const [head, tail] = withoutZone.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail !== undefined && tail !== '' ? tail.split(':').filter(Boolean) : [];
  if (withoutZone.split('::').length > 2) return null;

  const expandIpv4Tail = (parts: string[]): string[] | null => {
    if (parts.length === 0) return parts;
    const last = parts[parts.length - 1] ?? '';
    if (!last.includes('.')) return parts;
    const ipv4 = parseIpv4(last);
    if (!ipv4) return null;
    return [
      ...parts.slice(0, -1),
      ((ipv4[0]! << 8) | ipv4[1]!).toString(16),
      ((ipv4[2]! << 8) | ipv4[3]!).toString(16),
    ];
  };

  const headExpanded = expandIpv4Tail(headParts);
  const tailExpanded = expandIpv4Tail(tailParts);
  if (!headExpanded || !tailExpanded) return null;

  const missing = 8 - headExpanded.length - tailExpanded.length;
  if (missing < 0) return null;
  const groups =
    tail === undefined
      ? [...headExpanded, ...Array<string>(missing).fill('0')]
      : [...headExpanded, ...Array<string>(missing).fill('0'), ...tailExpanded];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    const parsed = Number.parseInt(group, 16);
    bytes.push((parsed >> 8) & 0xff, parsed & 0xff);
  }
  return bytes;
}

function parseAddress(value: string): { family: 4 | 6; bytes: number[] } | null {
  const ipv4 = parseIpv4(value);
  if (ipv4) return { family: 4, bytes: ipv4 };
  const ipv6 = parseIpv6(value);
  if (ipv6) return { family: 6, bytes: ipv6 };
  return null;
}

/** Acepta `10.0.0.0/8`, `::1`, `127.0.0.1`, con espacios tolerados. */
export function parseNetwork(raw: string): ParsedNetwork | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const [addressPart, prefixPart] = trimmed.split('/');
  const address = parseAddress((addressPart ?? '').trim());
  if (!address) return null;
  const maxPrefix = address.family === 4 ? 32 : 128;
  const prefix = prefixPart === undefined ? maxPrefix : Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return null;
  return { raw: trimmed, family: address.family, bytes: address.bytes, prefix };
}

export function parseAllowedNetworks(raw: readonly string[]): ParsedNetwork[] {
  return raw.map(parseNetwork).filter((network): network is ParsedNetwork => network !== null);
}

/** Normaliza la IP del request: `::ffff:127.0.0.1` se trata como IPv4. */
export function normalizeIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('::ffff:') && IPV4_PATTERN.test(value.slice(7))) return value.slice(7);
  return value;
}

function bytesMatch(candidate: readonly number[], network: ParsedNetwork): boolean {
  if (candidate.length !== network.bytes.length) return false;
  let remaining = network.prefix;
  for (let index = 0; index < candidate.length; index += 1) {
    if (remaining <= 0) return true;
    const bits = Math.min(8, remaining);
    const mask = bits === 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if (((candidate[index] ?? 0) & mask) !== ((network.bytes[index] ?? 0) & mask)) return false;
    remaining -= bits;
  }
  return true;
}

export function isIpAllowed(
  ip: string | undefined | null,
  networks: readonly ParsedNetwork[],
): boolean {
  if (networks.length === 0) return true;
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const address = parseAddress(normalized);
  if (!address) return false;
  return networks.some(
    (network) => network.family === address.family && bytesMatch(address.bytes, network),
  );
}
