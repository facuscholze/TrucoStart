#!/usr/bin/env node
/**
 * Test del escáner de secretos con señuelos (M8c).
 *
 * Prueba las DOS direcciones que importan:
 *   1. Cada regla DETECTA un señuelo con el formato del secreto real
 *      (falso positivo evitable) → el escáner no debe ser ciego.
 *   2. Los placeholders legítimos (.env.example, valores de test/CI, variables
 *      de docker-compose) NO se marcan → el escáner no debe ser inservible.
 *
 * Se corre en un directorio temporal para no depender del árbol versionado y se
 * ejecuta el escáner real (`scripts/scan-secrets.mjs`) con SCAN_SECRETS_ROOT.
 *
 * Uso: node scripts/test-scan-secrets.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCANNER = path.join(ROOT, 'scripts/scan-secrets.mjs');

/**
 * Los literales se arman en runtime con `join('')` para que ESTE archivo no
 * contenga el secreto completo (si no, el escáner del repo lo marcaría). El
 * archivo señuelo que se escribe en el temp dir sí tiene el literal completo,
 * que es lo que la regla debe detectar.
 */
const join = (...parts) => parts.join('');
const DECOYS = [
  {
    name: 'private-key',
    rule: 'private-key',
    file: 'src/key.ts',
    content: `const k = "${join('-----BEGIN ', 'RSA PRIVATE', ' KEY-----')}";`,
  },
  {
    name: 'aws-access-key',
    rule: 'aws-access-key',
    file: 'src/aws.ts',
    content: `const id = "${join('AKIA', 'IOSFODNN7EXAMPL', 'E')}";`,
  },
  {
    name: 'google-api-key',
    rule: 'google-api-key',
    file: 'src/google.ts',
    content: `const key = "${join('AIza', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q')}";`,
  },
  {
    name: 'stripe-live',
    rule: 'stripe-live',
    file: 'src/pay.ts',
    content: `const sk = "${join('sk', '_live_', '4eC39HqLyjWDarjtT1zdp7dc')}";`,
  },
  {
    name: 'resend-key',
    rule: 'resend-key',
    file: 'src/mail.ts',
    content: `const r = "${join('re', '_9kLm3nOp5qRs7tUv1wXy')}";`,
  },
  {
    name: 'slack-token',
    rule: 'slack-token',
    file: 'src/slack.ts',
    content: `const t = "${join('xox', 'b-', '1234567890-abcdefghijkl')}";`,
  },
  {
    name: 'jwt',
    rule: 'jwt',
    file: 'src/token.ts',
    content: `const jwt = "${join('eyJ', 'hbGciOiJIUzI1NiJ9')}.${join('eyJzdWIiOiIxMjM0NTY3ODkwIn0')}.${join('dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')}";`,
  },
  {
    name: 'credentials-in-url',
    rule: 'credentials-in-url',
    file: 'src/db.ts',
    content: `const url = "postgres://admin:Xk9mP2qL7vR4@db.internal:5432/app";`,
  },
  {
    name: 'env-secret-assignment',
    rule: 'env-secret-assignment',
    file: 'src/config.ts',
    content: `const SESSION_SECRET = "Zq8vN3xT5wR2yK7mL4pJ9hG6fD1sA0bC";`,
  },
];

/** Contenido que NO debe disparar ninguna regla. */
const PLACEHOLDERS = [
  {
    file: '.env.example',
    content: 'SESSION_SECRET=replace_with_32_plus_char_session_secret_placeholder\n',
  },
  {
    file: 'src/docker-compose.ts',
    content:
      'DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}\n',
  },
  {
    file: 'src/ci.ts',
    content: 'SESSION_SECRET=ci_test_session_secret_at_least_32_characters_long\n',
  },
  { file: 'src/local.ts', content: 'const PASSWORD = "change_me_local_pg_password";\n' },
  { file: 'src/compose.ts', content: 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}\n' },
  { file: 'docs/example.md', content: 'RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxx\n' },
  {
    file: 'src/tests/fixture.spec.ts',
    content: 'const RESEND_API_KEY = "re_9kLm3nOp5qRs7tUv1wXy";\n',
  },
];

function runScanner(root) {
  try {
    const stdout = execFileSync('node', [SCANNER], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SCAN_SECRETS_ROOT: root, GIT_DIR: undefined },
      // El escáner usa `git ls-files`: el temp dir se inicializa como repo.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: (error.stdout ?? '').toString(),
      stderr: (error.stderr ?? '').toString(),
    };
  }
}

function git(args, cwd) {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

function writeFiles(root, files) {
  for (const { file, content } of files) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
}

let failures = 0;
function expect(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ ${message}`);
    failures += 1;
  }
}

const root = mkdtempSync(path.join(tmpdir(), 'truco-secrets-'));
try {
  git(['init', '-q'], root);
  writeFiles(root, [...DECOYS, ...PLACEHOLDERS]);
  git(['add', '-A'], root);

  const result = runScanner(root);
  expect(result.code !== 0, 'el escáner falla (exit != 0) si hay secretos');

  for (const decoy of DECOYS) {
    expect(
      result.stderr.includes(decoy.file) && result.stderr.includes(`[${decoy.rule}]`),
      `detecta el señuelo «${decoy.name}» (${decoy.rule})`,
    );
  }
  for (const placeholder of PLACEHOLDERS) {
    expect(
      !result.stderr.includes(`${placeholder.file}:`),
      `ignora el placeholder legítimo ${placeholder.file}`,
    );
  }

  // Árbol limpio: no debe fallar.
  rmSync(path.join(root, 'src'), { recursive: true, force: true });
  rmSync(path.join(root, 'docs'), { recursive: true, force: true });
  writeFiles(root, [{ file: 'src/ok.ts', content: 'export const hello = "world";\n' }]);
  git(['add', '-A'], root);
  const clean = runScanner(root);
  expect(clean.code === 0, 'un árbol sin secretos pasa en verde');
  expect(clean.stdout.includes('Escaneo de secretos OK'), 'reporta el conteo de archivos/reglas');
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} comprobación(es) fallaron.`);
  process.exitCode = 1;
} else {
  console.log(
    '\nEscáner de secretos: todos los señuelos detectados y todos los placeholders ignorados.',
  );
}
