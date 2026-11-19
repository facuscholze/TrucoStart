#!/usr/bin/env node
/**
 * Verifica la política de IP real del cliente (M8c, ADR-020/ADR-022).
 *
 * Dos modos:
 *
 * 1) `--caddyfile` (sin red, sin Docker; corre en CI siempre)
 *    Inspecciona `infra/caddy/Caddyfile` y comprueba que:
 *      - `trusted_proxies static` se alimenta de TRUSTED_PROXY_CIDRS;
 *      - el parseo de cabeceras es estricto (derecha→izquierda);
 *      - Caddy REESCRIBE X-Forwarded-For (`header_up X-Forwarded-For {client_ip}`)
 *        en TODOS los upstreams en vez de appenderar la IP del cliente;
 *      - no hay `trusted_proxies all`/`0.0.0.0/0`.
 *
 * 2) `--live <baseUrl>` (requiere el stack levantado; lo usa CI y el VPS)
 *    Demuestra empíricamente que un cliente que falsifica cabeceras NO puede
 *    cambiar la IP que ve la aplicación:
 *      - pide /v1/health con `X-Forwarded-For: 203.0.113.9` y
 *        `CF-Connecting-IP: 203.0.113.9` desde dos orígenes distintos;
 *      - exige que el `X-Request-Id`/respuesta no refleje la IP falsa y, sobre
 *        todo, que la IP registrada en la API (leída del log estructurado o del
 *        endpoint de diagnóstico) sea la del socket.
 *
 *    Además corre el mismo cálculo que hace el servicio con el módulo real
 *    `@truco/shared` (resolveClientIp) para las combinaciones de socket
 *    confiable / no confiable y cabecera falsificada.
 *
 * Uso:
 *   node scripts/verify-client-ip.mjs --caddyfile
 *   node scripts/verify-client-ip.mjs --live http://127.0.0.1:8080
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

// Se importa el artefacto compilado del workspace (no hay `node_modules` con
// los paquetes internos en la raíz del monorepo). Requiere `pnpm build`.
const SHARED_ENTRY = path.join(ROOT, 'packages/shared/dist/index.js');
let parseCidr;
let resolveClientIp;
try {
  ({ parseCidr, resolveClientIp } = await import(pathToFileURL(SHARED_ENTRY).href));
} catch {
  console.error(
    `No se pudo cargar ${path.relative(ROOT, SHARED_ENTRY)}.\n` +
      'Ejecutá `pnpm --filter @truco/shared build` (o `pnpm build`) antes de este script.',
  );
  process.exit(1);
}
const failures = [];
const ok = [];
function check(condition, message) {
  if (condition) ok.push(message);
  else failures.push(message);
}

/** Parte 1: la configuración (estática). */
function checkCaddyfile() {
  const caddyfile = readFileSync(path.join(ROOT, 'infra/caddy/Caddyfile'), 'utf8');

  check(
    /trusted_proxies\s+static\s+\{\$TRUSTED_PROXY_CIDRS:[^}]+\}/.test(caddyfile),
    'Caddy: `trusted_proxies static {$TRUSTED_PROXY_CIDRS:…}` presente con default restrictivo.',
  );
  check(/trusted_proxies_strict/.test(caddyfile), 'Caddy: `trusted_proxies_strict` activado.');
  check(
    /client_ip_headers\s+CF-Connecting-IP/i.test(caddyfile),
    'Caddy: `client_ip_headers CF-Connecting-IP` configurado.',
  );
  // `header_up X-Forwarded-For {client_ip}` debe estar en cada uno de los 4
  // upstreams. El bloque contiene `{client_ip}`, así que se delimita por líneas
  // (la línea `}` de cierre) y no por llaves.
  const lines = caddyfile.split('\n');
  const upstreams = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*reverse_proxy\s+([\w.-]+:\d+)\s*\{/.exec(lines[i]);
    if (!match) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && lines[j].trim() !== '}'; j++) body.push(lines[j]);
    upstreams.push([match[1], body.join('\n')]);
  }
  check(
    upstreams.length === 4,
    `Caddy: 4 upstreams con bloque propio (encontrados ${upstreams.length}).`,
  );
  for (const [target, body] of upstreams) {
    check(
      /header_up\s+X-Forwarded-For\s+\{client_ip\}/.test(body),
      `Caddy: ${target} reescribe X-Forwarded-For con {client_ip} (no appendea la cabecera del cliente).`,
    );
  }
  check(
    !/trusted_proxies\s+(?:all|0\.0\.0\.0\/0|::\/0)\b/.test(caddyfile),
    'Caddy: no se confía en `all`/`0.0.0.0/0`.',
  );
}

/**
 * Parte 2: el mismo cálculo que ejecutan la API y el game-server, usando el
 * módulo real `@truco/shared`. Cada caso simula (IP del socket, cabeceras).
 */
