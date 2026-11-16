# Estado del Proyecto ("Mesa de Truco")

- **Última actualización:** 2026-11-13
- **Etapa activa:** Etapa 1 — MVP
- **Módulo actual:** **M2** (Hito con pausa solicitada `⏸` — completado y a la espera de revisión del usuario para iniciar **M3**)

---

## Estado de módulos — Etapa 1 (MVP)

| Módulo | Alcance                                                                                                                   | Hito | Estado         | Notas de verificación                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ---- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** | Monorepo, tooling, CI, `docker-compose` (Postgres 16, Redis 7), `docs/`, `CLAUDE.md`, ADRs 001–009                        | ⏸    | **Verificado** | `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` en verde; `docker-compose.yml` validado por test estructural (ver `ISSUES.md` sobre demonio Docker en sandbox).                                                                |
| **M1** | `packages/truco-engine` completo (`RuleSet`s, `viewFor`, IA heurística, cobertura >= 95%, `docs/RULES.md`)                | ⏸    | **Verificado** | Refinado pre-M2: `responderSelectionMode` configurable (`NEXT_IN_TURN` por defecto en 2v2/N-seat), **100% ramas (`% Branches`)** en `view.ts` y `handlers/*` (**99.64% líneas / 100% funciones / 96.46% ramas** global) y `docs/RULES.md` actualizado.  |
| **M2** | `apps/game-server`: salas, flujo de partida, temporizador, reconexión, Redis, commit-reveal, `docs/EVENTS.md`             | ⏸    | **Verificado** | `GameStore` (`InMemory` + `Redis` con contrato compartido), `RoomActor` single-writer, timers con aviso previo, gracia de 45 s + `game.rejoin` (`lastSeq` / `game.resync`), commit-reveal + AES-256-GCM, crash recovery y tests 1v1/2v2 con cero fugas. |
| **M3** | Auth y usuarios en `apps/api` + Drizzle ORM (invitado, Argon2id, sesiones rotativas, Google OAuth, recuperación)          | —    | Pendiente      | Bloqueado esperando confirmación del usuario tras revisión de M2.                                                                                                                                                                                       |
| **M4** | Lobby y mesas (REST + WS), códigos de 6 caracteres sin ambigüedad, matchmaking simple, `docs/API.md`                      | —    | Pendiente      | —                                                                                                                                                                                                                                                       |
| **M5** | Cliente PWA (`apps/web`) + `packages/ui`: design system, cartas SVG propias, lobby, mesa responsive, aprender, anotador   | ⏸    | Pendiente      | —                                                                                                                                                                                                                                                       |
| **M6** | Partida contra IA, entrenamiento y tutorial interactivo                                                                   | —    | Pendiente      | —                                                                                                                                                                                                                                                       |
| **M7** | Moderación (reportes, sanciones) y `apps/admin` mínimo con RBAC, 2FA y replay auditable                                   | —    | Pendiente      | —                                                                                                                                                                                                                                                       |
| **M8** | Observabilidad, endurecimiento de seguridad, carga k6 (100 y 1.000), staging, `PERF.md`, `THREAT_MODEL.md`, `RUNBOOKS.md` | ⏸    | Pendiente      | —                                                                                                                                                                                                                                                       |

---

## Simulado / Pendiente (Registro obligatorio de `TODO(STATE-xx)`)

Todo elemento provisorio o pendiente de módulos posteriores está registrado aquí y referenciado explícitamente en el código con `// TODO(STATE-xx)`:

| ID         | Ubicación principal                                                            | Descripción                                                                                                               | Módulo objetivo      |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `STATE-03` | `apps/api` (auth, users, db)                                                   | Esquema Drizzle PostgreSQL 16, migraciones, sesiones HttpOnly rotativas, Argon2id, Google OAuth y `ConsoleEmailProvider`. | **M3**               |
| `STATE-04` | `apps/api` (lobby), `docs/API.md`                                              | Endpoints REST `/v1/tables` y `/v1/matchmaking/queue`, códigos de mesa y sincronización WS de lobby.                      | **M4**               |
| `STATE-05` | `apps/web`, `packages/ui`                                                      | Componentes completos del sistema de diseño, baraja española SVG original y pantallas MVP de la PWA.                      | **M5**               |
| `STATE-06` | `apps/web`, `packages/truco-engine`                                            | Flujo completo contra IA local/servidor y tutorial interactivo paso a paso.                                               | **M6**               |
| `STATE-07` | `apps/admin`, `apps/api` (moderation/admin)                                    | Reportes, sanciones con motivo obligatorio, 2FA administrativo, `audit_logs` y visor de replay.                           | **M7**               |
| `STATE-08` | `infra/`, `apps/*`, `docs/PERF.md`, `docs/THREAT_MODEL.md`, `docs/RUNBOOKS.md` | OpenTelemetry, Sentry, `/v1/metrics` Prometheus, pruebas de carga k6 (100/1.000 usuarios) y runbooks operativos.          | **M8**               |
| `STATE-09` | `docs/THREAT_MODEL.md`                                                         | Revisión legal formal de tratamiento, retención y supresión de datos personales bajo Ley 25.326 (República Argentina).    | **Pre-Prod / Legal** |

---

## Ítems Resueltos / Cerrados

| ID         | Resolución                                                                                                                                                             | Módulo cerrado |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `STATE-01` | Motor puro `@truco/engine` completo con `RuleSet`s, `viewFor`, `projectEventsForSeat`, IA heurística y cobertura >= 95%.                                               | **M1**         |
| `STATE-02` | `apps/game-server` autoritativo con `GameStore` (`InMemory` + `Redis`), `RoomActor` single-writer, timers, reconexión, commit-reveal + AES-256-GCM y `docs/EVENTS.md`. | **M2**         |

---

## Próximos pasos inmediatos

1. Recibir confirmación del usuario sobre la revisión del cierre de **M2** (`⏸`).
2. Iniciar **M3**: implementar autenticación y gestión de usuarios en `apps/api` con PostgreSQL 16 + Drizzle ORM (migraciones iniciales, sesión de invitado efímera, registro/login con Argon2id, sesiones HttpOnly rotativas, Google OAuth tras interfaz y recuperación de contraseña con `ConsoleEmailProvider`).
