Vas a construir desde cero, en este repositorio vacío, la plataforma web completa descrita en este mensaje: un truco argentino online en tiempo real. Este mensaje es tu especificación completa. Leelo entero antes de hacer nada.

## 0. Rol, modo de trabajo y reglas absolutas

Sos un equipo senior (arquitecto, full-stack, desarrollador de juegos multijugador, DevOps/seguridad, UX). Vas a construir **la plataforma web completa** descrita en este documento, de forma **incremental, verificable y mantenible**, módulo por módulo, ejecutando comandos reales (instalar, compilar, testear, levantar servicios) y verificando cada resultado.

**Reglas absolutas**

1. Nada de código improvisado ni demos descartables. Calidad de producción para el alcance de cada módulo.
2. No concentres lógica en pocos archivos. Separación de responsabilidades según la estructura de carpetas de la sección 7.
3. Sin hardcode innecesario: configuración por entorno, constantes con nombre, reglas del juego solo en `RuleSet`.
4. Sin duplicar lógica: si se repite, va a `packages/shared` o a una utilidad.
5. Validá toda entrada externa (HTTP y WebSocket) con esquemas Zod compartidos.
6. Cada módulo se entrega con tests automatizados. Si fallan, no avanzás.
7. Seguridad y rendimiento desde el diseño, no al final.
8. **Prohibido** dejar botones, pantallas o endpoints sin implementar sin marcarlos. Todo lo provisorio se lista en `docs/STATE.md` bajo "Simulado / Pendiente" y se señala en el código con `// TODO(STATE-xx)`.
9. No simules integraciones críticas (email, OAuth, captcha, pagos) sin una interfaz clara y un mock explícito e identificado (por ejemplo `ConsoleEmailProvider` en desarrollo).
10. Documentá decisiones importantes como ADR en `docs/DECISIONS.md`.
11. Si algo es ambiguo, elegí la opción más conservadora, registrala en `DECISIONS.md` y seguí. No inventes requisitos nuevos ni funcionalidades de etapas futuras.
12. No copies código, diseños, marcas ni assets de terceros. Los assets (cartas, íconos) se crean originales (SVG propios).
13. **Sin dinero real ni ventaja pagada.** Prohibido implementar apuestas, depósitos, retiros, premios monetarios, compra con dinero o transferencias entre jugadores. Se permite únicamente la `VIRTUAL_COIN` simbólica de M9c: sin valor económico, no transferible/no comprable y canjeable por cosméticos que no alteren reglas ni matchmaking; mantener las restricciones de base de datos y la revisión de `docs/LEGAL_CHECKLIST.md`.
14. Nunca commitees secretos. Usá `.env.example`.
15. Hacé commits pequeños y descriptivos (Conventional Commits) al cerrar cada tarea, en una rama por módulo (`feat/m1-engine`, etc.).

### Archivos de memoria del proyecto (obligatorios, actualizar en cada entrega)

| Archivo | Contenido |
|---|---|
| `CLAUDE.md` | Resumen operativo para futuras sesiones: comandos, convenciones, reglas absolutas (copiá la sección 0) y la indicación de leer `docs/MASTER_PROMPT.md` ante dudas de alcance, enlace a `docs/STATE.md` |
| `docs/STATE.md` | Fase actual, módulos y su estado (Pendiente / En curso / Hecho / Verificado), Simulado/Pendiente, próximos pasos |
| `docs/DECISIONS.md` | ADRs numerados: contexto, decisión, alternativas, consecuencias |
| `docs/BACKLOG.md` | Funcionalidades futuras priorizadas |
| `docs/ISSUES.md` | Problemas, riesgos y deuda técnica |
| `docs/CHANGELOG.md` | Cambios por entrega |

Al iniciar **cada sesión**: leé `CLAUDE.md` y `docs/STATE.md` antes de escribir código.

### Protocolo por módulo

1. Plan breve con criterios de aceptación (usá modo plan si está disponible).
2. Implementación.
3. Tests (unitarios, integración, E2E según corresponda).
4. Ejecutar lint, typecheck y tests. Corregir hasta verde.
5. Actualizar docs y estado, commit.
6. Reporte: qué se hizo, cómo se verificó, qué queda pendiente.
7. **Parar y esperar mi confirmación** solo en los hitos marcados con ⏸. En el resto, continuá al siguiente módulo.

### Definición de "hecho" de un módulo

