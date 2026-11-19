#!/usr/bin/env node
/**
 * Prueba end-to-end de que un cliente no puede cambiar su IP con cabeceras (M8c).
 *
 * Corre contra un stack real (el compose de staging en CI o el VPS). Demuestra,
 * con el servicio REAL levantado, las dos propiedades que importan:
 *
 *   1. Camino del borde (a través de Caddy): `/v1/health` devuelve `clientIp`
 *      igual a la IP del socket del par TCP (127.0.0.1 si se consulta desde el
 *      host), NUNCA las cabeceras falsificadas que mandó el cliente. Esto prueba
 *      que el par no es un proxy confiable y que Caddy no reenvía la IP del
 *      cliente al borde cuando no viene de Cloudflare.
 *   2. Camino interno (directo a la API, simulando la red de Docker): la API
 *      confía en `X-Forwarded-For` SÓLO porque el socket está en
 *      TRUSTED_PROXY_CIDRS; si se apaga esa lista (app aislada) la cabecera se
 *      ignora por completo. Ese segundo caso lo cubre la suite de unitarios
 *      `apps/api/src/modules/health/tests/client-ip-spoofing.spec.ts`.
 *
 * Uso:
 *   node scripts/test-client-ip-spoofing.mjs                         # http://127.0.0.1:8080
 *   node scripts/test-client-ip-spoofing.mjs --url http://127.0.0.1:18080 --host api.localhost
 *   node scripts/test-client-ip-spoofing.mjs --url https://127.0.0.1:18443 --insecure
 *
 * Opciones:
 *   --url <baseUrl>   base (default http://127.0.0.1:8080)
 *   --host <name>     cabecera Host de un subdominio (Caddy enruta por Host)
 *   --insecure        acepta el certificado interno de Caddy (sólo CI/local)
 *
 * Salida: exit 0 si todas las comprobaciones pasan.
 */

const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const baseUrl = arg('--url', 'http://127.0.0.1:8080');
const hostHeader = arg('--host', null);
// El certificado interno de Caddy no es válido para 127.0.0.1; sólo se relaja en
// pruebas locales/CI (TLS contra el borde, nunca en producción).
if (args.includes('--insecure')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const FORGED = {
  'X-Forwarded-For': '203.0.113.9',
  'CF-Connecting-IP': '203.0.113.9',
  'X-Real-IP': '203.0.113.9',
  'True-Client-IP': '203.0.113.9',
  Forwarded: 'for=203.0.113.9',
};

const failures = [];
function check(condition, message, detail) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    failures.push(message);
  }
}

const target = new URL('/v1/health', baseUrl);
console.log(`\nObjetivo: ${target.href}${hostHeader ? ` (Host: ${hostHeader})` : ''}`);

/** GET con cabeceras falsificadas; devuelve el JSON o null. */
async function getHealth(extraHeaders = {}) {
  const headers = { ...FORGED, ...extraHeaders };
  if (hostHeader) headers.Host = hostHeader;
  const res = await fetch(target, { headers, redirect: 'manual' });
  const text = await res.text();
  if (!res.ok) return { status: res.status, body: null, text };
  try {
    return { status: res.status, body: JSON.parse(text), text };
  } catch {
    return { status: res.status, body: null, text };
  }
}

const first = await getHealth();
if (!first.body) {
  console.error(`\nNo se pudo leer /v1/health (status ${first.status}). ¿Está el stack levantado?`);
  console.error(first.text.slice(0, 400));
  process.exit(1);
}

// 1. La respuesta es un HealthResponse válido.
check(first.body.status === 'ok', 'GET /v1/health responde status=ok.');

// 2. `clientIp` existe y NO es la IP falsificada.
check(
  typeof first.body.clientIp === 'string' && first.body.clientIp.length > 0,
  'La respuesta incluye clientIp (origen resuelto por el servidor).',
);
for (const [name, value] of Object.entries(FORGED)) {
  check(
    first.body.clientIp !== '203.0.113.9',
    `La IP falsificada en ${name} no se refleja en clientIp.`,
    `clientIp=${first.body.clientIp}`,
  );
}

// 3. La IP resuelta es la del par TCP (host → 127.0.0.1, contenedor → IP de bridge).
const isLoopback = /^(127\.|::1$)/.test(first.body.clientIp);
const isPrivate = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(first.body.clientIp);
check(
  isLoopback || isPrivate,
  'clientIp es la IP del par TCP (loopback o red privada), no una IP pública falsa.',
  `clientIp=${first.body.clientIp}`,
);

// 4. Varias IPs públicas inventadas en la lista tampoco ganan.
const multi = await getHealth({ 'X-Forwarded-For': '203.0.113.9, 198.51.100.7, 192.0.2.1' });
check(
  multi.body?.clientIp === first.body.clientIp,
  'Una lista de varias IPs falsas tampoco cambia clientIp.',
  `clientIp=${multi.body?.clientIp}`,
);

// 5. Estabilidad: dos pedidos con cabeceras distintas dan el mismo origen.
const second = await getHealth({ 'X-Forwarded-For': '198.51.100.200' });
check(
  second.body?.clientIp === first.body.clientIp,
  'Cambiar las cabeceras entre pedidos no cambia el origen resuelto.',
);

// 6. Idempotencia de un pedido limpio: igual resultado sin cabeceras falsas.
const clean = await fetch(target, { headers: hostHeader ? { Host: hostHeader } : {} });
const cleanBody = await clean.json().catch(() => null);
check(
  cleanBody?.clientIp === first.body.clientIp,
  'Un pedido sin cabeceras falsas resuelve el mismo clientIp (no hay cabecera que lo altere).',
  `clientIp=${cleanBody?.clientIp}`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} comprobación(es) fallaron: el cliente PUDO alterar su IP.`);
  process.exit(1);
}
console.log(
  `\nIP real del cliente OK (${first.body.clientIp}): las cabeceras falsificadas no la alteran.`,
);
