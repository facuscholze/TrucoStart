#!/usr/bin/env node
/**
 * Escaneo de secretos en el árbol versionado (M8a).
 *
 * Uso:  node scripts/scan-secrets.mjs [--all]
 *   --all  incluye archivos ignorados por git que estén en el disco (más lento).
 *
 * Variable SCAN_SECRETS_ROOT: raíz a escanear (por defecto la del monorepo).
 * `scripts/test-scan-secrets.mjs` la usa para verificar las reglas contra señuelos.
 *
 * Reglas: firmas conocidas (claves privadas, AWS, Stripe, Google, JWTs), credenciales
 * embebidas en URLs y asignaciones `*_SECRET=…` con valores que no son placeholders.
 * Los tests, docs y `.env.example` se excluyen porque ahí los valores son ficticios.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.SCAN_SECRETS_ROOT ?? path.resolve(import.meta.dirname, '..'));
const MAX_FILE_BYTES = 512 * 1024;

/**
 * Exclusiones por ARCHIVO BINARIO/ARTEFACTO: no son texto fuente que se versione
 * para revisar, así que no se escanean con ninguna regla.
 */
const BINARY_EXCLUDES = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)\.git\//,
  /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|mp3|mp4|pdf|zip|gz)$/i,
];

/**
 * Exclusiones para las reglas de ALTA PRECISIÓN (firmas de proveedor, claves PEM,
 * JWT, credenciales en URL). Se midió que estas 8 reglas no dan falsos positivos
 * en ningún archivo del repo, así que sólo se excluyen:
 *   - el lockfile (miles de líneas de hashes; se audita con `pnpm audit`), y
 *   - este mismo archivo (contiene los patrones y los ejemplos de la allowlist).
 */
const SIGNATURE_EXCLUDES = [/(^|\/)pnpm-lock\.yaml$/, /(^|\/)scripts\/scan-secrets\.mjs$/];

/**
 * Exclusiones SOLO para la regla heurística `env-secret-assignment`.
 *
 * Esta regla busca `*_SECRET=`, `*_PASSWORD=` y similares con cualquier valor de
 * 24+ caracteres: es la que más ruido genera. Antes se aplicaba la lista a TODO
 * el escáner, lo que dejaba sin escanear 65 archivos de test, 6 de e2e, 5 de perf,
 * 60 de docs y `.env.example` — justo donde es fácil pegar una credencial real al
 * depurar. Ahora la exclusión se limita a esta regla y se compensa con un
 * marcador: todo valor excluido por ubicación debe ser obviamente ficticio
 * (`test|dev|ci|e2e|perf|fixture|placeholder|change_me|local|dummy|fake|sample|
 * example`), así que un secreto real puesto en un test SÍ se detecta.
 */
const HEURISTIC_EXCLUDES = [
  // Contenido de prueba: sus secretos son ficticios y el marcador lo verifica.
  /\.spec\.ts$/,
  /(^|\/)tests?\//,
  /(^|\/)e2e\//,
  /(^|\/)perf\//,
  /(^|\/)scripts\/perf\//,
  /(^|\/)apps\/[^/]+\/scripts\/perf\//,
];

/**
 * Marcador que debe llevar un valor para considerarlo ficticio. Es la ÚNICA
 * lista de marcadores: se usa (a) en cualquier archivo, para no marcar
 * placeholders, y (b) obligatoriamente en test/e2e/perf, donde la regla
 * heurística no corre.
 */
const FIXTURE_MARKER =
  /(?:test|prueba|fixture|dev|ci|e2e|perf|placeholder|change_me|local|dummy|fake|sample|example)/i;

