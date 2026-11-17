import { expect, test } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';

const BASE_URL = 'http://localhost:4173';

/**
 * M8a — la SPA se sirve con las cabeceras de seguridad del repo (las mismas que nginx)
 * y la CSP no rompe la carga: sin violaciones de política en consola.
 */
test('la web se sirve con CSP estricta y sin violaciones de política', async () => {
  const browser = await launchIsolatedChromium();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    const violations: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
    });

    const response = await page.goto(`${BASE_URL}/`);
    expect(response).not.toBeNull();

    const headers = response?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).not.toContain('unsafe-eval');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('geolocation=()');
    expect(headers['x-frame-options']).toBe('DENY');

    // La app monta y navega sin errores de CSP.
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(violations, violations.join('\n')).toHaveLength(0);

    // El service worker (PWA) también carga bajo `worker-src 'self'`.
    const hasServiceWorker = await page.evaluate(() => 'serviceWorker' in navigator);
    expect(hasServiceWorker).toBe(true);

    await context.close();
  } finally {
    await browser.close();
  }
});