Criterios cumplidos, tests en verde, lint/tipos sin errores, sin `TODO` sin número, validación y autorización revisadas, docs y estado actualizados, y demostración reproducible (comando o test que lo prueba).

---

## 1. Producto

**Nombre de trabajo:** "Mesa de Truco" (parametrizar el nombre en configuración, es provisorio).

Plataforma web (PWA, mobile-first) para jugar **truco argentino** online en tiempo real, en español rioplatense, con identidad cultural moderna. Entretenimiento con **monedas virtuales sin valor monetario, sin retiros ni transferencias entre jugadores**.

**Objetivos:** reglas correctas, configurables y auditables; partidas fluidas, justas y resistentes a trampas; excelente experiencia móvil y de escritorio; arquitectura que escale de 100 a 50.000+ usuarios sin reescritura; retención por mecánicas sociales y competitivas **sin pay-to-win**.

## 2. Alcance por etapas

- **Etapa 1, MVP (construir primero y completo):** invitado y cuenta, perfil básico, lobby, partida rápida, mesas públicas y privadas (código/enlace), 1v1 y 2v2, IA para práctica y tutorial, anotador, chat rápido (frases predefinidas y emotes), señas en 2v2, temporizador, reconexión, abandono, reportes, moderación y admin mínimos, telemetría.
- **Etapa 2, Crecimiento:** amigos, invitaciones, desafíos, historial, rankings (global, semanal, mensual, por modo), Glicko-2, XP, niveles, logros, misiones diarias, notificaciones.
- **Etapa 3, Competitividad:** torneos, ligas, temporadas, truco de 6, espectadores con retraso, detección de colusión.
- **Etapa 4, Ecosistema:** comunidades y equipos, tienda cosmética, pase de temporada, premium, eventos.
- **Etapa 5, Escalabilidad:** particionado, servidor de partidas extraído y por región, observabilidad avanzada.

**Excluido del MVP:** voz, marketplace, espectadores, torneos, tienda, pagos, comunidades, apps nativas. No implementar nada de una etapa hasta cerrar la anterior (criterios de cierre en la sección 29).

## 3. Decisiones tecnológicas ya tomadas (registrar como ADR-001 a ADR-008)

| Área | Decisión |
|---|---|
| Lenguaje | TypeScript `strict` en todo el repo |
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | React 18 + Vite + Tailwind + TanStack Query + Zustand + Framer Motion + `vite-plugin-pwa` |
| API | NestJS con adaptador Fastify, módulos por dominio |
| Tiempo real | Socket.IO (reconexión y rooms resueltos). Protocolo con envelope propio (sección 10) |
| Validación | Zod en `packages/shared`, reutilizado por cliente y servidor |
| ORM | Drizzle ORM + drizzle-kit (migraciones versionadas) sobre PostgreSQL 16 |
| Estado vivo | Redis 7 (salas, presencia, rate limit, pub/sub, caché) |
| Colas | BullMQ |
| Auth | Cookies HttpOnly para sesión web + refresh rotativo, Argon2id, OAuth Google |
| Tests | Vitest, fast-check, Supertest, Testcontainers, Playwright, k6 |
| Calidad | ESLint, Prettier, Husky, lint-staged, commitlint |
| Contenedores/CI | Docker multi-stage, docker-compose para desarrollo, GitHub Actions |
| Observabilidad | pino (logs JSON), OpenTelemetry, Sentry, `/metrics` Prometheus |

Principio arquitectónico: **monolito modular** (no microservicios). El **Game Server** corre como proceso separado desde el inicio (mismo repo) porque es el único componente que se escalará aparte.

## 4. Arquitectura

```
Cliente PWA (React)
   │ HTTPS REST             │ WSS (Socket.IO)
   ▼                        ▼
 apps/api (NestJS) ◄────► apps/game-server (Node)
   │                          │
   ├─ PostgreSQL              ├─ Redis (snapshot + log de eventos, salas, presencia)
   ├─ Redis (caché, límites)  └─ packages/truco-engine (reglas puras)
   └─ BullMQ (jobs)
```

- Servidor **autoritativo**: el cliente solo envía intenciones. Nunca confiar en el cliente para cartas, jugadas válidas, turnos ni ganadores.
- `packages/truco-engine` no depende de red, base de datos, fechas ni azar interno (RNG inyectado).
- El estado de una partida vive en memoria en **un solo proceso** (single-writer por sala) y se persiste en Redis tras cada acción (snapshot + log de eventos). Si el proceso cae, otra instancia reconstruye la sala.
- Al terminar una partida: transacción que guarda `matches`, `match_players`, `match_events`; luego jobs calculan rating y recompensas.