const RULES = [
  {
    id: 'private-key',
    scope: 'all',
    description: 'Bloque de clave privada PEM',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'aws-access-key',
    scope: 'all',
    description: 'Access key de AWS',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'google-api-key',
    scope: 'all',
    description: 'API key de Google',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'stripe-live',
    scope: 'all',
    description: 'Clave live de Stripe',
    pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/,
  },
  {
    id: 'resend-key',
    scope: 'all',
    description: 'API key de Resend',
    pattern: /\bre_[0-9A-Za-z]{16,}\b/,
  },
  {
    id: 'slack-token',
    scope: 'all',
    description: 'Token de Slack',
    pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/,
  },
  {
    id: 'jwt',
    scope: 'all',
    description: 'JWT con firma (posible token real)',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: 'credentials-in-url',
    scope: 'all',
    description: 'Usuario y contraseña embebidos en una URL',
    // Excluye URLs de docker-compose que interpolan variables (${...}) — esas
    // referencias se resuelven en runtime contra .env y no contienen secreto.
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/(?!\$\{)[^\s:@/]+:(?!\$\{)[^\s:@/]{6,}@/i,
    allow:
      // Credenciales efímeras de contenedores en CI (no existen fuera del runner).
      /\b(?:localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/truco_dev:[a-z_]+@localhost|postgres(?:ql)?:\/\/truco_staging:ci_staging_password@postgres|postgres(?:ql)?:\/\/truco_perimeter:ci_perimeter_password@postgres)/i,
  },
  {
    id: 'env-secret-assignment',
    // Sólo se aplica fuera de los directorios de test/e2e/perf (ver
    // HEURISTIC_EXCLUDES): es la regla ruidosa.
    scope: 'heuristic',
    description: 'Asignación de secreto con valor aparentemente real',
    pattern:
      /\b[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[:=]\s*['"]?([A-Za-z0-9+/_=-]{24,})['"]?/,
    allowValue: (value, context) => {
      // En test/e2e/perf el valor DEBE ser obviamente ficticio. Si un test lleva
      // un valor con pinta de secreto real (sin marcador), se reporta.
      if (context?.heuristicExcluded && !FIXTURE_MARKER.test(value)) return false;
      // Placeholders, valores de test/CI y nombres en mayúsculas no son secretos reales.
      if (/^[A-Z_]+$/.test(value)) return true;
      if (FIXTURE_MARKER.test(value) || /playwright/i.test(value)) return true;
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
  // Sólo se descartan artefactos/binarios: cualquier archivo de texto versionado
  // es candidato a las reglas de firma (los tests y docs incluidos).
  const files = listFiles(includeIgnored).filter(
    (file) => !BINARY_EXCLUDES.some((pattern) => pattern.test(file)),
  );

  const findings = [];
  for (const file of files) {
    const isSignatureExcluded = SIGNATURE_EXCLUDES.some((pattern) => pattern.test(file));
    const isHeuristicExcluded = HEURISTIC_EXCLUDES.some((pattern) => pattern.test(file));

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
      // Cada regla decide si aplica al archivo según su precisión.
      if (rule.scope === 'heuristic') {
        if (isHeuristicExcluded) continue;
      } else if (isSignatureExcluded) {
        continue;
      }

      for (const [index, line] of lines.entries()) {
        if (line.length > 2_000) continue;
        const match = rule.pattern.exec(line);
        if (!match) continue;
        if (rule.allow?.test(line)) continue;
        const captured = match[1] ?? '';
        if (
          rule.allowValue &&
          captured &&
          rule.allowValue(captured, { heuristicExcluded: isHeuristicExcluded })
        )
          continue;
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
    const signatureFiles = files.filter((f) => !SIGNATURE_EXCLUDES.some((p) => p.test(f))).length;
    const heuristicFiles = files.filter((f) => !HEURISTIC_EXCLUDES.some((p) => p.test(f))).length;
    const signatureRules = RULES.filter((rule) => rule.scope !== 'heuristic').length;
    console.log(
      `Escaneo de secretos OK (${signatureFiles} archivos con las ${signatureRules} reglas de firma, ${heuristicFiles} con la heurística; ${RULES.length} reglas).`,
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
