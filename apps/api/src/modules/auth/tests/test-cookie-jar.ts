export interface ParsedSetCookie {
  readonly name: string;
  readonly value: string;
  readonly attributes: Readonly<Record<string, string | true>>;
  readonly raw: string;
}

export function parseSetCookieHeaders(header: string | string[] | undefined): ParsedSetCookie[] {
  if (!header) return [];
  const rawList = Array.isArray(header) ? header : [header];
  return rawList.map((raw) => {
    const segments = raw.split(';').map((s) => s.trim());
    const [first = '', ...attrSegments] = segments;
    const eqIdx = first.indexOf('=');
    const name = eqIdx >= 0 ? first.slice(0, eqIdx) : first;
    const value = eqIdx >= 0 ? decodeURIComponent(first.slice(eqIdx + 1)) : '';
    const attributes: Record<string, string | true> = {};
    for (const seg of attrSegments) {
      const idx = seg.indexOf('=');
      if (idx >= 0) {
        attributes[seg.slice(0, idx).toLowerCase()] = seg.slice(idx + 1);
      } else if (seg.length > 0) {
        attributes[seg.toLowerCase()] = true;
      }
    }
    return { name, value, attributes, raw };
  });
}

export function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter(([, val]) => val.length > 0)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');
}

export function extractAuthCookies(setCookieHeader: string | string[] | undefined): {
  parsed: ParsedSetCookie[];
  map: Record<string, string>;
} {
  const parsed = parseSetCookieHeaders(setCookieHeader);
  const map: Record<string, string> = {};
  for (const c of parsed) {
    map[c.name] = c.value;
  }
  return { parsed, map };
}