## 5. Estructura de carpetas

```
/
├─ apps/
│  ├─ web/            # PWA jugador
│  ├─ admin/          # Panel administrativo (app separada)
│  ├─ api/            # NestJS: auth, users, lobby, social, ranking, economy, moderation, health
│  └─ game-server/    # Servidor WS de partidas
├─ packages/
│  ├─ truco-engine/   # Reglas puras, RuleSets, viewFor, IA base
│  ├─ shared/         # Esquemas Zod, tipos, contratos REST/WS, constantes, códigos de error
│  ├─ ui/             # Componentes reutilizables y tokens de diseño
│  └─ config/         # eslint, tsconfig, prettier compartidos
├─ infra/             # Dockerfiles, compose, dashboards, scripts
├─ docs/              # STATE, DECISIONS, BACKLOG, ISSUES, CHANGELOG, RULES, API, EVENTS, THREAT_MODEL, PERF, RUNBOOKS
└─ .github/workflows/
```

Cada módulo del API: `controller`, `service`, `repository`, `dto/schemas`, `tests`. **Prohibidos** archivos que mezclen red, reglas del juego y persistencia.

## 6. Motor de reglas (`packages/truco-engine`), el corazón del producto

**Contrato**

```ts
createGame(ruleset: RuleSet, players: PlayerSeat[], rng: Rng): GameState
applyAction(state: GameState, action: Action): Result<{ state: GameState; events: DomainEvent[] }, RuleError>
legalActions(state: GameState, seat: SeatId): Action[]
viewFor(state: GameState, seat: SeatId): PlayerView   // ÚNICA salida de estado hacia clientes
scoreEnvido(cards: Card[]): number
compareCards(a: Card, b: Card): -1 | 0 | 1
isFlor(cards: Card[]): boolean
```

**Reglas a implementar (todas parametrizadas por `RuleSet`)**

- **Baraja:** española de 40 cartas (sin 8, 9 ni comodines). 3 cartas por jugador.
- **Jerarquía de truco (mayor a menor):** 1 de espadas, 1 de bastos, 7 de espadas, 7 de oros, los 3, los 2, 1 de copas y 1 de oros, los 12, los 11, los 10, 7 de copas y 7 de bastos, los 6, los 5, los 4. Igual jerarquía entre cartas del mismo grupo = empate (parda).
- **Envido:** valor = 20 + suma de las dos cartas más altas del mismo palo (10, 11 y 12 valen 0). Sin dos del mismo palo, vale la carta más alta (0 a 7). Puntos: Envido 2, Real Envido 3, Falta Envido (lo que le falta al equipo líder para ganar, configurable). Cadenas permitidas en `RuleSet` (por ejemplo Envido, Envido, Real, Falta). No querido: puntos acumulados antes del canto rechazado, mínimo 1. Empate de tanto: gana el mano. Solo puede cantarse antes de que se juegue la segunda carta de la mano (ronda 1). "El envido está primero" configurable.
- **Flor (configurable, activada por defecto en la variante estándar):** tres cartas del mismo palo. Flor 3 puntos, contraflor y contraflor al resto según `RuleSet`. Si está desactivada, no existe en `legalActions`.
- **Truco:** Truco 2, Retruco 3, Vale Cuatro 4. Solo el equipo que NO cantó el último nivel puede subir. "Quiero", "No quiero" (el rival suma los puntos del nivel anterior; 1 si era Truco) y "Quiero y subo".
- **Mano y rondas:** gana la mano quien gana 2 de 3 rondas. Parda en la 1ª: decide la 2ª. Si la 1ª fue ganada y la 2ª empata, gana quien ganó la 1ª. Si empatan las tres, gana el mano. Primera carta de cada ronda: la juega quien ganó la anterior.
- **Irse al mazo:** el rival suma puntos de truco vigentes (1 si no hubo canto) y el envido pendiente se resuelve según `RuleSet`.
- **Puntuación:** a 15 o a 30 (`RuleSet`). Mano de once configurable. Orden de turnos antihorario; el "mano" rota cada mano.
- **Equipos:** 1v1, 2v2 (compañero enfrentado). 3 equipos de 2 o 2 de 3 para 6 jugadores (Etapa 3, diseñar el motor para N asientos desde el inicio).
- **Señas (2v2):** catálogo definido en datos (`signals.json`), visibles solo para el compañero, con límite de frecuencia y registro auditable en `match_events`.
- **Desconexión, abandono y timeout:** acciones del sistema (`SYSTEM_TIMEOUT`, `SYSTEM_ABANDON`) con reglas en `RuleSet`.
- **RuleSets iniciales:** `ar-standard-v1` (con flor, a 30), `ar-sin-flor-v1`, `ar-corto-15-v1`. Estructura lista para variantes regionales sin tocar el motor.

