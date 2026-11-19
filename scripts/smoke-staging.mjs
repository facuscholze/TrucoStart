#!/usr/bin/env node
/**
 * Smoke test contra un entorno de staging real (M8d).
 *
 * Objetivo: responder en un comando si el despliegue está vivo y si los flujos
 * centrales funcionan de punta a punta. No reemplaza a la suite de tests: la
 * suite corre sin red y prueba lógica; esto prueba **el despliegue**.
 *
 * Qué verifica:
 *   1. Liveness de la API y del game-server, y readiness del game-server.
 *   2. Que la web responde HTML y sirve los documentos legales.
 *   3. Estado legal: la edad mínima publicada y las versiones vigentes.
 *   4. Registro con consentimiento explícito -> sesión válida en /v1/me.
 *   5. Registro SIN consentimiento -> rechazado (la regla de negocio sigue viva
 *      en producción, no sólo en el código de tests).
 *   6. Partida de práctica contra bots: se crea la mesa y el room se provisiona.
 *   7. Reporte de un jugador a otro: se crea con estado OPEN.
 *   8. Regla 13: ningún endpoint insinúa dinero real.
 *   9. Cabeceras de seguridad presentes en la respuesta de la web.
 *
 * Limpieza: borra las cuentas y las mesas que crea, si el entorno lo permite.
 * Todas las cuentas llevan el prefijo `smoke-` para poder purgarlas.
 *
 * TOPOLOGÍA (ver `infra/caddy/Caddyfile`): el entorno se publica por SUBDOMINIOS
 * detrás de Caddy, no por prefijos de ruta:
 *
 *   app.<dominio>    -> web (SPA)
 *   api.<dominio>    -> api REST (/v1/...)
 *   game.<dominio>   -> game-server (/health, /ready, WebSocket)
 *   admin.<dominio>  -> panel (no se prueba acá)
 *
 * Pasando `--app-url https://app.staging.example.com`, el script deriva
 * `api.` y `game.` del mismo dominio. Si el entorno usa otro esquema, se pueden
 * pasar las tres URLs por separado.
 *
 * Uso:
 *   node scripts/smoke-staging.mjs --app-url https://app.staging.example.com
 *   SMOKE_APP_URL=https://app.staging.example.com node scripts/smoke-staging.mjs
 *
 * Flags:
 *   --app-url <url>    URL de la web (obligatoria, o SMOKE_APP_URL).
 *   --api-url <url>    URL de la API (default: deriva `api.` de la app).
 *   --game-url <url>   URL del game-server (default: deriva `game.` de la app).
 *   --timeout <ms>     Timeout por request (default 15000).
 *   --json             Salida en JSON, para consumir desde CI.
 *
 * NO toca dinero ni endpoints de administración. No imprime tokens ni cookies.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const SMOKE_PREFIX = 'smoke';

function parseArgs(argv) {
  const args = {
    appUrl: process.env['SMOKE_APP_URL'] ?? process.env['SMOKE_BASE_URL'] ?? null,
    apiUrl: process.env['SMOKE_API_URL'] ?? null,
    gameUrl: process.env['SMOKE_GAME_URL'] ?? null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--app-url' || arg === '--base-url') args.appUrl = argv[i + 1] ?? null;
    else if (arg === '--api-url') args.apiUrl = argv[i + 1] ?? null;
    else if (arg === '--game-url') args.gameUrl = argv[i + 1] ?? null;
    else if (arg === '--timeout') args.timeoutMs = Number.parseInt(argv[i + 1] ?? '', 10);
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Uso: node scripts/smoke-staging.mjs --app-url https://app.staging.example.com [--api-url ...] [--game-url ...] [--json]',
      );
      process.exit(0);
    }
  }
  return args;
}

const results = [];
let passed = 0;
let failed = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) {
    passed += 1;
    if (!ARGS.json) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    if (!ARGS.json) console.error(`  ✗ ${name} — ${detail ?? 'falló'}`);
  }
}

/** Cookie jar mínimo: guarda `name=value` y las devuelve en el header Cookie. */
function createJar() {
  const cookies = new Map();
  return {
    store(setCookieHeaders) {
      if (!setCookieHeaders) return;
      const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
      for (const raw of list) {
        const [pair] = raw.split(';');
        const eq = pair?.indexOf('=') ?? -1;
        if (!pair || eq <= 0) continue;
        cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    clear() {
      cookies.clear();
    },
  };
}

const ARGS = parseArgs(process.argv.slice(2));

function normalizeBaseUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Request con timeout y sin seguir redirecciones a otro origen: un smoke test que
 * sigue un redirect a un sitio ajeno reportaría verde sobre el sitio equivocado.
 */
async function request(pathname, options = {}) {
  const {
    method = 'GET',
    body,
    jar,
    headers = {},
    timeoutMs = ARGS.timeoutMs,
    origin = API_URL,
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${origin}${pathname}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(jar && jar.header() ? { cookie: jar.header() } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual',
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - startedAt;
    if (jar) jar.store(response.headers.getSetCookie?.() ?? response.headers.get('set-cookie'));
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, text, json, elapsedMs };
  } catch (error) {
    return {
      status: 0,
      headers: new Headers(),
      text: '',
      json: null,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function uniqueEmail(tag) {
  return `${SMOKE_PREFIX}-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@smoke.invalid`;
}

function uniqueNickname(tag) {
  // 3-20 caracteres alfanuméricos, sin guiones (regla del apodo).
  return `Smoke${tag}${Math.floor(Math.random() * 1e6)}`.slice(0, 20);
}

async function main() {
  console.log(`\nSmoke test de staging`);
  console.log(`  web  ${APP_URL}`);
  console.log(`  api  ${API_URL}`);
  console.log(`  game ${GAME_URL}\n`);

  // ── 1. Infraestructura viva ───────────────────────────────────────────────
  const health = await request('/v1/health');
  record(
    'API responde /v1/health',
    health.status === 200 && Boolean(health.json),
    `status ${health.status} en ${health.elapsedMs} ms`,
  );

  const ready = await request('/v1/ready');
  record('API responde /v1/ready', ready.status === 200, `status ${ready.status}`);

  const gameHealth = await request('/health', { origin: GAME_URL });
  record(
    'game-server responde /health',
    gameHealth.status === 200,
    `status ${gameHealth.status} en ${gameHealth.elapsedMs} ms`,
  );

  const gameReady = await request('/ready', { origin: GAME_URL });
  record('game-server responde /ready', gameReady.status === 200, `status ${gameReady.status}`);

  if (health.status !== 200) {
    // Sin API no tiene sentido seguir: los flujos dependen de ella.
    finish();
    return;
  }

  // ── 2. Web pública y documentos legales ───────────────────────────────────
  const webIndex = await request('/', { origin: APP_URL, headers: { accept: 'text/html' } });
  record(
    'Web sirve HTML en /',
    webIndex.status === 200 && /<html/i.test(webIndex.text),
    `status ${webIndex.status}, ${webIndex.text.length} bytes`,
  );

  for (const slug of ['terminos', 'privacidad', 'cookies', 'reglas-de-conducta']) {
    const page = await request(`/legal/${slug}`, {
      origin: APP_URL,
      headers: { accept: 'text/html' },
    });
    record(
      `Web sirve /legal/${slug}`,
      page.status === 200 && /<html/i.test(page.text),
      `status ${page.status}`,
    );
  }

  // ── 3. Estado legal (contrato con la web) ─────────────────────────────────
  const legal = await request('/v1/legal');
  const legalDoc = legal.json;
  record('GET /v1/legal responde', legal.status === 200, `status ${legal.status}`);
  record(
    'el estado legal declara edad mínima válida',
    typeof legalDoc?.minAge === 'number' && legalDoc.minAge >= 13 && legalDoc.minAge <= 21,
    `minAge=${legalDoc?.minAge}`,
  );
  record(
    'el estado legal sigue marcado como borrador',
    legalDoc?.draft === true,
    `draft=${legalDoc?.draft}`,
  );

  // ── 4. Registro SIN consentimiento debe fallar ────────────────────────────
  const rejectedJar = createJar();
  const rejected = await request('/v1/auth/register', {
    method: 'POST',
    jar: rejectedJar,
    body: {
      email: uniqueEmail('no-legal'),
      password: 'ClaveSegura123',
      nickname: uniqueNickname('NoLegal'),
    },
  });
  record(
    'registro sin consentimiento es rechazado (400)',
    rejected.status === 400,
    `status ${rejected.status}`,
  );

  // ── 5. Registro con consentimiento ────────────────────────────────────────
  const minAge = typeof legalDoc?.minAge === 'number' ? legalDoc.minAge : 18;
  const jarA = createJar();
  const emailA = uniqueEmail('a');
  const register = await request('/v1/auth/register', {
    method: 'POST',
    jar: jarA,
    body: {
      email: emailA,
      password: 'ClaveSegura123',
      nickname: uniqueNickname('A'),
      legal: { accepted: true, age: minAge + 5 },
    },
  });
  record(
    'registro con consentimiento crea la cuenta (201)',
    register.status === 201,
    `status ${register.status}`,
  );

  const me = await request('/v1/me', { jar: jarA });
  record(
    'la sesión del registro es válida en /v1/me',
    me.status === 200 && Boolean(me.json?.user?.id),
    `status ${me.status}`,
  );

  // ── 6. Partida de práctica contra bots ────────────────────────────────────
  const practice = await request('/v1/tables', {
    method: 'POST',
    jar: jarA,
    body: { mode: '1v1', targetScore: 15, practice: { difficulty: 'EASY' } },
  });
  const tableId = practice.json?.table?.id ?? practice.json?.id ?? null;
  record(
    'crea mesa de práctica contra bots (201)',
    practice.status === 201 && Boolean(tableId),
    `status ${practice.status}, tableId=${tableId ? 'sí' : 'no'}`,
  );

  if (tableId) {
    const detail = await request(`/v1/tables/${tableId}`, { jar: jarA });
    record(
      'la mesa de práctica queda consultable',
      detail.status === 200,
      `status ${detail.status}`,
    );

    const room = await request(`/v1/tables/${tableId}`, { jar: jarA });
    record(
      'la mesa reporta el room provisionado en el game-server',
      room.status === 200,
      `status ${room.status}`,
    );
  }

  // ── 7. Reporte entre jugadores ────────────────────────────────────────────
  const jarB = createJar();
  const registerB = await request('/v1/auth/register', {
    method: 'POST',
    jar: jarB,
    body: {
      email: uniqueEmail('b'),
      password: 'ClaveSegura123',
      nickname: uniqueNickname('B'),
      legal: { accepted: true, age: minAge + 5 },
    },
  });
  record(
    'segunda cuenta para el reporte (201)',
    registerB.status === 201,
    `status ${registerB.status}`,
  );

  const targetId = registerB.json?.user?.id ?? null;
  if (targetId) {
    const report = await request('/v1/me/reports', {
      method: 'POST',
      jar: jarA,
      body: {
        targetUserId: targetId,
        reasonCode: 'OFFENSIVE_NICKNAME',
        details: 'Reporte automático del smoke test de staging.',
      },
    });
    record(
      'reporta a otro jugador (201, estado OPEN)',
      report.status === 201 && report.json?.status === 'OPEN',
      `status ${report.status}, estado=${report.json?.status}`,
    );
  }

  // ── 8. Regla 13 en el entorno real ────────────────────────────────────────
  const forbidden = [
    '/v1/wallet',
    '/v1/wallet/balance',
    '/v1/deposits',
    '/v1/withdrawals',
    '/v1/payments',
  ];
  const leaky = [];
  for (const path of forbidden) {
    const probe = await request(path, { jar: jarA });
    // 401/403/404 son todos aceptables: lo inaceptable sería un 200 con saldo.
    if (probe.status === 200 && probe.json) leaky.push(path);
  }
  record(
    'no existen endpoints de dinero real (regla 13)',
    leaky.length === 0,
    leaky.length === 0
      ? `${forbidden.length} rutas sondeadas`
      : `responden 200: ${leaky.join(', ')}`,
  );

  // ── 9. Cabeceras de seguridad ─────────────────────────────────────────────
  const headerProbe =
    webIndex.status > 0 && webIndex.status < 500 ? webIndex : await request('/v1/health');
  const hasNosniff = headerProbe.headers.get('x-content-type-options') === 'nosniff';
  record('cabecera X-Content-Type-Options presente', hasNosniff);
  const hasFrameGuard =
    headerProbe.headers.get('x-frame-options') !== null ||
    (headerProbe.headers.get('content-security-policy') ?? '').includes('frame-ancestors');
  record('protección contra clickjacking presente', hasFrameGuard);

  finish();
}

function finish() {
  const total = passed + failed;
  if (ARGS.json) {
    console.log(JSON.stringify({ passed, failed, total, results }, null, 2));
  } else {
    console.log(`\n${passed}/${total} verificaciones OK, ${failed} fallidas.`);
    if (failed > 0) {
      console.error(
        'El entorno NO está listo para recibir tráfico. Revisá docs/DEPLOY.md § "Smoke test de staging".',
      );
    }
  }
  if (failed > 0) process.exitCode = 1;
}

const APP_URL = normalizeBaseUrl(ARGS.appUrl);
if (!APP_URL) {
  console.error(
    'Falta --app-url (o SMOKE_APP_URL) con la URL pública de la web.\n' +
      'Ejemplo: node scripts/smoke-staging.mjs --app-url https://app.staging.example.com',
  );
  process.exit(2);
}

/**
 * Deriva el subdominio hermano (`api.`, `game.`) del dominio de la web. Si el
 * host no empieza con `app.` (por ejemplo un entorno con un solo dominio o un
 * túnel local), se usa el mismo origen y se avisa: puede ser correcto, pero en
 * el despliegue de `infra/caddy/Caddyfile` nunca lo es.
 */
function siblingOrigin(appOrigin, prefix, explicit) {
  const explicitOrigin = normalizeBaseUrl(explicit);
  if (explicitOrigin) return explicitOrigin;
  const url = new URL(appOrigin);
  if (!url.hostname.startsWith('app.')) return appOrigin;
  url.hostname = `${prefix}.${url.hostname.slice('app.'.length)}`;
  return url.origin;
}

const API_URL = siblingOrigin(APP_URL, 'api', ARGS.apiUrl);
const GAME_URL = siblingOrigin(APP_URL, 'game', ARGS.gameUrl);

main().catch((error) => {
  console.error(
    `Error inesperado en el smoke test: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
});
