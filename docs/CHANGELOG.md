# Changelog

Todos los cambios notables de este proyecto se documentan por módulo siguiendo [Conventional Commits](https://www.conventionalcommits.org/).

---

## [0.8.1-m8b-perf] — 2026-11-18 (M8b — Rendimiento y carga)

### Agregado

- **Índices SQL para consultas críticas** (migración `0005_m8b_performance_indexes`): `match_players(user_id, match_id DESC)` para historial paginado; `match_events(match_id, seq)` para replay; `tables(visibility, status, mode, created_at DESC)` (lobby público sin sort); `tables(status, updated_at)` para barridos de salas zombi; índices parciales en `sanctions`, `sessions`, `auth_tokens`, `reports` y `audit_logs`.
- **Caché en memoria de 1 s para el listado público de lobby** en `LobbyService`, invalidada ante cualquier mutación (create/join/leave/delete/expire). Aligera el HTTP GET `/v1/tables` sin afectar la consistencia en tiempo real del canal WS `/lobby`.
- **Límites de conexiones simultáneas por usuario e IP** en el `game-server`: `WS_MAX_CONNECTIONS_PER_USER` (default 4) y `WS_MAX_CONNECTIONS_PER_IP` (default 20), con rechazo temprano en el middleware de handshake (evita consumir tickets WS).
- **Workflow de performance manual** (`.github/workflows/perf.yml`, `workflow_dispatch`) que levanta PostgreSQL 16 y Redis 7 reales y ejecuta tres escenarios: `http-100` (k6 lobby+login a 100 VUs), `ws-load` (Node.js `perf:load` parametrizable por `rooms`/`actions`) y `explain` (EXPLAIN ANALYZE de consultas críticas). El informe se publica como artefacto.
- **Escenario k6 HTTP** en `perf/k6/lobby-and-login.js` (registro + login + perfil + lobby + historial, thresholds `p(95)<300ms`, error <1%).
- **Escenario WS de carga** (`pnpm --filter @truco/game-server perf:load`, `apps/game-server/scripts/perf/load-ws.mjs`): simula N salas 1v1, conecta 2N sockets, envía `table.ready` midiendo latencia p50/p95/p99 y uso de memoria. Resultados en sandbox: 100 salas/200 sockets, p95 0,37 ms, 0 fallos.
- **Script de EXPLAIN** (`scripts/perf/explain-critical.mjs`) que emite los planes de ejecución de 8 consultas críticas (lobby, login, historial, stats, barridos, asientos, reportes).
- **Guarda de bundle admin en CI**: `pnpm --filter @truco/admin check:bundle` se ejecuta después del build para garantizar que los datos de ejemplo (`createDemoClient`, etc.) quedan fuera del bundle de producción.

### Documentación

- `docs/PERF.md` reescrito con: objetivos/SLO, criterios de salida (estado verificado/parcial/pendiente), metodología, resultados medidos en sandbox (25 y 100 salas), ajustes aplicados, planes EXPLAIN esperados, cuellos conocidos y pasos de reproducción local y CI.

### Tests

- `apps/game-server/tests/server.spec.ts`: nueva prueba de límites de conexión por usuario (conecta 2, la 3ra se rechaza con `TOO_MANY_CONNECTIONS`; al liberar una se puede volver a conectar).
- Migración `0005` verificada en PGlite (tests de API en verde) y su SQL respeta el formato `--> statement-breakpoint` del runner de Drizzle.

---

## [0.8.0-m6-ai] — 2026-11-13 (M6 — IA de Truco de Tres Niveles, BL-010)

### Agregado

- **IA parametrizada en `@truco/engine` (`packages/truco-engine/src/bot/`):** un único algoritmo (`chooseBotAction(view, rng, difficultyOrParams)`) consume `BotParams` explícitos por nivel (`bot/difficulty.ts`: `EASY` / `MEDIUM` / `HARD`, congelados e inmutables) en lugar de código duplicado. El bot de M1 se conserva como línea base en `bot-legacy.ts` (`chooseBotActionLegacy`, exportado para benchmarks).
- **Memoria y probabilidades sin trampa (`bot/knowledge.ts`):** `buildCardKnowledge(view)` recuerda cartas jugadas, deduce el universo de cartas no vistas y estima cartas rivales pendientes; `estimateCardWinProbability`, `estimateEnvidoWinProbability` (Monte Carlo determinista por vista) y `estimateHandWinRate` (rollout de 120 muestreos de las manos ajenas desconocidas + `evaluateHandWinnerFromRounds`) producen la fuerza real de la mano. Toda la entrada sigue siendo **exclusivamente `PlayerView`**.
- **Decisiones de canto basadas en EV:** Envido (cantar/subir/aceptar) según tanto, probabilidad estimada y marcador; Truco/Retruco/Vale Cuatro según fuerza de mano, posición (mano/pie), estar debajo en el marcador, defensa en punto de partida y farol moderado (`bluffRate`). Regla dura implementada y testeada: **con carta imbatible (macho de espadas en mesa o en mano) nunca se rechaza un canto**, incluido Vale Cuatro.
- **Juego de cartas económico:** se elige la carta más baja que alcanza para ganar la baza, se acompaña al compañero cuando ya asegura la baza y se reservan las altas; el nivel fácil introduce errores ocasionales (`cardMistakeRate`).
- **Benchmark reproducible (`src/benchmark.ts`, `docs/PERF.md`):** `runMatchup` / `runBenchmark` alternan el lado de la mesa y reportan win rate con **IC 95% de Wilson**. Sobre 2.000 partidas por enfrentamiento: **difícil 62,9% vs bot anterior de M1** (IC `[60,8%, 65,0%]`), 63,2% vs medio, 79,8% vs fácil y 98,0% vs azar; medio ≈ bot anterior (49,5%) y 72,5% vs fácil. Costo: ~10 ms de CPU por partida.

### Corregido

- `simulateMatch` acepta `LEGACY` / `EASY` / `MEDIUM` / `HARD` como agentes, `agentParamsByTeam` para tuning y selectores por función (`AgentSelector`), manteniendo `HEURISTIC` como alias del nivel medio.

### Tests

- `packages/truco-engine/tests/bot-m6.spec.ts`: Vale Cuatro con carta imbatible (los tres niveles responden `QUIERO`), carta más baja que alcanza, Envido con tanto alto (31) y umbral por dificultad (26 solo lo canta el difícil), monotonía de parámetros.
- `packages/truco-engine/tests/bot-benchmark.spec.ts`: regresión del criterio de aceptación (>60% vs M1 con 400 partidas deterministas) y escalera difícil > medio > fácil.

---

## [0.7.0-m5b] — 2026-11-13 (Sub-etapa M5b — Lobby en Vivo, Auth/Perfil, Aprender, Anotador Offline, PWA y E2E Multi-Cliente)

### Agregado

- **Base transversal de `@truco/web`:** copy `es-AR` centralizado y tipado (`src/i18n/messages.es-AR.ts` + `messages-screens.es-AR.ts`), cliente REST tipado (`src/lib/api-client.ts`) con manejo de `ProblemDetails`, preferencias persistentes en `localStorage` (`src/lib/preferences.ts`), sintetizador Web Audio sin assets (`src/lib/sound-fx.ts`) y `VitePWA` (`generateSW`) con manifiesto e iconos propios que precachea 35 entradas (`dist/sw.js`, `dist/manifest.webmanifest`).
- **Shell, onboarding y autenticación:** `AppShell` responsive (navegación inferior en `360px`, lateral a partir de `tablet`, `aria-current` y `>= 44px` de área táctil), `OnboardingModal` accesible y `AuthScreen` completo (login, registro, promoción in-place de invitado, recuperación/verificación de correo y sesión activa).
- **Home, Lobby en vivo, matchmaking y Sala de espera:** hero con naipes SVG, partida rápida `1v1`/`2v2`, mesa privada con código de 6 caracteres y unión por código/enlace; `/lobby` con namespace WS `/lobby` (`useLobbyRealtime`: alta/baja/actualización de mesas, filtros por modo/puntos/Flor/estado, cola de matchmaking y cancelación); `/sala/:tableId` con código copiable, invitación HMAC, lista de asientos sincronizada por WebSocket, ready-check y transición en caliente a `/mesa/:roomId` **sin** cerrar el socket (`useLiveGameRoom`).
- **Perfil, tutorial y anotador:** `/perfil` con estadísticas e historial reales de PostgreSQL (`/v1/me`, `/v1/me/stats`, `/v1/me/matches`), edición de apodo/presentación, preferencias de sonido/animaciones/contraste/tipografía, sesiones activas, exportación JSON y eliminación de cuenta; `/aprender` con reglas, jerarquía de las 40 cartas, señas oficiales y tutorial guiado; `/anotador` 100% offline con fósforos de a 5 (Malas/Buenas), historial y persistencia local; router con `React.lazy` por ruta.
- **E2E multi-cliente real y cobertura de regresión:**
  - Stack E2E real (`apps/api/scripts/e2e-stack.ts`) que levanta `createAdaptiveTestDatabase` + `createGameServer` (`:3002`) + `createApiApp` (`:3001`) con `HttpGameRoomProvisioner`, `InMemoryMatchLifecycleConsumer` y límites de rate alto para loopback; Playwright (`apps/web/playwright.config.ts`) lo arranca junto a `vite preview :4173` (`localhost` para cookies `Domain=localhost` y Service Worker en contexto seguro).
  - `apps/web/e2e/m5b-multiclient.spec.ts` (2/2 en verde): **Desktop `1280x800`** invitado -> crear mesa privada a 15 -> unirse por código -> ready-check -> primera carta -> **corte de red y reconexión** (`game.rejoin`, ticket efímero nuevo) -> partida completa -> modal de resultado -> **revancha en la misma sala** -> `/perfil` con estadísticas reales; **Mobile `360x800`** flujo completo con drawer de cantos, revancha y **`/anotador` recargado 100% sin red** vía Service Worker.
  - Correcciones de producto detectadas por los E2E: el estado `offline` del navegador ahora corta/reanuda el socket de mesa (`useLiveGameRoom`) mostrando el banner de reconexión; la revancha conserva la sala en `game-server` (`match-persistence.service.ts` solo destruye la sala en `reason === 'ABANDON'`) y reactiva los asientos persistidos al iniciar el segundo `match.started`; el badge de puntaje del `/anotador` ya no desborda en `360px`.
  - Scripts `test:e2e` y `screenshots:m5b` en `apps/web/package.json` y generador `apps/web/scripts/capture-m5b-screenshots.mjs` que siembra una partida real y una mesa pública para capturar **14 screenshots** (`360px` y `1200px` de Home, Lobby, Sala de espera, Perfil, Aprender, Anotador y Login) en `docs/screenshots/`.

### Métricas

- Entrada de producción `dist/assets/index-DILv7qVp.js`: **`330.54 KB`** (`101.09 KB` gzip) — dentro del presupuesto `< 200 KB` gzip; suma de entrada + 11 chunks lazy: `146.64 KB` gzip; CSS `4.66 KB` gzip.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (12 tareas, 38 tests API + 11 tests web) y `pnpm build` (7 tareas) en verde; E2E Playwright `2/2` (Desktop + Mobile) en ~20 s.

---

## [0.6.0-m5a] — 2026-11-13 (Ajustes Pre-M5 y Sub-etapa M5a — Sistema de Diseño `@truco/ui`, Baraja Española SVG y Mesa Responsive en `@truco/web`)

### Agregado

- **Ajustes Pre-M5 (Ítems 1–4):**
  - Inclusión idempotente de `ar-corto-15-flor-v1` en `apps/api/src/db/seed-dev.ts` manteniendo intacto `INITIAL_RULESETS` (3 elementos) en `@truco/engine` (`73dbfed`).
  - Cola de fallos permanentes (DLQ `truco-match-lifecycle-dlq`) en `BullMqMatchLifecycleConsumer` tras agotar reintentos de BullMQ, con test real de agotamiento de reintentos y preservación del payload (`255d018`).
  - Cableado productivo completo de `apps/game-server/src/main.ts` con `RedisGameStore`, `BullMqMatchLifecyclePublisher`, `parseGameServerEnv`, `allowAdHocRooms: false` y apagado limpio `SIGINT`/`SIGTERM` (`1b6c956`).
  - Orquestador unificado `pnpm dev:all` (`scripts/dev-all.mjs` con `--dry-run`) y documentación completa de flujo local en `README.md` (`1dcdcb6`).
- **Sistema de diseño `@truco/ui` y baraja española SVG original (`M5a-1`, `fc347e1`):**
  - Tokens semánticos "Paño Criollo Contemporáneo" (`#0F3D2E`, `#09281E`, `#14201B`, `#1B2B24`, `#F6F0E2`, `#18221D`, `#E0B84C`, `#6FB1E0`, `#D6523F`/`#FF8F7E`, `#4CB782`), tipografías `Fraunces` + `Inter` (`tabular-nums`), contraste verificado **WCAG 2.1 AA** y soporte `prefers-reduced-motion`.
  - Baraja española original de **40 cartas SVG vectoriales** (`Oros`, `Copas`, `Espadas`, `Bastos` `1–7, 10–12`) + dorso geométrico ornamental criollo, sin dependencias externas ni marcas registradas.
  - 12 componentes accesibles con áreas táctiles `>= 44x44 px`, navegación por teclado y atributos ARIA: `Avatar`, `Badge`, `Card`, `Hand`, `ScoreBoard` (fósforos de a 5 en _Malas/Buenas_), `CallButton`, `PlayerSeat`, `Table`, `QuickChat`, `Toast`, `Modal` y `RankRow`.
- **Mesa de juego responsive y conexión autoritativa en `apps/web` (`M5a-2`):**
  - Proyector puro `GameTableView` sobre `PlayerView` (`viewFor`), `CallTray` (bottom-sheet en móvil / panel lateral en escritorio renderizando **estrictamente** `legalActions` informadas por el servidor para _Envido_, _Truco_, _Flor_, respuestas y las 10 _señas_ de 2v2) y `MatchResultModal` (anotador final, verificación SHA-256 commit-reveal y revancha vía `table.ready`).
  - Hook autoritativo `useLiveGameRoom` sobre Socket.IO (`'envelope'`) con emisión de un `ws-ticket` nuevo single-use en el handshake inicial **y** en cada reconexión, reconexión automática vía `game.rejoin` (`{ roomId, sessionId, lastSeq }`), temporizador de turno, burbujas de cantos/frases y banner de gracia por desconexión rival.
  - Ruta `/dev/mesa` (`MODO DESARROLLO`) con `React.lazy` bajo `import.meta.env.DEV` contra bots determinísticos de `@truco/engine` (`1v1`/`2v2`, `15`/`30 con Flor` y escenas de inspección), verificada por test automatizado como **excluida** del bundle productivo (`109.37 KB` gzip `< 200 KB`).
  - Generador automatizado Playwright (`pnpm --filter @truco/web run screenshots:m5a`) y las **12 capturas reales** en `docs/screenshots/` para `360px`, `768px` y `1200px` (_mitad de mano_, _bandeja de cantos_, _resultado_ y _reconexión_).

---

## [0.5.0-m4] — 2026-11-13 (Ajustes Pre-M4 y Módulo M4 — Lobby, Mesas, Matchmaking y Persistencia de Partidas)

### Agregado

- **Ajustes Pre-M4 (Ítems 1–6):**
  - Verificación de M3 en GitHub Actions CI contra PostgreSQL 16 y Redis 7 reales, corrigiendo el aislamiento de tests sobre bases efímeras PostgreSQL (`4087eb1`).
  - Puerto `RateLimitStore` (`InMemoryRateLimitStore` + `RedisRateLimitStore` con scripts Lua) y suite contractual compartida; cambio del bloqueo progresivo de login a `(cuenta + IP)` más umbral de Captcha por cuenta para evitar denegación de servicio sobre cuentas de terceros (`ADR-015`).
  - Tickets WebSocket estrictamente **single-use** mediante identificador `jti` persistido con TTL en `RateLimitStore`/`GameStore` (`f4bc23c`).
  - Eliminación de rutas redundantes `PATCH/DELETE/export` bajo `/v1/users/:id`, conservando exclusivamente `/v1/me*` para mutaciones/exportación propias, y documentación del requisito de mismo _registrable site_ para cookies `SameSite=Lax` (`ADR-016`).
- **Contrato formal `apps/api <-> apps/game-server` sin escritura directa a PostgreSQL (`ADR-017`):**
  - Aprovisionamiento síncrono firmado con HMAC-SHA256 (`POST /internal/rooms` y `DELETE /internal/rooms/:id`) con variante adicional `AR_CORTO_15_FLOR_V1` (`ar-corto-15-flor-v1`) y bloqueo de salas ad-hoc (`allowAdHocRooms = false`).
  - Publicación asíncrona de `match.started`, `table.seatVacated` y `match.completed` desde `apps/game-server` vía BullMQ/Redis (`BullMqMatchLifecyclePublisher` + `InMemoryMatchLifecycleBus`), consumidos en `apps/api` (`MatchPersistenceService`) para persistir `matches`, `match_players` y `match_events` en una sola transacción SQL idempotente.
- **Lobby REST (`/v1/tables/*`), namespace WS `/lobby` y códigos/invitaciones:**
  - Migración SQL Drizzle `0001_rare_havok.sql` (`table_seats` con índice único parcial `WHERE is_active = true` garantizando máximo 1 mesa activa por cuenta + columnas `ruleset_code`, `target_score`, `flor_enabled`, `turn_timeout_ms`, `expires_at`, `closed_reason` en `tables`).
  - Endpoints `GET /v1/tables` (filtros por modo, puntos, flor, ruleset y estado), `POST /v1/tables`, `GET /v1/tables/:id`, `POST /v1/tables/:id/join` (`SELECT ... FOR UPDATE`), `POST /v1/tables/join-by-code` (doble rate limit por IP y cuenta sobre códigos de 6 caracteres `JOIN_CODE_ALPHABET` + tokens de invitación HMAC con expiración), `POST /v1/tables/:id/invite`, `POST /v1/tables/:id/leave` (transferencia determinista de propiedad o cierre) y `DELETE /v1/tables/:id` (solo dueño antes de iniciar), con expiración por TTL y limpieza de mesas abandonadas.
  - Namespace Socket.IO aislado `/lobby` autenticado y validado con `PublicLobbyTableSummarySchema` (`.strict()`), probado con cero filtraciones de mesas privadas o datos privados de jugadores.
- **Matchmaking simple (`1v1` y `2v2`):** puerto `MatchmakingStore` (`InMemoryMatchmakingStore` + `RedisMatchmakingStore` en Lua + tests de contrato), endpoints `POST/GET/DELETE /v1/matchmaking/queue` con timeout configurable, cancelación segura y notificación push privada `matchmaking.matched`.
- **Suite E2E distribuida real y documentación:** test E2E levantando `apps/api` real + `apps/game-server` real jugando una partida completa tras unirse por código y verificando persistencia en PostgreSQL (`matches`, `match_players`, `match_events`), actualización de OpenAPI 3.1 (`0.4.0`), `docs/API.md`, `docs/EVENTS.md`, `docs/THREAT_MODEL.md` y `docs/STATE.md`.

---

## [0.4.0-m3] — 2026-11-13 (Pre-M3 y Módulo M3 — Autenticación, Sesiones y Usuarios en `@truco/api`)

### Agregado

- **Ajustes Pre-M3:** PR #1 abierto hacia `main` (`M0 + M1 + M2`) con GitHub Actions CI en verde sobre `arena/*` contra PostgreSQL 16 y Redis 7 reales (`RedisGameStore`), aclaración de alcance de commit-reveal en `docs/THREAT_MODEL.md`, y protección anti-bloqueo `maxConsecutiveTimeoutsBeforeAbandon = 3` en `@truco/engine` documentada en `docs/RULES.md`.
- **Esquema relacional Drizzle ORM y motor dual PGlite / PostgreSQL 16:** 12 tablas con `UUIDv7` (`users`, `profiles`, `sessions`, `auth_tokens`, `rulesets`, `tables`, `matches`, `match_players`, `match_events`, `reports`, `sanctions`, `audit_logs`), migraciones SQL generadas en `apps/api/drizzle/` y adaptador `createAdaptiveTestDatabase` que ejecuta las mismas migraciones sobre PGlite en local y PostgreSQL 16 aislado por esquema en CI (`ADR-013`).
- **Autenticación y seguridad de sesiones (`AuthModule`):** cuentas invitadas efímeras y promoción in-place (`POST /v1/auth/promote-guest`) conservando `user.id`/progreso, registro/login con Argon2id constante en tiempo, cookies `HttpOnly; Secure; SameSite=Lax`, rotación de refresh tokens con revocación completa de familia ante reúso (`REUSE_DETECTED`), bloqueo progresivo por fuerza bruta (`60s -> 300s -> 900s -> 3600s`), respuestas anti-enumeración, gestión/revocación de sesiones por dispositivo, Google OAuth, verificación de email, recuperación de clave, rate limiting por IP y por cuenta, y `POST /v1/auth/ws-ticket` probado en vivo contra `apps/game-server` (`ADR-014`).
- **Usuarios, autorización por recurso y privacidad (`UsersModule`):** `/v1/me` y `/v1/users/:id` con verificación estricta de titularidad (`403 FORBIDDEN`), perfiles públicos sin PII, estadísticas, historial paginado por cursor, exportación portátil JSON (`GET /v1/me/export`) y eliminación/anonimización de cuenta (`DELETE /v1/me`).
- **Especificación OpenAPI 3.1 y documentación:** `GET /v1/openapi.json` en paridad exacta con `docs/openapi.v1.json`, `docs/API.md`, `docs/ISSUES.md` y registro de proveedores simulados (`STATE-10`, `STATE-11`, `STATE-12`) en `docs/STATE.md`.

---

## [0.3.0-m2] — 2026-11-13 (Ajustes Pre-M2 y Módulo M2 — Game Server Autoritativo `@truco/game-server`)

### Agregado

- **Ajustes pre-M2 en `@truco/engine`:** política parametrizable `responderSelectionMode` en `RuleSet` (`NEXT_IN_TURN` por defecto en 2v2/N-seat, `PIE_OF_TEAM` y `ANY_TEAM_MEMBER`), elevación de cobertura de ramas (`% Branches`) a **100 %** en `src/view.ts` y `src/handlers/*`, documentación en `docs/RULES.md` y registro de mejora pendiente de IA para M6 en `docs/BACKLOG.md` (`BL-010`).
- **Contratos WebSocket y seguridad en `@truco/shared`:** esquemas Zod discriminados para los 10 mensajes cliente→servidor y todos los eventos servidor→cliente, catálogo de frases rápidas rioplatenses (`QUICK_CHAT_PHRASES`) y ticket de autenticación de handshake firmado HMAC-SHA256 (`signWsAuthTicket` / `verifyWsAuthTicket`).
- **Puerto de persistencia `GameStore`:** interfaz explícita con implementaciones `InMemoryGameStore` y `RedisGameStore` (`ioredis`, scripts Lua para lease single-writer y pipeline atómico `MULTI/EXEC`), verificadas con suite contractual compartida (`game-store.contract.spec.ts`) y documentadas en `docs/ISSUES.md`.
- **Seguridad de mazo y rate limiting en `@truco/game-server`:** commit-reveal CSPRNG (`SHA-256`), `Rng` determinista en modo contador `HMAC-SHA256`, cifrado autenticado en reposo **AES-256-GCM** (`SEED_ENCRYPTION_KEY`) y limitador deslizante `WsConnectionRateLimiter` por conexión y categoría (`action`, `chat`, `table`).
- **Salas single-writer y resiliencia (`RoomActor` + `RoomManager`):** ready-check, temporizador de turno con aviso previo (`isWarning: true`) y `SYSTEM_TIMEOUT`, desconexión con gracia de 45 s (`SYSTEM_ABANDON`), reconexión por `sessionId` y `lastSeq` (replay filtrado por audiencia o `game.resync` vía `viewFor`), bloqueo de una sala activa por usuario (`CONFLICT`) y recuperación automática desde `GameStore` tras caída del proceso (`simulateCrash`).
- **Suite de integración Socket.IO (1v1 y 2v2) y documentación:** verificación recursiva mensaje por mensaje de **cero fugas de cartas o señas rivales** en partidas completas de 2 y 4 clientes, `docs/EVENTS.md` completo y ADRs **ADR-011** y **ADR-012** en `docs/DECISIONS.md`.

---

## [0.2.0-m1] — 2026-11-13 (Módulo M1 — Motor Puro `@truco/engine`)

### Agregado

- Baraja española de 40 cartas, jerarquía completa de 14 niveles del Truco, mezclado Fisher-Yates determinístico con `Rng` inyectado y reparto antihorario para $N$ asientos.
- Cálculo exacto de Envido y Flor verificado exhaustivamente sobre las $\binom{40}{3} = 9.880$ manos posibles, y desempate posicional por cercanía a `manoSeat` (`seatHandOrder`).
- Reglas parametrizadas inmutables (`RuleSet`): `AR_STANDARD_V1` (`ar-standard-v1`), `AR_SIN_FLOR_V1` (`ar-sin-flor-v1`) y `AR_CORTO_15_V1` (`ar-corto-15-v1`), validación estricta `validateRuleSet`, variantes `createRuleSetVariant` y catálogo oficial de 10 señas (`signals.json`).
- Máquinas de estado puras de Envido (`ENVIDO`, `REAL_ENVIDO`, `FALTA_ENVIDO`), Flor (`FLOR`, `CON_FLOR_QUIERO`, `CONTRAFLOR`, `CONTRAFLOR_AL_RESTO`, `ACHICO`), Truco (`TRUCO`, `RETRUCO`, `VALE_CUATRO`), _"el envido está primero"_ y _Mano de Once_.
- Motor completo `createGame`, `createGameWithHands`, `legalActions` y `applyAction` nativo para $N$ asientos (1v1, 2v2, 3v3+), con tabla completa de pardas, abandono parcial/total al mazo, señas por equipo y acciones de sistema (`SYSTEM_TIMEOUT`, `SYSTEM_ABANDON`).
- Proyección segura `viewFor(state, seat)` y `projectEventsForSeat` probadas con `fast-check` contra fugas de cartas ajenas o señas rivales, más formateador narrativo `formatMatchLog`.
- IA heurística sin trampa `chooseBotAction(view: PlayerView)` y simulador masivo `simulateMatch` / `simulateBatch` (miles de partidas verificadas sin loops ni deadlocks, cobertura `97.93%`).
- Especificación exhaustiva en `docs/RULES.md` y registro de diseño **ADR-010** en `docs/DECISIONS.md`.

---

## [0.1.0-m0] — 2026-11-13 (Módulo M0 — Inicialización del Monorepo y Fundación)

### Agregado

- Especificación maestra íntegra en `docs/MASTER_PROMPT.md` y guía operativa en `CLAUDE.md`.
- Documentación viva inicial: `docs/STATE.md`, `docs/DECISIONS.md` (ADR-001 a ADR-009), `docs/BACKLOG.md`, `docs/ISSUES.md`, `docs/RULES.md`, `docs/API.md`, `docs/EVENTS.md`, `docs/THREAT_MODEL.md`, `docs/PERF.md` y `docs/RUNBOOKS.md`.
- Monorepo con `pnpm` workspaces y `Turborepo` (`turbo.json`).
- Paquete `@truco/config` con configuraciones compartidas de TypeScript `strict`, ESLint 9 y Prettier.
- Paquete `@truco/shared` con validación Zod de variables de entorno, constantes parametrizadas (`APP_NAME`), formato de error estándar HTTP y envelope WebSocket.
- Paquete `@truco/ui` con tokens de diseño accesibles ("mesa de bar contemporánea") y verificación de contraste WCAG AA.
- Esqueletos tipados y testeados para `@truco/engine`, `@truco/api` (NestJS + Fastify con `/v1/health` y `/v1/ready`), `@truco/game-server` (Socket.IO + validación de envelope), `@truco/web` (React 18 + Vite + Tailwind + PWA) y `@truco/admin` (React 18 + Vite + Tailwind).
- Infraestructura de contenedores: `docker-compose.yml` (PostgreSQL 16 + Redis 7 con healthchecks), Dockerfiles multi-stage en `infra/docker/` y `.env.example` completo.
- Pipeline CI en `.github/workflows/ci.yml` con caché de pnpm/Turbo, servicios Postgres 16 y Redis 7, lint, typecheck, tests, build y auditoría de dependencias.
- Hooks de calidad Git (`husky`, `lint-staged`, `commitlint`) y test de invariantes de repositorio (prohibición de `TODO` sin código `STATE-xx` y validación de `docker-compose.yml`).
