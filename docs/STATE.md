# Estado del Proyecto ("Mesa de Truco")

- **Última actualización:** 2026-11-13
- **Etapa activa:** Etapa 1 — MVP
- **Módulo actual:** **M4** (Completado y en pausa en el cierre de **M4** esperando confirmación antes de iniciar **M5**)

---

## Estado de módulos — Etapa 1 (MVP)

| Módulo | Alcance                                                                                                                   | Hito | Estado         | Notas de verificación                                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ---- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** | Monorepo, tooling, CI, `docker-compose` (Postgres 16, Redis 7), `docs/`, `CLAUDE.md`, ADRs 001–009                        | ⏸    | **Verificado** | `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` en verde; `docker-compose.yml` validado por test estructural (ver `ISSUES.md` sobre demonio Docker en sandbox).                                                                    |
| **M1** | `packages/truco-engine` completo (`RuleSet`s, `viewFor`, IA heurística, cobertura >= 95%, `docs/RULES.md`)                | ⏸    | **Verificado** | `responderSelectionMode` configurable (`NEXT_IN_TURN` por defecto en 2v2/N-seat), `maxConsecutiveTimeoutsBeforeAbandon = 3`, **100% ramas** en `view.ts` y `handlers/*` (**99.64% líneas** global) y `docs/RULES.md` actualizado.                           |
| **M2** | `apps/game-server`: salas, flujo de partida, temporizador, reconexión, Redis, commit-reveal, `docs/EVENTS.md`             | ⏸    | **Verificado** | PR #1 en verde en GitHub Actions (`RedisGameStore` contra Redis 7 real + Postgres 16), `RoomActor` single-writer, timers, reconexión `lastSeq`/`game.resync`, commit-reveal + AES-256-GCM y cero fugas en 1v1/2v2.                                          |
| **M3** | Auth y usuarios en `apps/api` + Drizzle ORM (invitado, Argon2id, sesiones rotativas, Google OAuth, recuperación, OpenAPI) | ⏸    | **Verificado** | Verificado en CI contra PostgreSQL 16 + Redis 7 reales (`4087eb1`), `RateLimitStore` (`InMemory` + `Redis`), lockout `(cuenta + IP)` + Captcha (`ADR-015`), `ws-ticket` single-use (`jti`), rutas propias exclusivas `/v1/me` y `SameSite=Lax` (`ADR-016`). |
| **M4** | Lobby y mesas (REST + `/lobby` WS), códigos de 6 caracteres sin ambigüedad, matchmaking (`1v1`/`2v2`), persistencia SQL   | —    | **Completado** | `apps/api` fuente de verdad (`tables` + `table_seats`), RPC interno firmado HMAC hacia `game-server` + eventos BullMQ/Redis (`ADR-017`), `/lobby` WS cero fugas, `MatchmakingStore` (`InMemory` + `Redis`) y E2E real `apps/api` + `apps/game-server`.      |
| **M5** | Cliente PWA (`apps/web`) + `packages/ui`: design system, cartas SVG propias, lobby, mesa responsive, aprender, anotador   | ⏸    | Pendiente      | Bloqueado esperando confirmación del usuario tras revisión del cierre de **M4**.                                                                                                                                                                            |
| **M6** | Partida contra IA, entrenamiento y tutorial interactivo                                                                   | —    | Pendiente      | —                                                                                                                                                                                                                                                           |
| **M7** | Moderación (reportes, sanciones) y `apps/admin` mínimo con RBAC, 2FA y replay auditable                                   | —    | Pendiente      | —                                                                                                                                                                                                                                                           |
| **M8** | Observabilidad, endurecimiento de seguridad, carga k6 (100 y 1.000), staging, `PERF.md`, `THREAT_MODEL.md`, `RUNBOOKS.md` | ⏸    | Pendiente      | —                                                                                                                                                                                                                                                           |

---

## Simulado / Pendiente (Registro obligatorio de `TODO(STATE-xx)`)

Todo elemento provisorio o pendiente de módulos posteriores está registrado aquí y referenciado explícitamente en el código con `// TODO(STATE-xx)`:

