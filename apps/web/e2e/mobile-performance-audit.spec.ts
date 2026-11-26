import { expect, test, type Browser } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';

const BASE_URL = 'http://localhost:4173';
const ROUTES = [
  { name: 'inicio', path: '/', expected: /Jugar contra la máquina/i },
  { name: 'rankings', path: '/ranking', expected: /Rankings competitivos/i },
  { name: 'tutorial', path: '/aprender', expected: /Aprender/i },
] as const;

interface BrowserVitals {
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number;
  longTaskCount: number;
  longTaskMs: number;
  loadEventMs: number;
  resourceCount: number;
  layoutShifts: Array<{ value: number; timeMs: number; sources: string[] }>;
  layoutSamples: Array<{
    timeMs: number;
    footerTop: number | null;
    appMainHeight: number | null;
    screenMainHeight: number | null;
    statusHeight: number | null;
  }>;
}

test('mide carga móvil fría con CPU y red limitadas (diagnóstico, sin umbral de CI)', async () => {
  test.setTimeout(240_000);
  let browser: Browser | undefined;
  const samples: Array<{ route: string; vitals: BrowserVitals }> = [];

  try {
    browser = await launchIsolatedChromium();
    for (const route of ROUTES) {
      const context = await browser.newContext({
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        locale: 'es-AR',
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const audit = {
          lcp: null as number | null,
          cls: 0,
          longTaskCount: 0,
          longTaskMs: 0,
          layoutShifts: [] as Array<{ value: number; timeMs: number; sources: string[] }>,
          layoutSamples: [] as Array<{
            timeMs: number;
            footerTop: number | null;
            appMainHeight: number | null;
            screenMainHeight: number | null;
            statusHeight: number | null;
          }>,
        };
        Object.defineProperty(window, '__mobilePerfAudit', { value: audit, configurable: false });
        const layoutSampleDeadline = performance.now() + 5_000;
        const sampleLayout = () => {
          const footer = document.querySelector('footer');
          const appMain = document.querySelector('main');
          const screenMain = appMain?.querySelector('main');
          const status = document.querySelector('[role="status"]');
          const sample = {
            timeMs: Math.round(performance.now()),
            footerTop: footer ? Math.round(footer.getBoundingClientRect().top) : null,
            appMainHeight: appMain ? Math.round(appMain.getBoundingClientRect().height) : null,
            screenMainHeight: screenMain
              ? Math.round(screenMain.getBoundingClientRect().height)
              : null,
            statusHeight: status ? Math.round(status.getBoundingClientRect().height) : null,
          };
          const previous = audit.layoutSamples.at(-1);
          if (
            !previous ||
            previous.footerTop !== sample.footerTop ||
            previous.appMainHeight !== sample.appMainHeight ||
            previous.screenMainHeight !== sample.screenMainHeight ||
            previous.statusHeight !== sample.statusHeight
          ) {
            audit.layoutSamples.push(sample);
          }
          if (performance.now() < layoutSampleDeadline) requestAnimationFrame(sampleLayout);
        };
        requestAnimationFrame(sampleLayout);
        try {
          new PerformanceObserver((entries) => {
            const last = entries.getEntries().at(-1);
            if (last) audit.lcp = last.startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver((entries) => {
            for (const entry of entries.getEntries() as Array<
              PerformanceEntry & {
                value: number;
                hadRecentInput: boolean;
                sources?: Array<{
                  node: Node | null;
                  previousRect?: { y: number };
                  currentRect?: { y: number };
                }>;
              }
            >) {
              if (entry.hadRecentInput) continue;
              audit.cls += entry.value;
              audit.layoutShifts.push({
                value: Number(entry.value.toFixed(4)),
                timeMs: Math.round(entry.startTime),
                sources: (entry.sources ?? [])
                  .slice(0, 3)
                  .map(({ node, previousRect, currentRect }) => {
                    const element =
                      node instanceof Element
                        ? node
                        : node instanceof Node
                          ? node.parentElement
                          : null;
                    if (!element) return node ? `${node.nodeName}:${node.nodeType}` : 'unknown';
                    const id = element.id ? `#${element.id}` : '';
                    const classes = Array.from(element.classList)
                      .slice(0, 3)
                      .map((name) => `.${name}`)
                      .join('');
                    const movement =
                      previousRect && currentRect
                        ? ` (${Math.round(previousRect.y)}→${Math.round(currentRect.y)}px)`
                        : '';
                    const source = node instanceof Element ? '' : 'text→';
                    return `${source}${element.tagName.toLowerCase()}${id}${classes}${movement}`;
                  }),
              });
            }
          }).observe({ type: 'layout-shift', buffered: true });
          new PerformanceObserver((entries) => {
            for (const entry of entries.getEntries()) {
              audit.longTaskCount += 1;
              audit.longTaskMs += entry.duration;
            }
          }).observe({ type: 'longtask', buffered: true });
        } catch {
          // Los tipos de PerformanceObserver no soportados quedan como null/0 en el reporte.
        }
      });

      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
        connectionType: 'cellular3g',
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

      await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'load', timeout: 90_000 });
      await page
        .getByRole('heading', { name: route.expected })
        .first()
        .waitFor({ timeout: 30_000 });
      await page.waitForTimeout(700);
      const vitals = await page.evaluate(() => {
        const audit = (
          window as Window & {
            __mobilePerfAudit?: {
              lcp: number | null;
              cls: number;
              longTaskCount: number;
              longTaskMs: number;
              layoutShifts: Array<{ value: number; timeMs: number; sources: string[] }>;
              layoutSamples: Array<{
                timeMs: number;
                footerTop: number | null;
                appMainHeight: number | null;
                screenMainHeight: number | null;
                statusHeight: number | null;
              }>;
            };
          }
        ).__mobilePerfAudit;
        const nav = performance.getEntriesByType('navigation')[0] as
          PerformanceNavigationTiming | undefined;
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        return {
          fcpMs: fcp ? Math.round(fcp.startTime) : null,
          lcpMs: audit?.lcp === null || audit?.lcp === undefined ? null : Math.round(audit.lcp),
          cls: Number((audit?.cls ?? 0).toFixed(4)),
          longTaskCount: audit?.longTaskCount ?? 0,
          longTaskMs: Math.round(audit?.longTaskMs ?? 0),
          loadEventMs: nav ? Math.round(nav.loadEventEnd) : 0,
          resourceCount: resources.length,
          layoutShifts: audit?.layoutShifts ?? [],
          layoutSamples: audit?.layoutSamples ?? [],
        };
      });
      samples.push({ route: route.name, vitals });
      await cdp.detach();
      await context.close();
    }
  } finally {
    await browser?.close();
  }

  console.log('\nCold mobile performance samples (360x800, 4x CPU, 150ms RTT, 1.6Mbps down):');
  console.log(JSON.stringify(samples, null, 2));
  expect(samples).toHaveLength(ROUTES.length);
  for (const sample of samples) {
    expect(sample.vitals.fcpMs, `${sample.route}: First Contentful Paint`).not.toBeNull();
    expect(sample.vitals.loadEventMs, `${sample.route}: load event`).toBeGreaterThan(0);
  }
});
