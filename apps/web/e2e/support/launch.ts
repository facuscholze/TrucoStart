import { type Browser, chromium } from '@playwright/test';

/**
 * Lanza Chromium con fallback a `@sparticuz/chromium` para entornos sin los binarios oficiales
 * de Playwright (CI del sandbox). Es el mismo helper que usa la suite M5b.
 */
export async function launchIsolatedChromium(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    process.env['AWS_LAMBDA_JS_RUNTIME'] = process.env['AWS_LAMBDA_JS_RUNTIME'] ?? 'nodejs22.x';
    const sparticuz = (await import('@sparticuz/chromium')).default;
    const executablePath = await sparticuz.executablePath();
    const multiProcessSafeArgs = sparticuz.args.filter(
      (arg: string) => arg !== '--single-process' && arg !== '--no-zygote',
    );
    return chromium.launch({
      executablePath,
      args: multiProcessSafeArgs,
      headless: true,
      env: { ...process.env } as Record<string, string>,
    });
  }
}
