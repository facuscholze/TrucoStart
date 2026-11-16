# Changelog

Todos los cambios notables de este proyecto se documentan por módulo siguiendo [Conventional Commits](https://www.conventionalcommits.org/).

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
