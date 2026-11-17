#!/usr/bin/env node
/**
 * Escaneo de secretos en el árbol versionado (M8a).
 *
 * Uso:  node scripts/scan-secrets.mjs [--all]
 *   --all  incluye archivos ignorados por git que estén en el disco (más lento).
 *
 * Reglas: firmas conocidas (claves privadas, AWS, Stripe, Google, JWTs), credenciales
 * embebidas en URLs y asignaciones `*_SECRET=…` con valores que no son placeholders.
 * Los tests, docs y `.env.example` se excluyen porque ahí los valores son ficticios.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAX_FILE_BYTES = 512 * 1024;

const EXCLUDED_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)\.git\//,
  /(^|\/)pnpm-lock\.yaml$/,
  /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|mp3|mp4|pdf|zip|gz)$/i,
  // Contenido de prueba, documentación y plantillas: los secretos ahí son ficticios.
  /\.spec\.ts$/,
  /(^|\/)tests?\//,
  /(^|\/)e2e\//,
  /\.md$/,
  /\.env\.example$/,
  /(^|\/)docs\//,
  /script.*scan-secrets\.mjs$/,
];

const RULES = [
  {
    id: 'private-key',
    description: 'Bloque de clave privada PEM',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'aws-access-key',
    description: 'Access key de AWS',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'google-api-key',
    description: 'API key de Google',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'stripe-live',
    description: 'Clave live de Stripe',
    pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/,
  },
  {
    id: 'resend-key',
    description: 'API key de Resend',
    pattern: /\bre_[0-9A-Za-z]{16,}\b/,
  },
  {
    id: 'slack-token',
    description: 'Token de Slack',
    pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/,
  },
  {
    id: 'jwt',
    description: 'JWT con firma (posible token real)',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: 'credentials-in-url',
    description: 'Usuario y contraseña embebidos en una URL',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]{6,}@/i,
    allow: /\b(?:localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/truco_dev:[a-z_]+@localhost)/i,
  },
  {
    id: 'env-secret-assignment',
    description: 'Asignación de secreto con valor aparentemente real',
    pattern:
      /\b[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[:=]\s*['"]?([A-Za-z0-9+/_=-]{24,})['"]?/,
    allowValue: (value) => {
      // Placeholders, valores de test/CI y nombres en mayúsculas no son secretos reales.
      if (/^[A-Z_]+$/.test(value)) return true;
      if (
        /(?:test|dev|ci|e2e|playwright|placeholder|change_me|local|dummy|fake|sample|example)/i.test(
          value,
        )
      ) {
        return true;
      }
      if (/^[a-z0-9_]+$/.test(value)) return true;
      // Heurística de entropía: sin mezcla de mayúsculas/dígitos/símbolos no es un secreto.
      const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value));
      return classes.length < 2;
    },
  },
];

function listFiles(includeIgnored) {
  if (includeIgnored) {
    const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return output.split('\n').filter(Boolean);
  }
  const output = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  return output.split('\n').filter(Boolean);
}

function main() {
  const includeIgnored = process.argv.includes('--all');
  const files = listFiles(includeIgnored).filter(
    (file) => !EXCLUDED_PATTERNS.some((pattern) => pattern.test(file)),
  );

  const findings = [];
  for (const file of files) {
    const absolute = path.join(ROOT, file);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      continue;
    }
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) continue;

    let content;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\u0000')) continue; // binario

    const lines = content.split('\n');
    for (const rule of RULES) {
      for (const [index, line] of lines.entries()) {
        if (line.length > 2_000) continue;
        const match = rule.pattern.exec(line);
        if (!match) continue;
        if (rule.allow?.test(line)) continue;
        const captured = match[1] ?? '';
        if (rule.allowValue && captured && rule.allowValue(captured)) continue;
        findings.push({
          rule: rule.id,
          description: rule.description,
          file,
          line: index + 1,
        });
      }
    }
  }

  if (findings.length === 0) {
    console.log(
      `Escaneo de secretos OK (${files.length} archivos versionados, ${RULES.length} reglas).`,
    );
    return;
  }

  console.error('Posibles secretos encontrados:');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.description} [${finding.rule}]`);
  }
  console.error(
    '\nSi es un valor de prueba, agregalo a la allowlist del script con criterio; si es real, rotalo y purgalo del historial.',
  );
  process.exitCode = 1;
}

main();
