#!/usr/bin/env node
/**
 * Verifica que los bundles de producción de web y admin no incluyan secretos de servidor
 * ni datos de demo (M8a). Se corre en CI después de `pnpm build`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BUNDLES = [
  { name: '@truco/web', dir: path.join(ROOT, 'apps/web/dist') },
  { name: '@truco/admin', dir: path.join(ROOT, 'apps/admin/dist') },
];

// Sólo valores: los nombres de variables aparecen legítimamente en el esquema de entorno
// que valida el cliente y no exponen nada.
const FORBIDDEN = [
  {
    id: 'secret-with-value',
    pattern:
      /\b(?:SESSION_SECRET|INTERNAL_RPC_SECRET|ADMIN_TOTP_ENCRYPTION_KEY|SEED_ENCRYPTION_KEY|METRICS_TOKEN)\b\s*[:=]\s*['"][^'"\s]{16,}['"]/,
    description: 'secreto asignado con valor en el bundle',
  },
  {
    id: 'db-url',
    pattern: /postgres(?:ql)?:\/\/[^\s'"]+:[^\s'"]+@/,
    description: 'URL de base con credenciales',
  },
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
    description: 'clave privada',
  },
  { id: 'aws-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, description: 'access key de AWS' },
  {
    id: 'stripe-live',
    pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/,
    description: 'clave live de Stripe',
  },
  {
    id: 'resend-key',
    pattern: /\bre_[0-9A-Za-z]{16,}\b/,
    description: 'API key de Resend',
  },
];

function listFiles(dir) {
  const output = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const absolute = path.join(current, entry);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else output.push(absolute);
    }
  };
  walk(dir);
  return output;
}

const findings = [];
for (const bundle of BUNDLES) {
  if (!existsSync(bundle.dir)) {
    console.error(
      `Falta el build de ${bundle.name} (${bundle.dir}). Corré \`pnpm build\` primero.`,
    );
    process.exitCode = 1;
    continue;
  }
  for (const file of listFiles(bundle.dir)) {
    if (!/\.(?:js|mjs|css|html|webmanifest|json)$/i.test(file)) continue;
    const content = readFileSync(file, 'utf8');
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(content)) {
        findings.push({ bundle: bundle.name, file: path.relative(ROOT, file), rule: rule.id });
      }
    }
  }
}

if (findings.length === 0) {
  console.log(`Bundles sin secretos ni datos de demo (${BUNDLES.map((b) => b.name).join(', ')}).`);
} else {
  console.error('Hallazgos en bundles de producción:');
  for (const finding of findings) {
    console.error(`  ${finding.bundle} ${finding.file} — ${finding.rule}`);
  }
  process.exitCode = 1;
}