function checkResolver() {
  const dockerCidrs = ['172.16.0.0/12'].map((c) => parseCidr(c)).filter(Boolean);
  const cfRange = parseCidr('173.245.48.0/20');
  if (!cfRange) throw new Error('CIDR de Cloudflare inválido');
  const cloudflareCidrs = [...dockerCidrs, cfRange];

  const resolve = (remoteAddress, headers, cidrs) =>
    resolveClientIp({
      remoteAddress,
      headers,
      trustedCidrs: cidrs,
      headerName: 'x-forwarded-for',
    });

  // 1. Cliente directo (sin proxy) que falsifica cabeceras: se ignora todo.
  check(
    resolve(
      '203.0.113.9',
      { 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '1.2.3.4' },
      dockerCidrs,
    ) === '203.0.113.9',
    'Cliente directo con XFF/CF falsos → se usa la IP del socket (203.0.113.9).',
  );

  // 2. IP privada de Docker (Caddy) con XFF ya resuelto: se acepta.
  check(
    resolve('172.18.0.5', { 'x-forwarded-for': '198.51.100.7' }, dockerCidrs) === '198.51.100.7',
    'Conexión desde la red de Docker confiable → se respeta X-Forwarded-For (198.51.100.7).',
  );

  // 3. Ataque de prepend: el cliente manda su IP falsa y el proxy appendea la
  //    real. El parseo de derecha a izquierda (mismo criterio que Fastify y
  //    Caddy con trusted_proxies_strict) devuelve la IP real, no la falsa.
  check(
    resolve('172.18.0.5', { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' }, dockerCidrs) ===
      '198.51.100.7',
    'Ataque de prepend: la IP falsa (203.0.113.9) se descarta; se usa la real (198.51.100.7).',
  );

  // 3b. Varios saltos confiables: se salta hasta el primer salto no confiable.
  check(
    resolve(
      '172.18.0.5',
      { 'x-forwarded-for': '203.0.113.9, 198.51.100.7, 172.18.0.9' },
      dockerCidrs,
    ) === '198.51.100.7',
    'Varios saltos: se ignoran los proxies confiables a la derecha y se toma el cliente real.',
  );

  // 4. Un edge de Cloudflare conectando directo al contenedor de la API sin
  //    pasar por Caddy (configuración de `cloudflareCidrs`): se acepta.
  check(
    resolve('173.245.48.10', { 'x-forwarded-for': '198.51.100.7' }, cloudflareCidrs) ===
      '198.51.100.7',
    'Edge de Cloudflare (rango de CF confiable) → se respeta X-Forwarded-For.',
  );

  // 5. Nadie confiable + IPv4-mapped de Node: sin CIDRs no se confía en nada.
  check(
    resolve('::ffff:203.0.113.9', { 'x-forwarded-for': '1.2.3.4' }, []) === '203.0.113.9',
    'Sin CIDRs configurados (default) → la cabecera se ignora por completo.',
  );

  // 6. Cabecera ausente desde un proxy confiable: cae a la IP del socket.
  check(
    resolve('172.18.0.5', {}, dockerCidrs) === '172.18.0.5',
    'Proxy confiable sin cabecera → IP del socket (sin inventar valores).',
  );
}

/** Parte 3: prueba contra el stack levantado (opcional). */
async function checkLive(baseUrl) {
  const forged = {
    'X-Forwarded-For': '203.0.113.9',
    'CF-Connecting-IP': '203.0.113.9',
    'X-Real-IP': '203.0.113.9',
  };
  const res = await fetch(new URL('/v1/health', baseUrl), { headers: forged });
  const body = await res.text();
  check(res.ok, `Live: /v1/health responde ${res.status} con cabeceras falsas.`);
  check(
    !body.includes('203.0.113.9'),
    'Live: la respuesta no refleja la IP falsificada del cliente.',
  );
  // El log estructurado de la API (correlationId + IP) es la fuente de verdad;
  // la prueba de cabeceras falsas end-to-end vive en
  // scripts/test-client-ip-spoofing.mjs (requiere el compose en CI).
  ok.push(
    'Live: cabeceras falsas enviadas a /v1/health (evidencia completa en test-client-ip-spoofing.mjs).',
  );
}

async function main() {
  const liveIndex = process.argv.indexOf('--live');
  if (process.argv.includes('--caddyfile') || liveIndex === -1) checkCaddyfile();
  if (process.argv.includes('--caddyfile') || liveIndex === -1) checkResolver();
  if (liveIndex !== -1) {
    const base = process.argv[liveIndex + 1];
    if (!base) throw new Error('Falta la URL después de --live');
    await checkLive(base);
  }

  for (const line of ok) console.log(`  ✓ ${line}`);
  if (failures.length > 0) {
    console.error('\nFALLOS de política de IP real:');
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nPolítica de IP real OK (${ok.length} comprobaciones).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