**Tests obligatorios:** tabla exhaustiva de comparación de cartas; cálculo de envido (todas las combinaciones); empates y pardas; encadenamientos de cantos; finales de mano; flor activa e inactiva; property-based con fast-check (ningún estado ilegal alcanzable, puntajes monótonos, 40 cartas únicas, `viewFor` nunca expone cartas ajenas); simulación de miles de partidas aleatorias sin errores. **Cobertura mínima 95%.** Documentar reglas y variantes en `docs/RULES.md`.

## 7. Game Server y multijugador

- Una instancia de partida por sala, single-writer, en memoria. Persistencia en Redis tras cada acción.
- Temporizador de turno configurable (por defecto 30 s), con aviso previo; al vencer, acción de sistema según `RuleSet`.
- **Reconexión:** el cliente envía `sessionId` y `lastSeq`; el servidor reenvía eventos faltantes o un `game.resync` (snapshot filtrado). Gracia de 45 s antes de abandono.
- **Mezcla:** `crypto.randomBytes` + Fisher-Yates sin sesgo. Se publica un commitment (hash) de la semilla al iniciar la partida y se revela al final.
- Salas y asientos, ready-check, revancha, una partida activa por cuenta, registro `roomId → serverId` en Redis, cola de emparejamiento simple (MVP) por modo.
- Drenaje elegante al desplegar: no cortar partidas en curso.

## 8. Base de datos (PostgreSQL, UUID v7, `created_at/updated_at`, migraciones con drizzle-kit)

| Tabla | Campos clave | Notas |
|---|---|---|
| `users` | id, email (null si invitado), password_hash, nickname, is_guest, status | nickname único case-insensitive; email único |
| `sessions` | id, user_id, refresh_hash, device, expires_at, revoked_at | |
| `profiles` | user_id, avatar_id, level, xp, bio, settings jsonb | 1:1 users |
| `rulesets` | id, code, version, config jsonb | |
| `tables` | id, owner_id, mode, ruleset_id, visibility, join_code, status | índice (status, visibility, mode) |
| `matches` | id, table_id, mode, ruleset_id, seed_commitment, started_at, ended_at, result jsonb | |
| `match_players` | match_id, user_id, seat, team, score, outcome, rating_delta | PK (match_id, seat) |
| `match_events` | match_id, seq, type, payload jsonb, created_at | PK (match_id, seq); particionable por mes |
| `reports` | id, reporter_id, target_id, match_id, reason, status | |
| `sanctions` | id, user_id, type, reason, expires_at, issued_by | |
| `audit_logs` | id, actor_id, action, entity, before/after jsonb, ip, created_at | solo inserción |
| Etapa 2+ | `friendships`, `ratings`, `seasons`; M9c: `progression_config`, `achievement_catalog`, `user_achievements`, `quest_templates`, `user_quests`, `progression_xp_entries`, `wallet_accounts`, `wallet_transactions` (libro mayor inmutable, sin saldo negativo), `cosmetic_catalog`, `user_cosmetics`, `progression_notifications` |
| Etapa 3+ | `tournaments`, `tournament_entries`, `tournament_matches` | |
| Etapa 4+ | `cosmetics`, `user_cosmetics`, `communities`, `community_members` | |

## 9. API REST (prefijo `/v1`, OpenAPI, errores `{ error: { code, message, details } }`, paginación por cursor)

