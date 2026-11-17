#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer as createViteDevServer } from 'vite';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(webRoot, '../..');
const screenshotsDir = path.join(repoRoot, 'docs', 'screenshots');

const VIEWPORTS = [
  { width: 360, height: 844, tag: '360' },
  { width: 768, height: 980, tag: '768' },
  { width: 1200, height: 860, tag: '1200' },
];

const SCENES = [
  { scene: 'midhand', slug: 'mesa-mitad-mano' },
  { scene: 'calls', slug: 'mesa-bandeja-cantos' },
  { scene: 'result', slug: 'mesa-resultado' },
  { scene: 'reconnecting', slug: 'mesa-reconexion' },
];

async function launchHeadlessChromium() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    process.env.AWS_LAMBDA_JS_RUNTIME = process.env.AWS_LAMBDA_JS_RUNTIME ?? 'nodejs22.x';
    const sparticuz = (await import('@sparticuz/chromium')).default;
    const executablePath = await sparticuz.executablePath();
    return chromium.launch({
      executablePath,
      args: sparticuz.args,
      headless: true,
      env: { ...process.env },
    });
  }
}

async function main() {
  mkdirSync(screenshotsDir, { recursive: true });

  const vite = await createViteDevServer({
    root: webRoot,
    configFile: path.join(webRoot, 'vite.config.ts'),
    server: {
      host: '127.0.0.1',
      port: 0,
    },
    logLevel: 'error',
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto efímero de Vite');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const browser = await launchHeadlessChromium();
  try {
    const context = await browser.newContext({
      viewport: { width: 360, height: 780 },
      deviceScaleFactor: 2,
      locale: 'es-AR',
    });
    const page = await context.newPage();

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const item of SCENES) {
        const url = `${baseUrl}/dev/mesa?mode=2v2&scene=${item.scene}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForSelector('[aria-label="Mesa de truco en vivo"]', { timeout: 10_000 });
        await page.evaluate('document.fonts.ready');
        await page.waitForTimeout(150);

        const outPath = path.join(screenshotsDir, `${item.slug}-${vp.tag}.png`);
        await page.screenshot({ path: outPath, fullPage: true });
        process.stdout.write(`✔ Captura generada: docs/screenshots/${item.slug}-${vp.tag}.png\n`);
      }
    }
  } finally {
    await browser.close();
    await vite.close();
  }
}

void main();