| ID         | Ubicación principal                                                            | Descripción                                                                                                                | Módulo objetivo      |
| ---------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `STATE-05` | `apps/web`, `packages/ui`                                                      | Componentes completos del sistema de diseño, baraja española SVG original y pantallas MVP de la PWA.                       | **M5**               |
| `STATE-06` | `apps/web`, `packages/truco-engine`                                            | Flujo completo contra IA local/servidor y tutorial interactivo paso a paso.                                                | **M6**               |
| `STATE-07` | `apps/admin`, `apps/api` (moderation/admin)                                    | Reportes, sanciones con motivo obligatorio, 2FA administrativo, `audit_logs` y visor de replay.                            | **M7**               |
| `STATE-08` | `infra/`, `apps/*`, `docs/PERF.md`, `docs/THREAT_MODEL.md`, `docs/RUNBOOKS.md` | OpenTelemetry, Sentry, `/v1/metrics` Prometheus, pruebas de carga k6 (100/1.000 usuarios) y runbooks operativos.           | **M8**               |
| `STATE-09` | `docs/THREAT_MODEL.md`                                                         | Revisión legal formal de tratamiento, retención y supresión de datos personales bajo Ley 25.326 (República Argentina).     | **Pre-Prod / Legal** |
| `STATE-10` | `apps/api/src/modules/auth/providers/email.provider.ts`                        | `ConsoleEmailProvider` simulado en dev/test; adaptador productivo (`Resend` / `SMTP`) pendiente de credenciales reales.    | **Pre-Prod / Infra** |
| `STATE-11` | `apps/api/src/modules/auth/providers/google-oauth.verifier.ts`                 | `SimulatedGoogleOAuthVerifier` simulado en dev/test; verificación JWKS contra Google Identity pendiente de Client ID real. | **Pre-Prod / Infra** |
| `STATE-12` | `apps/api/src/modules/auth/providers/captcha.verifier.ts`                      | `SimulatedCaptchaVerifier` simulado en dev/test; verificación HTTP contra Cloudflare Turnstile pendiente de claves reales. | **Pre-Prod / Infra** |

> **Nota sobre adaptadores locales en tests sin Docker (`ISS-001`):** `RateLimitStore`, `MatchmakingStore`, `GameStore` y el bus `MatchLifecyclePublisher`/`MatchLifecycleConsumer` poseen implementaciones reales en Redis 7 / BullMQ ejecutadas automáticamente en GitHub Actions CI (`REDIS_URL` + `DATABASE_URL`) e implementaciones en memoria equivalentes verificadas por suites contractuales para pruebas locales en el sandbox sin Docker.

---

## Ítems Resueltos / Cerrados

| ID         | Resolución                                                                                                                                                                                  | Módulo cerrado |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `STATE-01` | Motor puro `@truco/engine` completo con `RuleSet`s, `viewFor`, `projectEventsForSeat`, IA heurística y cobertura >= 95%.                                                                    | **M1**         |
| `STATE-02` | `apps/game-server` autoritativo con `GameStore` (`InMemory` + `Redis`), `RoomActor` single-writer, timers, reconexión, commit-reveal + AES-256-GCM y `docs/EVENTS.md`.                      | **M2**         |
| `STATE-03` | `apps/api` Auth y Usuarios endurecidos con `RateLimitStore`, lockout `(cuenta + IP)` + Captcha (`ADR-015`), `ws-ticket` single-use (`jti`), `/v1/me` exclusivo y OpenAPI 3.1 (`ADR-016`).   | **M3**         |
| `STATE-04` | Lobby REST (`/v1/tables/*`), namespace WS aislado `/lobby` sin fugas, códigos de 6 chars + invitaciones HMAC, matchmaking `1v1`/`2v2` y persistencia transaccional de partidas (`ADR-017`). | **M4**         |

---

## Próximos pasos inmediatos

1. Recibir confirmación del usuario sobre la revisión del cierre de **M4**.
2. Iniciar **M5** (hito con pausa ⏸): implementar el sistema de diseño en `packages/ui`, la baraja española SVG original y las pantallas responsive del cliente PWA en `apps/web` (inicio, lobby en vivo, mesa de juego, aprender y anotador).