| Grupo | Endpoints |
|---|---|
| Auth | `POST /auth/guest`, `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot`, `/auth/reset`, `/auth/google`, `/auth/promote-guest` |
| Usuarios | `GET/PATCH /me`, `GET /users/:id`, `GET /users/:id/stats`, `GET /users/:id/matches` |
| Lobby | `GET /tables`, `POST /tables`, `GET /tables/:id`, `POST /tables/join-by-code`, `DELETE /tables/:id`, `POST/DELETE /matchmaking/queue` |
| Moderación | `POST /reports`; admin: `GET /admin/reports`, `POST /admin/sanctions`, `GET /admin/users`, `GET /admin/matches/:id/replay`, `GET /admin/audit` |
| Salud | `GET /health`, `GET /ready`, `GET /metrics` |
| Etapa 2+ | Social y rankings; M9c: `/me/progression`, `/me/progression/missions/:id/claim`, `/me/progression/cosmetics/:id/redeem`, `/me/progression/notifications/:id/read`; admin `/admin/progression/config` y `/admin/progression/wallet-transactions/:id/reverse` |

Cada endpoint: esquema compartido de entrada y salida, autorización explícita, rate limit y tests.

## 10. Protocolo WebSocket (Socket.IO)

Handshake autenticado. Todo mensaje lleva `{ eventId, seq?, ts, type, payload }` validado con Zod.

**Cliente → servidor:** `table.join`, `table.leave`, `table.ready`, `game.playCard {cardId}`, `game.call {type: ENVIDO|REAL_ENVIDO|FALTA_ENVIDO|FLOR|TRUCO|RETRUCO|VALE_CUATRO}`, `game.respond {call, answer: QUIERO|NO_QUIERO|SUBIR}`, `game.foldHand`, `game.signal {signalId}`, `chat.quick {phraseId}`, `game.rejoin {lastSeq}`.

**Servidor → cliente:** `table.state`, `game.started`, `game.dealt` (solo cartas propias), `game.turn {seat, deadline}`, `game.cardPlayed`, `game.callMade`, `game.callResolved`, `game.handEnded`, `game.scoreUpdated`, `game.ended`, `player.disconnected`, `player.reconnected`, `game.resync`, `error {code}`.

Garantías: orden por `seq`, idempotencia por `eventId`, reenvío de faltantes al reconectar, **jamás** información privada a otros asientos. Documentar en `docs/EVENTS.md`.

## 11. Autenticación y usuarios

Invitado (cuenta efímera con apodo generado, promovible a cuenta real conservando progreso), email/contraseña con Argon2id, Google OAuth, verificación de email, recuperación, cookies HttpOnly/Secure/SameSite, refresh rotativo con detección de reutilización, bloqueo progresivo, gestión de dispositivos, eliminación y exportación de datos, filtro de apodos ofensivos. Proveedor de email detrás de una interfaz (en desarrollo, `ConsoleEmailProvider`).

## 12. Lobby, social, rankings, torneos, gamificación

- **Lobby (MVP):** lista en tiempo real con filtros (modo, puntos, reglas), "Jugar ya", crear mesa (modo, 15/30, flor, privada, tiempo por turno), unirse por código de 6 caracteres sin ambigüedades (sin 0/O/1/I) o enlace firmado.
- **Social (E2):** amigos, presencia, invitaciones, desafíos directos, bloqueo, reportes. Chat libre solo con filtros y moderación, no en MVP.
- **Rankings (E2):** Glicko-2 por modo y temporada; jobs que recalculan semanal, mensual y de temporada; caché en Redis; reinicio visible con cuenta regresiva; mínimo de partidas y de rivales distintos para figurar.
- **Torneos (E3):** eliminación simple/doble y suizo, inscripción, check-in, llaves con semillas, avance automático, premios solo cosméticos o monedas virtuales.
- **Gamificación (E2/E4):** M9c entrega XP, niveles, logros, misiones, notificaciones persistentes y moneda virtual simbólica con libro mayor inmutable/topes diarios; quedan para etapas futuras las rachas y el pase de temporada. La moneda no tiene valor económico, no se compra ni transfiere y sólo desbloquea cosméticos. **Nada que afecte el resultado del juego se obtiene ni se vende.**

## 13. Panel administrativo (`apps/admin`)

RBAC (jugador, soporte, moderador, admin), 2FA obligatorio. Secciones: dashboard de métricas, usuarios, partidas (replay desde `match_events`), mesas, reportes y denuncias, sanciones (advertencia, silencio, suspensión, bloqueo) con motivo obligatorio, configuración (feature flags y `RuleSet`), logs y auditoría, soporte. En etapas posteriores: torneos y economía. Toda acción queda en `audit_logs`.

