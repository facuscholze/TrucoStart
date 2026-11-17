import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { parseServerEnv } from '../src/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');

function collectSourceFiles(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', '.turbo'].includes(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Monorepo M0 architecture & governance invariants', () => {
  it('maintains mandatory project memory files and ADRs 001 to 008', () => {
    const requiredDocs = [
      'CLAUDE.md',
      'docs/MASTER_PROMPT.md',
      'docs/STATE.md',
      'docs/DECISIONS.md',
      'docs/BACKLOG.md',
      'docs/ISSUES.md',
      'docs/CHANGELOG.md',
    ];

    for (const relPath of requiredDocs) {
      const absPath = path.join(repoRoot, relPath);
      expect(fs.existsSync(absPath), `Falta archivo obligatorio: ${relPath}`).toBe(true);
      expect(fs.statSync(absPath).size).toBeGreaterThan(100);
    }

    const decisionsContent = fs.readFileSync(path.join(repoRoot, 'docs/DECISIONS.md'), 'utf8');
    for (let i = 1; i <= 8; i++) {
      const adrHeader = `ADR-00${i}`;
      expect(decisionsContent).toContain(adrHeader);
    }
  });

  it('validates docker-compose.yml structure for PostgreSQL 16 and Redis 7', () => {
    const composeRaw = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    const compose = parseYaml(composeRaw) as {
      services?: Record<
        string,
        {
          image?: string;
          healthcheck?: { test?: unknown };
          volumes?: string[];
        }
      >;
      volumes?: Record<string, unknown>;
    };

    expect(compose.services?.postgres?.image).toBe('postgres:16-alpine');
    expect(compose.services?.postgres?.healthcheck?.test).toBeDefined();
    expect(compose.services?.redis?.image).toBe('redis:7-alpine');
    expect(compose.services?.redis?.healthcheck?.test).toBeDefined();
    expect(compose.volumes).toHaveProperty('truco_postgres_data');
    expect(compose.volumes).toHaveProperty('truco_redis_data');
  });

  it('validates GitHub Actions CI workflow definition', () => {
    const ciRaw = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    const ci = parseYaml(ciRaw) as {
      jobs?: Record<
        string,
        {
          services?: Record<string, { image?: string }>;
          steps?: Array<{ run?: string }>;
        }
      >;
    };

    const job = ci.jobs?.['quality-and-tests'];
    expect(job).toBeDefined();
    expect(job?.services?.postgres?.image).toBe('postgres:16-alpine');
    expect(job?.services?.redis?.image).toBe('redis:7-alpine');

    const commands = (job?.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(commands).toContain('pnpm lint');
    expect(commands).toContain('pnpm typecheck');
    expect(commands).toContain('pnpm test');
    expect(commands).toContain('pnpm build');
  });

  it('ensures .env.example covers all mandatory variables and passes ServerEnvSchema', () => {
    const envExampleRaw = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    const parsedPairs: Record<string, string> = {};

    for (const line of envExampleRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^"(.*)"$/, '$1');
      parsedPairs[key] = val;
    }

    const requiredKeys = [
      'NODE_ENV',
      'DATABASE_URL',
      'REDIS_URL',
      'SESSION_SECRET',
      'REFRESH_TOKEN_TTL',
      'COOKIE_DOMAIN',
      'CORS_ORIGINS',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'EMAIL_PROVIDER',
      'EMAIL_PROVIDER_API_KEY',
      'CAPTCHA_PROVIDER',
      'CAPTCHA_SITE_KEY',
      'CAPTCHA_SECRET',
      'SEED_ENCRYPTION_KEY',
      'TURN_TIMEOUT_MS',
      'RECONNECT_GRACE_MS',
      'SENTRY_DSN',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    ];

    for (const key of requiredKeys) {
      expect(parsedPairs, `Falta clave en .env.example: ${key}`).toHaveProperty(key);
    }

    const validated = parseServerEnv(parsedPairs);
    expect(validated.NODE_ENV).toBe('development');
  });

  it('forbids unmarked task markers in comments without a registered STATE-xx identifier', () => {
    const stateDoc = fs.readFileSync(path.join(repoRoot, 'docs/STATE.md'), 'utf8');
    const registeredIds = new Set(
      Array.from(stateDoc.matchAll(/`(STATE-\d+)`/g), (match) => match[1]),
    );

    const markerPrefix = 'TO' + 'DO';
    const rawTodoCommentRegex = new RegExp(`(\\/\\/|\\/\\*|\\*).*\\b${markerPrefix}\\b`);
    const validTodoRegex = new RegExp(`\\b${markerPrefix}\\((STATE-\\d+)\\)`);

    const files = [
      ...collectSourceFiles(path.join(repoRoot, 'apps')),
      ...collectSourceFiles(path.join(repoRoot, 'packages')),
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (rawTodoCommentRegex.test(line)) {
          const match = validTodoRegex.exec(line);
          const relFile = path.relative(repoRoot, file);
          expect(
            match,
            `Comentario sin código STATE-xx en ${relFile}:${index + 1} -> ${line.trim()}`,
          ).not.toBeNull();

          if (match?.[1]) {
            expect(
              registeredIds.has(match[1]),
              `Identificador ${match[1]} en ${relFile}:${index + 1} no está registrado en docs/STATE.md`,
            ).toBe(true);
          }
        }
      });
    }
  });
});
