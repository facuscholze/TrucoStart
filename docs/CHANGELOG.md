# Changelog

Todos los cambios notables de este proyecto se documentan por módulo siguiendo [Conventional Commits](https://www.conventionalcommits.org/).

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
