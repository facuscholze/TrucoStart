#!/usr/bin/env node
/**
 * Valida `infra/caddy/Caddyfile` sin Docker ni red (M8c).
 *
 * Comprueba, sobre el texto del archivo:
 *  1. que la política de IP real (`trusted_proxies static` + `client_ip_headers
 *     CF-Connecting-IP`) exista en el bloque `servers`, para que sólo se confíe
 *     en CF-Connecting-IP cuando el par TCP es un edge de Cloudflare;
 *  2. que 80/443 se listen y NO se publique ningún puerto de upstream;
 *  3. que cada subdominio (app, api, game, admin) apunte a su upstream interno;
 *  4. que no queden restos del terminador anterior (nginx :8443).
 *
 * La validación real de sintaxis la hace la imagen oficial en CI:
 *   docker run --rm -v "$PWD/infra/caddy:/etc/caddy" caddy:2.8-alpine \
 *     caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
 *
 * Uso: node scripts/check-caddyfile.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CADDYFILE = path.join(ROOT, 'infra/caddy/Caddyfile');
const COMPOSE = path.join(ROOT, 'infra/docker-compose.staging.yml');

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const caddyfile = readFileSync(CADDYFILE, 'utf8');
const compose = readFileSync(COMPOSE, 'utf8');

// 1. IP real del cliente detrás de Cloudflare.
check(
  /trusted_proxies\s+static/.test(caddyfile),
  'Falta `trusted_proxies static` en el bloque `servers` (política de IP real).',
);
check(
  /client_ip_headers\s+(?:CF-Connecting-IP|cf-connecting-ip)/i.test(caddyfile),
  'Falta `client_ip_headers CF-Connecting-IP`: Caddy debe reescribir la IP con esa cabecera.',
);
check(
  /TRUSTED_PROXY_CIDRS/.test(caddyfile),
  '`trusted_proxies static` debe alimentarse de TRUSTED_PROXY_CIDRS (rangos de Cloudflare).',
);
// Directiva peligrosa: confiaría en cabeceras de cualquier origen.
check(
  !/^\s*trusted_proxies\s+(?:all|0\.0\.0\.0\/0|::\/0)\s*$/m.test(caddyfile),
  '`trusted_proxies` no puede ser `all`/`0.0.0.0/0`: permitiría falsificar CF-Connecting-IP.',
);

// 2. Upstreams alcanzables sólo por la red interna.
for (const upstream of ['api:3001', 'game-server:3002', 'web:8080', 'admin:8080']) {
  check(
    new RegExp(`reverse_proxy\\s+${upstream.replace(/[.:]/g, '\\$&')}`).test(caddyfile),
    `Caddy no redirige a ${upstream}.`,
  );
}
check(
  !/:\b8443\b/.test(caddyfile),
  'El Caddyfile no debe usar el puerto 8443 (era del nginx anterior).',
);
check(
  !/nginx/.test(caddyfile),
  'El Caddyfile perimetral no debe referenciar nginx como terminador.',
);

// 3. Puertos publicados: Caddy sí, el resto no.
const caddyBlock = compose.split(/\n {2}caddy:\n/)[1] ?? '';
check(caddyBlock.length > 0, 'No existe el servicio `caddy` en el compose de staging.');
check(
  /'\$\{HTTPS_PORT:-443\}:443\/udp'|'\$\{HTTPS_PORT:-443\}:443'/.test(caddyBlock) &&
    /'\$\{HTTPS_PORT:-443\}:443'/.test(caddyBlock) &&
    /'\$\{HTTP_PORT:-80\}:80'/.test(caddyBlock),
  'El servicio `caddy` debe publicar 80 y 443 (con defaults 80/443).',
);
const blocks = compose.split(/^ {2}(\w[\w-]*):$/m);
// blocks: [prelude, name1, body1, name2, body2, ...]
const published = [];
for (let i = 1; i < blocks.length; i += 2) {
  const name = blocks[i];
  const body = blocks[i + 1] ?? '';
  if (/^\s{4}ports:/m.test(body)) published.push(name);
}
check(
  published.length === 1 && published[0] === 'caddy',
  `Sólo \`caddy\` debe publicar puertos en el host; publican: ${published.join(', ') || 'ninguno'}.`,
);
for (const upstream of ['api', 'game-server', 'web', 'admin', 'postgres', 'redis']) {
  const body = blocks[blocks.indexOf(upstream) + 1] ?? '';
  check(!/^\s{4}ports:/m.test(body), `El servicio \`${upstream}\` no debe publicar puertos.`);
}

// 4. El Caddyfile va montado de sólo lectura y con volumen persistente de ACME.
check(/Caddyfile:\/etc\/caddy\/Caddyfile:ro/.test(caddyBlock), 'El Caddyfile debe montarse :ro.');
check(
  /staging_caddy_data:\/data/.test(caddyBlock),
  'Falta el volumen persistente para certificados ACME.',
);

if (failures.length > 0) {
  console.error('Caddyfile/compose de staging inválidos:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Caddyfile OK: TLS en 80/443, 4 upstreams internos, trusted_proxies desde TRUSTED_PROXY_CIDRS, sin puertos upstream publicados.`,
  );
}