## 14. UX/UI y responsive

- **Mobile-first** (360, 768, 1200 px). Identidad "mesa de bar contemporánea": paño verde `#0F3D2E`, superficie `#14201B`, texto `#F4EFE6`, dorado `#E0B84C`, celeste `#6FB1E0`, peligro `#D6523F`, éxito `#4CB782`. Validar contraste AA.
- Tipografías: display con carácter (por ejemplo Fraunces, licencia abierta) + sans legible (Inter) con números tabulares para puntajes.
- Tokens de diseño y componentes en `packages/ui`: `Card`, `Hand`, `Table`, `ScoreBoard` (fósforos o porotos), `CallButton`, `PlayerSeat`, `QuickChat`, `Toast`, `Modal`, `Avatar`, `Badge`, `RankRow`.
- **Mesa en móvil:** mano propia abajo, rivales arriba y a los lados, puntaje en barra compacta, bandeja de cantos que sube desde abajo, botones táctiles de al menos 44 px, cantos agrupados (Envido, Truco, Flor) con confirmación visual. **En escritorio:** mesa horizontal ampliada con panel lateral.
- Microinteracciones: reparto, golpe de carta, destello de victoria, animación breve de "¡Truco!". Respetar `prefers-reduced-motion`. No depender solo del color para los palos. Estados de carga, error y vacío en cada pantalla. Teclado y lector de pantalla en lobby y menús.
- Cartas con diseño original en SVG (palos y figuras reconocibles).
- **Pantallas MVP:** splash/onboarding, entrar como invitado/login/registro/recuperar, home, jugar (partida rápida, lobby, crear mesa, unirse por código, contra IA), mesa de juego, resultado y revancha, perfil, ajustes, aprender (reglas, señas, tutorial interactivo, anotador).

## 15. Seguridad

Servidor autoritativo; `viewFor` como única salida de estado; validación Zod en todo; rate limiting por IP, usuario y evento WS (límites distintos para chat, cantos y creación de mesas); CORS estricto, CSRF para cookies, cabeceras de seguridad (helmet); Argon2id; rotación de tokens; RBAC con verificación por recurso; captcha adaptativo en registro (detrás de interfaz); detección de anomalías y colusión con revisión humana antes de sancionar; CSPRNG; log de auditoría inmutable; secretos fuera del repo; dependencias auditadas en CI; backups cifrados con restauración probada. **Tests que demuestren que ningún mensaje WS filtra cartas ajenas.** Modelo de amenazas en `docs/THREAT_MODEL.md`. Datos personales mínimos y política de retención (Ley 25.326 de Argentina: dejar el tema marcado para revisión legal).

## 16. Rendimiento y escalabilidad

Metas MVP: p95 de acción confirmada < 150 ms en región; JS crítico de la PWA < 200 KB comprimido (a validar); animaciones fluidas en móviles de gama media. Mensajes WS compactos, caché de rankings, índices verificados con `EXPLAIN`, pool de conexiones. Pruebas de carga con k6 a 100 y 1.000 usuarios simultáneos, con informe en `docs/PERF.md`. Diseñar sin asumir capacidad: validar con mediciones.

## 17. Testing

Unitarios (motor 95%+), integración (API con Postgres y Redis reales vía Testcontainers), contrato (esquemas compartidos), E2E con Playwright (invitado → partida completa 1v1 y 2v2, reconexión, abandono), carga (k6), seguridad (SAST/SCA, tests de autorización). CI bloquea merges con tests fallidos.

## 18. Despliegue y variables de entorno

Docker multi-stage, entornos `dev`, `staging`, `prod`, migraciones controladas, despliegue sin downtime del API, drenaje del Game Server, CDN/WAF delante, backups diarios, runbooks en `docs/RUNBOOKS.md`.

`.env.example` (sin valores reales) con al menos: `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `REFRESH_TOKEN_TTL`, `COOKIE_DOMAIN`, `CORS_ORIGINS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_PROVIDER`, `EMAIL_PROVIDER_API_KEY`, `CAPTCHA_PROVIDER`, `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET`, `SEED_ENCRYPTION_KEY`, `RATE_LIMIT_*`, `TURN_TIMEOUT_MS`, `RECONNECT_GRACE_MS`, `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `S3_*`. Validación de entorno al arrancar con Zod (fallar rápido si falta algo).

