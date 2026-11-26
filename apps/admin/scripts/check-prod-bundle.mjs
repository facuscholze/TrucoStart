#!/usr/bin/env node
/**
 * Verifica que el panel de administración NO incluya datos de ejemplo en el build de
 * producción. Equivalente al guard de `/dev/mesa` en `@truco/web`: si VITE_ADMIN_DEMO
 * no está definido, todo `lib/demo.ts` debe quedar fuera del bundle.
 *
 * Uso: pnpm --filter @truco/admin check:bundle
 * Sale con código 1 si encuentra marcadores del cliente demo.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(APP_DIR, 'dist-bundle-check');

/** Cadenas exclusivas de `src/lib/demo.ts`. */
const DEMO_MARKERS = ['MartaModera', 'LaViejaEscuela', 'TanoBaston', 'createDemoClient'];

function listBuildFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listBuildFiles(full);
    return /\.(js|mjs|css|html)$/.test(entry.name) ? [full] : [];
  });
}

const env = { ...process.env };
delete env['VITE_ADMIN_DEMO'];

fs.rmSync(OUT_DIR, { recursive: true, force: true });
execFileSync('corepack', ['pnpm', 'exec', 'vite', 'build', '--outDir', OUT_DIR, '--emptyOutDir'], {
  cwd: APP_DIR,
  env: { ...env, VITE_ADMIN_DEMO: '', NODE_ENV: 'production' },
  stdio: 'pipe',
});

const files = listBuildFiles(OUT_DIR);
if (files.length === 0) {
  console.error('✗ No se generó ningún archivo en el build de verificación.');
  process.exit(1);
}

const offenders = [];
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  for (const marker of DEMO_MARKERS) {
    if (content.includes(marker)) {
      offenders.push(`${path.relative(APP_DIR, file)} contiene "${marker}"`);
    }
  }
}

if (offenders.length > 0) {
  console.error('✗ El build de producción incluye datos de ejemplo del panel:');
  for (const offender of offenders) console.error(`  - ${offender}`);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  process.exit(1);
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
console.log(`✓ Build de producción sin datos demo (${files.length} archivos verificados).`);
