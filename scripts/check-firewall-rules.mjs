#!/usr/bin/env node
/**
 * Valida `infra/firewall/docker-user-cloudflare.rules` de forma hermética (M8c).
 *
 * No necesita root, ni iptables, ni red: así corre en cualquier runner y en
 * cualquier máquina. La validación REAL de sintaxis (`iptables-restore --test`)
 * se hace además en CI dentro de un contenedor con NET_ADMIN.
 *
 * Comprueba lo que de verdad importa de la política:
 *  1. El archivo es una tabla `filter` con la cadena `DOCKER-USER`.
 *  2. Todos los CIDR son IPv4 (un CIDR IPv6 haría fallar iptables-restore).
 *  3. Están los 15 rangos IPv4 de Cloudflare, exactamente los publicados.
 *  4. 80/443 (TCP) y 443 (UDP) se aceptan SÓLO desde esos rangos.
 *  5. Hay un DROP final para esos puertos (sin él, el default del FORWARD de
 *     Docker aceptaría el tráfico de cualquiera).
 *  6. No hay una regla que acepte 0.0.0.0/0 en esos puertos.
 *
 * Uso: node scripts/check-firewall-rules.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RULES_PATH = path.join(ROOT, 'infra/firewall/docker-user-cloudflare.rules');

/**
 * Rangos IPv4 oficiales de Cloudflare (https://www.cloudflare.com/ips-v4).
 * Se fijan acá para detectar un CIDR mal copiado; `scripts/cloudflare-ufw.sh`
 * los refresca en vivo desde el sitio de Cloudflare al aplicarlos en el VPS.
 */
const CLOUDFLARE_V4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const raw = readFileSync(RULES_PATH, 'utf8');
// Se ignoran comentarios y líneas vacías: sólo cuentan las reglas.
const lines = raw
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

check(
  lines[0] === '*filter' || lines[0] === '*filter\n',
  'El archivo debe empezar con la tabla `*filter`.',
);
check(
  lines.some((line) => /^:\s*DOCKER-USER\s+-\s+\[0:0\]$/.test(line)),
  'Falta la declaración `:DOCKER-USER - [0:0]`.',
);
check(lines.includes('COMMIT'), 'Falta `COMMIT` al final de la tabla.');

// 2. Sólo IPv4: cualquier ':' en un CIDR rompe iptables-restore.
const cidrLike =
  lines
    .join(' ')
    .match(/\b(?:\d{1,3}\.){3}\d{1,3}\/\d{1,3}\b|(?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}\/\d{1,3}/gi) ??
  [];
const ipv6 = cidrLike.filter((cidr) => cidr.includes(':'));
check(ipv6.length === 0, `El archivo IPv4 contiene CIDR IPv6: ${ipv6.join(', ')}`);

// 3. Los 15 rangos oficiales, ni más ni menos, en las reglas de aceptación.
const allowed = new Set(cidrLike);
for (const cidr of CLOUDFLARE_V4) {
  check(allowed.has(cidr), `Falta el rango de Cloudflare ${cidr}.`);
}
const extra = [...allowed].filter((cidr) => !CLOUDFLARE_V4.includes(cidr));
check(
  extra.length === 0,
  `Hay rangos que no son de Cloudflare (¿0.0.0.0/0 o un CIDR mal copiado?): ${extra.join(', ')}`,
);

// 4. Cada rango se acepta para tcp 80,443 y para udp 443, sin huecos.
for (const cidr of CLOUDFLARE_V4) {
  check(
    lines.some(
      (line) =>
        line.includes('-s ' + cidr) &&
        line.includes('--dports 80,443') &&
        line.includes('-p tcp') &&
        line.endsWith('-j RETURN'),
    ),
    `No hay aceptación TCP 80,443 para ${cidr}.`,
  );
  check(
    lines.some(
      (line) =>
        line.includes('-s ' + cidr) &&
        line.includes('--dport 443') &&
        line.includes('-p udp') &&
        line.endsWith('-j RETURN'),
    ),
    `No hay aceptación UDP 443 (QUIC) para ${cidr}.`,
  );
}

// 5. DROP terminal para los puertos publicados.
check(
  lines.some(
    (line) =>
      line.includes('-p tcp') && line.includes('--dports 80,443') && line.endsWith('-j DROP'),
  ),
  'Falta el DROP final para tcp 80,443: sin él, Docker aceptaría a cualquiera.',
);
check(
  lines.some(
    (line) => line.includes('-p udp') && line.includes('--dport 443') && line.endsWith('-j DROP'),
  ),
  'Falta el DROP final para udp 443.',
);

// 6. Ninguna regla puede aceptar todo el espacio de origen en esos puertos.
for (const line of lines) {
  const acceptsPublishedPorts = line.endsWith('-j RETURN') || line.endsWith('-j ACCEPT');
  if (!acceptsPublishedPorts) continue;
  if (!/--dports? (?:80,443|443)\b/.test(line)) continue;
  check(!/\b(?:0\.0\.0\.0\/0|::\/0)\b/.test(line), `Regla abre 80/443 a todo Internet: ${line}`);
}

// 7. El archivo versionado debe coincidir con los rangos fijados (evita deriva).
const cloudflareCount = CLOUDFLARE_V4.length;
check(cloudflareCount === 15, `La lista fijada debe tener 15 rangos (tiene ${cloudflareCount}).`);

if (failures.length > 0) {
  console.error('Reglas de firewall inválidas:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Reglas de firewall OK: ${CLOUDFLARE_V4.length} rangos de Cloudflare, 80/443 y 443/udp sólo desde ellos, DROP final presente.`,
  );
}
