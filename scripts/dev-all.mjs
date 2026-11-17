#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const skipDocker = args.has('--skip-docker');
const skipSeed = args.has('--skip-seed');
const dryRun = args.has('--dry-run');

function parseDotEnvFile(filePath) {
  const vars = {};
  if (!existsSync(filePath)) return vars;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

function waitForTcpPort(host, port, timeoutMs = 45_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timeout esperando puerto TCP ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function runStepSync(label, cmd, cmdArgs, env) {
  process.stdout.write(`\n\x1b[36m▶ ${label}\x1b[0m (${cmd} ${cmdArgs.join(' ')})\n`);
  if (dryRun) return;
  const res = spawnSync(cmd, cmdArgs, {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    process.stderr.write(`\x1b[31m✖ Falló el paso "${label}" (código ${res.status ?? 1})\x1b[0m\n`);
    process.exit(res.status ?? 1);
  }
}

function spawnPrefixedService(name, colorCode, cmd, cmdArgs, env) {
  const child = spawn(cmd, cmdArgs, {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `\x1b[${colorCode}m[${name}]\x1b[0m `;
  const pipeLines = (stream, target) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        target.write(`${prefix}${line}\n`);
      }
    });
    stream.on('end', () => {
      if (buffer.length > 0) target.write(`${prefix}${buffer}\n`);
    });
  };

  pipeLines(child.stdout, process.stdout);
  pipeLines(child.stderr, process.stderr);
  return child;
}

async function main() {
  const envExamplePath = path.join(rootDir, '.env.example');
  const envPath = path.join(rootDir, '.env');

  if (!existsSync(envPath) && existsSync(envExamplePath)) {
    process.stdout.write('\x1b[33mℹ No se encontró .env; copiando .env.example -> .env\x1b[0m\n');
    if (!dryRun) {
      copyFileSync(envExamplePath, envPath);
    }
  }

  const fileVars = parseDotEnvFile(existsSync(envPath) ? envPath : envExamplePath);
  const childEnv = {
    ...fileVars,
    ...process.env,
  };

  if (!skipDocker) {
    runStepSync(
      'Levantando PostgreSQL 16 y Redis 7 con Docker Compose',
      'docker',
      ['compose', 'up', '-d'],
      childEnv,
    );
  }

  const pgPort = Number(childEnv.POSTGRES_PORT ?? 5432);
  const redisPort = Number(childEnv.REDIS_PORT ?? 6379);

  if (!dryRun) {
    process.stdout.write(
      `\x1b[36m▶ Verificando disponibilidad TCP de PostgreSQL (:${pgPort}) y Redis (:${redisPort})...\x1b[0m\n`,
    );
    await Promise.all([
      waitForTcpPort('127.0.0.1', pgPort),
      waitForTcpPort('127.0.0.1', redisPort),
    ]);
  }

  runStepSync(
    'Compilando paquetes compartidos (@truco/engine, @truco/shared, @truco/ui)',
    'pnpm',
    [
      '--filter',
      '@truco/engine',
      '--filter',
      '@truco/shared',
      '--filter',
      '@truco/ui',
      'run',
      'build',
    ],
    childEnv,
  );

  runStepSync(
    'Ejecutando migraciones SQL en PostgreSQL',
    'pnpm',
    ['--filter', '@truco/api', 'run', 'db:migrate'],
    childEnv,
  );

  if (!skipSeed) {
    runStepSync(
      'Cargando usuarios de prueba para desarrollo local (db:seed:dev)',
      'pnpm',
      ['--filter', '@truco/api', 'run', 'db:seed:dev'],
      childEnv,
    );
  }

  process.stdout.write(
    '\n\x1b[32m✔ Entorno listo. Iniciando API (:3001), Game Server (:3002) y Web PWA (:5173)...\x1b[0m\n',
  );

  if (dryRun) {
    process.stdout.write('\x1b[32m✔ Modo --dry-run verificado correctamente.\x1b[0m\n');
    return;
  }

  const children = [
    spawnPrefixedService('api', '35', 'pnpm', ['--filter', '@truco/api', 'run', 'dev'], childEnv),
    spawnPrefixedService(
      'game-server',
      '33',
      'pnpm',
      ['--filter', '@truco/game-server', 'run', 'dev'],
      childEnv,
    ),
    spawnPrefixedService('web', '32', 'pnpm', ['--filter', '@truco/web', 'run', 'dev'], childEnv),
  ];

  let shuttingDown = false;
  const shutdownAll = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n\x1b[33m⏹ Deteniendo servicios (${signal})...\x1b[0m\n`);
    for (const c of children) {
      if (!c.killed) c.kill('SIGTERM');
    }
    setTimeout(() => process.exit(0), 800).unref();
  };

  process.once('SIGINT', () => shutdownAll('SIGINT'));
  process.once('SIGTERM', () => shutdownAll('SIGTERM'));

  for (const c of children) {
    c.on('exit', (code) => {
      if (!shuttingDown && code && code !== 0) {
        process.stderr.write(
          `\x1b[31m✖ Un servicio terminó inesperadamente (código ${code}). Cerrando...\x1b[0m\n`,
        );
        shutdownAll('CHILD_EXIT');
        process.exitCode = code;
      }
    });
  }
}

void main();