## 19. Monitoreo y documentación

Logs estructurados con correlación, métricas (partidas activas, conexiones WS, latencia de acción, errores, cola de jobs, reconexiones), trazas, alertas por SLO y dashboards, métricas de producto (D1/D7/D30, partidas por usuario, tiempo a primera partida, abandono). Documentación: README con arranque en un comando (`pnpm dev` + `docker compose up`), arquitectura, reglas, OpenAPI, eventos WS, modelo de datos, guía de contribución, runbooks, modelo de amenazas, ADRs.

---

## 20. Plan de ejecución por módulos (Etapa 1)

| Módulo | Contenido | Criterio de cierre |
|---|---|---|
| **M0** ⏸ | Monorepo, tooling, CI, docker-compose (Postgres, Redis), archivos `docs/` y `CLAUDE.md`, ADRs 001 a 008 | `pnpm install && pnpm lint && pnpm test && docker compose up` funcionan |
| **M1** ⏸ | `truco-engine` completo con `RuleSet`s, `viewFor`, IA base (heurística), tests y `docs/RULES.md` | Cobertura ≥ 95%, property tests y simulación en verde |
| **M2** | Game Server: salas, flujo de partida, temporizador, reconexión, persistencia en Redis, commit-reveal | Test de integración con 2 y 4 clientes simulados; caída y recuperación de proceso |
| **M3** | Auth y usuarios (invitado, registro, login, Google, recuperación, sesiones) | Tests de seguridad y de flujo completos |
| **M4** | Lobby y mesas (REST + suscripción WS), códigos, matchmaking simple | E2E de crear/unirse/jugar |
| **M5** ⏸ | Cliente web: design system, lobby, mesa responsive, aprendizaje, anotador, PWA | Playwright: partida completa en móvil y escritorio |
| **M6** | Contra IA, entrenamiento y tutorial interactivo | Partida completa contra IA sin errores |
| **M7** | Moderación (reportes, sanciones) y admin mínimo con replay | Acciones auditadas, 2FA admin |
| **M8** ⏸ | Observabilidad, endurecimiento de seguridad, pruebas de carga (100 y 1.000), despliegue a staging, documentación final | `docs/PERF.md`, `THREAT_MODEL.md` y runbooks completos; **MVP listo para validar** |

Luego, y solo con mi aprobación, continuar con las Etapas 2 a 5 usando el mismo protocolo, creando módulos M9 en adelante y actualizando `docs/STATE.md`.

## 21. Criterios de cierre de etapa

- **MVP → E2:** suite de reglas 100% verde, 100 partidas simultáneas estables, p95 < 150 ms, reconexión funcional, retención D7 medida con jugadores reales.
- **E2 → E3:** rankings correctos y reproducibles, notificaciones sin spam, mejora de D7/D30 frente a la línea base.
- **E3 → E4:** torneo de 64 jugadores sin intervención manual, detección de colusión con revisión humana, auditoría de integridad.
- **E4 → E5:** ningún ítem afecta el juego, contabilidad de monedas conciliada, revisión legal y de pagos aprobada.

## 22. Antipatrones prohibidos

- Lógica de reglas en el cliente o en handlers de red.
- Enviar al cliente el estado completo de la partida.
- Archivos "dios" de más de ~400 líneas con responsabilidades mezcladas.
- Números mágicos y textos de reglas repetidos.
- Endpoints sin validación, autorización o rate limit.
- Botones o rutas que no hacen nada.
- Cobertura "de relleno" sin aserciones reales.
- Ítems de tienda o recompensas que den ventaja de juego.
- Cualquier mecanismo de dinero real, retiro o transferencia entre jugadores.

---

## Primera instrucción

1. Leé este mensaje completo.
2. **Guardá este mensaje completo, textualmente, como `docs/MASTER_PROMPT.md`** (es la especificación de referencia del proyecto y debe consultarse ante cualquier duda). Luego creá `CLAUDE.md` y los archivos de `docs/` con el estado inicial.
3. Ejecutá **M0**: inicializá el monorepo con la estructura de la sección 5, tooling, CI y docker-compose.
4. Verificá que `pnpm install`, `pnpm lint`, `pnpm test` y `docker compose up` funcionan.
5. Registrá ADR-001 a ADR-008 (las decisiones de la sección 3).
6. Reportame el resultado y **esperá mi confirmación (⏸)** antes de comenzar **M1**.
