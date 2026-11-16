# Registro de Decisiones de Arquitectura (ADR)

Este documento registra las decisiones arquitectónicas y tecnológicas del proyecto **"Mesa de Truco"** siguiendo el formato estándar: **Estado**, **Contexto**, **Decisión**, **Alternativas consideradas** y **Consecuencias**.

---

## ADR-001: Monorepo TypeScript Estricto y Arquitectura de Monolito Modular con Game Server Separado

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** La plataforma abarca PWA de jugador (`apps/web`), panel administrativo (`apps/admin`), API HTTP (`apps/api`), servidor de partidas en tiempo real (`apps/game-server`) y librerías compartidas (`truco-engine`, `shared`, `ui`, `config`). Se requiere escalar desde 100 hasta 50.000+ usuarios simultáneos sin reescritura ni sobrecarga operativa prematura de microservicios.
- **Decisión:**
  1. Usar **TypeScript con `strict: true`** (`noUncheckedIndexedAccess`, `noImplicitOverride`) en todo el repositorio.
  2. Estructurar un monorepo con **pnpm workspaces** y **Turborepo** para caché de compilación, linting, chequeo de tipos y tests.
  3. Adoptar el principio de **monolito modular** para `apps/api` (módulos desacoplados por dominio), ejecutando `apps/game-server` como **proceso separado desde el día 1** dentro del mismo repositorio.
- **Alternativas consideradas:**
  - _Microservicios distribuidos desde el inicio_: descartado por complejidad operativa, trazabilidad costosa y latencia entre servicios sin beneficio en MVP.
  - _Un único proceso mezclando API REST y partidas WebSocket_: descartado porque el estado vivo en memoria y el drenaje elegante (graceful drain) de salas activas requieren ciclo de vida y escalado horizontal independientes del tráfico HTTP.
  - _Repositorios múltiples (polyrepo)_: descartado por fricción al sincronizar contratos Zod, tipos y reglas del motor.
- **Consecuencias:**
  - Compartición inmediata y tipada de esquemas, reglas y componentes UI sin publicar paquetes externos.
  - Escalado independiente del `game-server` con afinidad `roomId -> serverId` en Redis sin reescribir el dominio HTTP.

---

## ADR-002: Contratos Compartidos y Validación Universal con Zod (`packages/shared`)

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** Todo mensaje externo (requests/responses REST, envelopes WebSocket, variables de entorno y configuraciones de `RuleSet`) es potencialmente malicioso o malformado. Duplicar esquemas entre cliente y servidor introduce deriva de contratos.
- **Decisión:** Centralizar todos los esquemas de validación, DTOs, códigos de error, constantes parametrizables y envelopes de protocolo en `packages/shared` usando **Zod**, reutilizado tanto en runtime como para inferencia estática de tipos TypeScript en cliente y servidor, incluyendo validación fail-fast de variables de entorno al arranque.
- **Alternativas consideradas:**
  - _`class-validator` + decoradores exclusivos de NestJS_: descartado porque acopla esquemas al backend, requiere reflexión en cliente y no valida limpiamente envelopes WebSocket puros.
  - _JSON Schema + generación de código_: descartado por mayor fricción de desarrollo frente a inferencia nativa `z.infer`.
- **Consecuencias:**
  - Única fuente de verdad para contratos REST (`/v1`), protocolo WS y configuración de entorno.
  - Rechazo determinístico y uniforme (`{ error: { code, message, details } }`) ante entradas inválidas.

---

## ADR-003: Stack de Frontend para PWA del Jugador y Panel Administrativo

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** La experiencia principal es mobile-first (360 px a 1200 px), instalable como PWA, con animaciones fluidas en dispositivos de gama media (< 200 KB JS crítico comprimido), respeto a `prefers-reduced-motion` y contraste AA bajo la identidad visual "mesa de bar contemporánea". El panel administrativo requiere aislamiento de bundle y superficie de ataque respecto del cliente jugador.
- **Decisión:**
  - Construir `apps/web` y `apps/admin` como aplicaciones separadas sobre **React 18 + Vite + Tailwind CSS**.
  - Gestionar estado remoto HTTP con **TanStack Query** y estado local/tiempo real de mesa con **Zustand**.
  - Implementar microinteracciones con **Framer Motion** respetando `prefers-reduced-motion`.
  - Empaquetar `apps/web` como PWA mediante **`vite-plugin-pwa`** y centralizar tokens/componentes accesibles + SVGs propios en `packages/ui`.
- **Alternativas consideradas:**
  - _SSR pesado (Next.js) para la mesa de juego_: descartado porque la mesa en tiempo real y el panel admin son aplicaciones altamente interactivas autenticadas donde un bundle SPA/PWA ligero con Vite optimiza tiempos de carga y simplicidad de despliegue en CDN.
  - _Incluir rutas `/admin` dentro de `apps/web`_: descartado para no exponer código administrativo en el bundle público ni mezclar políticas de CSP/2FA.
- **Consecuencias:**
  - Separación estricta entre activos públicos de jugador y herramientas internas de moderación/soporte.
  - Reutilización visual consistente mediante `packages/ui`.

---

## ADR-004: Backend HTTP en NestJS sobre Adaptador Fastify

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** El API REST (`/v1`) concentra autenticación, usuarios, lobby, moderación, administración, salud/métricas y futuros dominios (social, rankings, torneos, economía virtual), exigiendo estructura modular estricta (`controller`, `service`, `repository`, `dto/schemas`, `tests`), inyección de dependencias para proveedores externos (email, OAuth, captcha) y baja sobrecarga por request.
- **Decisión:** Implementar `apps/api` con **NestJS** utilizando **`@nestjs/platform-fastify`** (Fastify adapter), organizado en módulos por dominio sin mezclar transporte HTTP, lógica de negocio ni consultas de persistencia.
- **Alternativas consideradas:**
  - _NestJS sobre Express_: descartado por menor rendimiento de serialización/throughput frente a Fastify.
  - _Fastify crudo sin framework modular_: descartado para un equipo grande/creciente donde convenciones uniformes de DI, guards RBAC e interceptores de auditoría aceleran mantenimiento y testing.
- **Consecuencias:**
  - Alto rendimiento HTTP con arquitectura limpia, testeable con Supertest/`inject` de Fastify y documentación OpenAPI consistente.

---

## ADR-005: Tiempo Real con Socket.IO, Estado Vivo en Redis 7 y Trabajos Asíncronos con BullMQ

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** El truco online requiere latencia p95 < 150 ms, reconexión móvil transparente (cambios Wi-Fi/4G con ventana de gracia de 45 s), orden garantizado por secuencia (`seq`), idempotencia (`eventId`), escritor único por sala (single-writer) y recuperación ante caída de proceso sin perder partidas en curso.
- **Decisión:**
  1. Usar **Socket.IO** sobre WebSockets con handshake autenticado y **envelope propio validado con Zod** (`{ eventId, seq?, ts, type, payload }`).
  2. Mantener cada partida activa en memoria en un único proceso (`single-writer`) de `apps/game-server` y persistir en **Redis 7** el snapshot + log de eventos tras cada acción, además de presencia, directorio `roomId -> serverId`, rate limiting y pub/sub.
  3. Ejecutar tareas fuera del camino crítico (cálculo post-partida, limpieza, rankings futuros, notificaciones) con **BullMQ** sobre Redis.
- **Alternativas consideradas:**
  - _WebSocket nativo (`ws`) sin capa de rooms/reconexión_: descartado porque habría que reimplementar heartbeats, transporte fallback, reconexión con backoff y gestión de rooms.
  - _Persistir cada acción síncronamente en PostgreSQL_: descartado en el camino crítico de turno por latencia e impacto de contención; PostgreSQL recibe la transacción consolidada al cierre de partida (`matches`, `match_players`, `match_events`).
- **Consecuencias:**
  - Reconexión rápida mediante `game.rejoin { lastSeq }` o `game.resync` filtrado siempre por `viewFor`.
  - Tolerancia a fallos de nodo de `game-server` reconstruyendo el estado desde Redis.

---

## ADR-006: Persistencia Relacional con PostgreSQL 16 y Drizzle ORM

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** Los datos persistentes (usuarios, sesiones, perfiles, rulesets, mesas, partidas, eventos auditables de partida, reportes, sanciones, `audit_logs` inmutables y futuro libro mayor de monedas virtuales) requieren integridad transaccional ACID, consultas SQL predecibles verificables con `EXPLAIN`, soporte nativo `jsonb`, particionado futuro de `match_events` y migraciones versionadas seguras.
- **Decisión:** Utilizar **PostgreSQL 16** como base de datos relacional primaria junto con **Drizzle ORM** y **`drizzle-kit`** para esquemas tipados en TypeScript y migraciones SQL versionadas, empleando **UUID v7** ordenables temporalmente y columnas `created_at`/`updated_at`.
- **Alternativas consideradas:**
  - _Prisma ORM_: descartado por abstracción de motor binario adicional y menor control directo sobre SQL complejo, particionado y tuning fino de consultas.
  - _TypeORM_: descartado por historial de debilidades de tipado estricto y magia de decoradores/ActiveRecord.
- **Consecuencias:**
  - Consultas SQL transparentes, tipado estricto de extremo a extremo, migraciones auditables en Git e índices explícitos optimizados para cursores y lecturas frecuentes.

---

## ADR-007: Autenticación Segura con Sesiones Web en Cookies HttpOnly, Argon2id y Google OAuth

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** La plataforma debe permitir entrada sin fricción como invitado (promovible a cuenta permanente sin perder progreso), registro/login clásico y Google OAuth, protegiendo cuentas frente a robo de tokens XSS, fuerza bruta, reutilización de refresh tokens y accesos administrativos no autorizados.
- **Decisión:**
  1. Emitir sesiones web mediante **cookies `HttpOnly`, `Secure`, `SameSite`** con **refresh token rotativo** almacenado como hash en `sessions` y detección de reutilización (revocación de familia de sesión), más protección CSRF.
  2. Hashear contraseñas exclusivamente con **Argon2id**.
  3. Soportar cuentas de invitado efímeras promovibles (`/v1/auth/promote-guest`) y **OAuth 2.0 con Google** detrás de interfaces explícitas, así como proveedor de email desacoplado (`ConsoleEmailProvider` en desarrollo).
  4. Exigir RBAC estricto y **2FA obligatorio** para roles administrativos en `apps/admin`.
- **Alternativas consideradas:**
  - _JWT stateless en `localStorage`_: descartado por exposición directa ante XSS e imposibilidad de revocación inmediata sin lista negra estatal.
  - _`bcrypt`_: descartado en favor de Argon2id por resistencia superior frente a ataques con GPU/ASIC.
- **Consecuencias:**
  - Control total de sesiones por dispositivo, revocación inmediata ante sospecha de compromiso y transición fluida de jugador invitado a registrado.

---

## ADR-008: Estrategia Integral de Calidad, Testing, Contenedores, CI/CD y Observabilidad

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** Un juego multijugador competitivo exige cero regresiones en reglas de truco, ausencia comprobada de fugas de cartas privadas, builds reproducibles y visibilidad completa en producción.
- **Decisión:**
  1. **Calidad estática y flujo Git:** ESLint, Prettier, Husky, `lint-staged` y `commitlint` (Conventional Commits).
  2. **Pirámide de tests:** **Vitest** para unitarios/contratos, **fast-check** para property-based testing del motor (cobertura >= 95%), **Supertest** + **Testcontainers** (PostgreSQL/Redis reales) para integración, **Playwright** para flujos E2E móvil/escritorio y **k6** para pruebas de carga (100 y 1.000 concurrentes).
  3. **Infraestructura y CI:** **Docker multi-stage** para artefactos de producción, **`docker-compose`** para desarrollo local (PostgreSQL 16 + Redis 7) y **GitHub Actions** bloqueando merges ante fallos de lint, tipos, tests o auditoría.
  4. **Observabilidad:** logs estructurados JSON con **pino** y `correlationId`, trazas con **OpenTelemetry**, captura de excepciones con **Sentry** y endpoint `/v1/metrics` compatible con **Prometheus**.
- **Alternativas consideradas:**
  - _Jest_: descartado frente a Vitest por menor velocidad e integración más compleja con ESM/Vite/TypeScript moderno.
  - _Mocks en memoria exclusivamente para tests de base de datos_: descartado para pruebas de integración críticas porque oculta errores reales de constraints, índices y concurrencia de PostgreSQL/Redis.
- **Consecuencias:**
  - Verificación automatizada continua desde reglas puras hasta flujos multijugador completos y métricas operativas listas para SLOs.

---

## ADR-009: Gestión de Ramas en Sesiones del Entorno de Ejecución Actual

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** La especificación general sugiere ramas por módulo (`feat/m1-engine`, etc.), mientras que el entorno de ejecución de sesión actual vincula el seguimiento del repositorio a una única rama de trabajo fija (`arena/bfe4d4d2-trucostart`) y prohíbe crear o cambiar a otras ramas durante la sesión.
- **Decisión:** Mantener todos los commits incrementales (con formato estricto **Conventional Commits** e identificadores de módulo claros como `chore(m0): ...`, `feat(m1-engine): ...`) sobre la rama activa de la sesión (`arena/bfe4d4d2-trucostart`). En despliegues fuera de este entorno o por desarrolladores humanos, se mantiene la convención de ramas `feat/mX-*` vía Pull Request hacia `main`.
- **Alternativas consideradas:**
  - _Crear ramas locales secundarias_: descartado porque desvincula el trabajo del sistema de seguimiento del entorno actual.
- **Consecuencias:**
  - Historial Git limpio, atómico y trazable por módulo mediante scopes de Conventional Commits sin romper la integración del entorno.

---

## ADR-010: Diseño Nativo N-Asientos, PRNG Serializable entre Manos e IA sin Trampa en `@truco/engine`

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** `packages/truco-engine` debe mantener una firma funcional 100 % pura (`applyAction(state, action)`) sin I/O ni clausuras mutables, soportar partidas multi-mano completas para 2, 4 y 6+ jugadores, impedir toda filtración de cartas privadas o señas rivales hacia clientes y garantizar que la IA heurística jamás pueda hacer trampa.
- **Decisión:**
  1. **Generalidad nativa de $N$ asientos ($2 \le N \le 13$):** toda rotación de turno, reparto antihorario (`(seat + 1) % N`), evaluación de pardas y desempate de Envido/Flor se calcula mediante distancia relativa a la mano `seatHandOrder(seat, manoSeat, N) = (seat - manoSeat + N) % N`.
  2. **Estado PRNG puro y serializable (`sfc32`):** `createGame(ruleset, players, rng)` mezcla la Mano #1 con el `Rng` inyectado y deriva una tupla inmutable `internalPrngState` de 4 enteros `uint32` para barajar determinísticamente la Mano #2+ dentro de `applyAction` manteniendo serialización JSON exacta (Redis/snapshots) y ocultando siempre `internalPrngState` en `viewFor`.
  3. **Frontera estricta de proyección e IA:** `viewFor(state, seat)` y `projectEventsForSeat(events, seats, seat)` constituyen la única salida hacia clientes, verificada con `fast-check`; `chooseBotAction(view: PlayerView)` acepta únicamente `PlayerView` sin importar jamás `GameState`.
- **Alternativas consideradas:**
  - _Almacenar una instancia `Rng` con clausura en `GameState`_: descartado porque rompe inmutabilidad (`applyAction` mutaría el generador compartido) e impide serializar `GameState` en Redis.
  - _Codificar lógica separada para 1v1 y 2v2_: descartado por duplicar reglas y dificultar 3v3 (_pica-pica_ en Etapa 2).
- **Consecuencias:**
  - Determinismo matemático exacto en replays, cobertura del motor `97.93%` líneas / `100%` funciones y simulaciones de miles de partidas completas en pocos segundos sin fugas de información.

---

## ADR-011: Persistencia Dual `GameStore` (`InMemory` + `Redis`) y Salas _Single-Writer_ con Lease

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** `apps/game-server` requiere persistencia efímera tras cada acción (snapshot + log secuenciado de eventos), bloqueo de una única sala activa por usuario y recuperación transparente ante caída del proceso. Además, el entorno local/sandbox no dispone de demonio Docker (`ISS-001`), mientras que CI y producción cuentan con Redis 7 real.
- **Decisión:**
  1. Definir el puerto explícito `GameStore` con operaciones atómicas (`claimRoomOwner`, `releaseRoomOwner`, `saveRoomStateAndEvents`, `loadRoomSnapshot`, `loadRoomEventsAfter`, `getUserActiveRoom`, `setUserActiveRoom`, `clearUserActiveRoom`).
  2. Proveer dos adaptadores verificados por la misma suite contractual (`game-store.contract.spec.ts`): `InMemoryGameStore` (desarrollo/tests sin Docker) y `RedisGameStore` con `ioredis` (`SET NX PX` para lease de propietario, scripts Lua para renovación/liberación segura y `MULTI/EXEC` para persistencia atómica de snapshot + eventos con TTL de 24 h), activado automáticamente en tests cuando `REDIS_URL` está definido (p. ej. GitHub Actions CI).
  3. Implementar `RoomActor` con cola de ejecución serie (`enqueue`) garantizando un único escritor por sala (_single-writer_) sin condiciones de carrera entre comandos de socket y temporizadores de turno/abandono.
- **Alternativas consideradas:**
  - _Mocks ad-hoc de `ioredis` en tests_: descartado por ocultar divergencias de semántica atómica y violar la regla de diseño de interfaces explícitas.
  - _Locks distribuidos por cada mensaje individual_: descartado por latencia innecesaria frente a afinidad de sala en memoria respaldada por lease renovable (`claimRoomOwner`) y recuperación perezosa desde `PersistedRoomSnapshot`.
- **Consecuencias:**
  - Cero condiciones de carrera intra-sala, recuperación exacta ante caída abrupta del proceso (`simulateCrash`) cuando vence el lease del nodo caído y paridad contractual verificada entre memoria y Redis 7.

---

## ADR-012: Commit-Reveal Criptográfico, Semilla Cifrada en Reposo y Frontera WebSocket sin Fugas

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** Un servidor de Truco competitivo debe demostrar a los jugadores que el mazo no fue manipulado durante la partida (_fair play_), impedir que un volcado de Redis exponga la semilla activa antes del cierre de la partida y garantizar que ningún mensaje WebSocket filtre cartas o señas privadas.
- **Decisión:**
  1. **Commit-Reveal verificable:** al iniciar la partida (`game.started`), el servidor genera 32 bytes CSPRNG (`seedHex` de 256 bits) y publica `seedCommitment = SHA-256("truco-v1:" + seedHex)`. El `Rng` inyectado a `createGame` deriva flotantes uniformes de 53 bits vía `HMAC-SHA256(seedHex, counter_be64)`. Recién al emitir `game.ended` se publica `seedReveal = seedHex`.
  2. **Cifrado autenticado en reposo:** mientras la partida está `IN_GAME`, `PersistedRoomSnapshot` guarda únicamente `encryptedSeed` cifrado con **AES-256-GCM** (IV aleatorio de 96 bits + auth tag de 128 bits derivado de `SEED_ENCRYPTION_KEY`) y mantiene `revealedSeed: null`, permitiendo que otro nodo recupere y revele la semilla tras un crash sin exponerla en texto plano en Redis.
  3. **Proyección obligatoria y audiencia tipada:** cada evento persistido declara su `EventAudience` (`ALL`, `SEAT`, `TEAM`); todas las vistas salen exclusivamente de `viewFor(state, seat)` y las señas se validan con `projectEventsForSeat`, tanto en emisión en vivo como en reenvío incremental (`game.rejoin` con `lastSeq`) y resincronización completa (`game.resync`).
- **Alternativas consideradas:**
  - _Persistir `seedHex` en claro en Redis hasta el final de la partida_: descartado porque cualquier lectura operativa de claves activas comprometería el mazo futuro.
  - _Filtrar campos sensibles manualmente en el controlador Socket.IO_: descartado por propensión a errores; centralizar la proyección en `event-projector.ts` sobre `viewFor` + `projectEventsForSeat` hace imposible emitir el `GameState` crudo.
- **Consecuencias:**
  - Auditoría matemática de baraja reproducible extremo a extremo por cualquier cliente y verificación automatizada sobre el 100 % de los sobres en partidas 1v1 y 2v2 con cero fugas de información.

---

## ADR-013: Motor Dual PostgreSQL 16 (`pg.Pool`) + PGlite (`@electric-sql/pglite`) con Migraciones SQL Idénticas

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** `apps/api` requiere persistencia relacional real con `UUIDv7`, `jsonb`, claves foráneas `ON DELETE CASCADE` e índices únicos (`nickname_lower`, `email`, `refresh_hash`) mediante Drizzle ORM. En el entorno sandbox local no existe demonio Docker (`ISSUE-001`), mientras que en CI (GitHub Actions) y producción se dispone de PostgreSQL 16 real.
- **Decisión:**
  1. Generar las migraciones SQL oficiales con `drizzle-kit generate` en `apps/api/drizzle/*.sql`.
  2. Implementar un proveedor adaptativo (`database.provider.ts`) que ejecuta **exactamente las mismas migraciones SQL**:
     - Cuando `DATABASE_URL` está definido (producción y GitHub Actions CI): conecta vía `pg.Pool` contra PostgreSQL 16 real. En suites de pruebas paralelas crea una base de datos efímera aislada (`CREATE DATABASE "truco_test_<id>"`) sobre el esquema real `public` —evitando colisiones con calificadores explícitos `"public"."users"` emitidos por `drizzle-kit generate`— y la elimina (`DROP DATABASE ... WITH (FORCE)`) al cerrar.
     - Cuando `DATABASE_URL` no está definido (desarrollo en sandbox sin Docker): carga dinámicamente `@electric-sql/pglite` (PostgreSQL real compilado a WASM en memoria), evitando que `PGlite` sea siquiera importado en despliegues productivos.
  3. Añadir aserción explícita en Vitest garantizando que cuando `CI=true` jamás se omita `DATABASE_URL`.
- **Consecuencias:**
  - Paridad SQL real entre sandbox local y PostgreSQL 16 en CI sin mocks frágiles ni repositorios falsos ad-hoc.

---

## ADR-014: Cookies Duales `HttpOnly`, Familia de Refresh Rotativos y Separación de Dominio para `ws-ticket`

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** La plataforma necesita sesiones web resistentes a XSS/CSRF, detección inmediata de robo de refresh tokens, promoción transparente de cuentas invitadas sin perder historial y autenticación ligera para handshakes Socket.IO en `apps/game-server`.
- **Decisión:**
  1. **Cookies `HttpOnly; Secure; SameSite=Lax`:** `truco_access` (`Path=/`, 15 min) firmada con HMAC-SHA256 bajo prefijo de dominio `access-v1:` y validada contra estado vivo de sesión/usuario en DB (revocación instantánea); `truco_refresh` (`Path=/v1/auth`, 30 días) opaca CSPRNG de 256 bits almacenando únicamente `SHA-256(token)` en `sessions.refresh_hash`.
  2. **Familias de sesión y detección de reúso:** cada login inaugura un `family_id`. Rotar un refresh token marca el eslabón previo con `revoked_reason = 'ROTATED'`. Si un token ya rotado vuelve a presentarse, el servidor revoca de inmediato **todos los miembros activos de ese `family_id`** (`REUSE_DETECTED`) y registra la intrusión en `audit_logs`.
  3. **Separación criptográfica HTTP vs WS y ticket de un solo uso (`jti`):** `POST /v1/auth/ws-ticket` emite un ticket firmado de 60 s con identificador único `jti` compatible con `verifyWsAuthTicket` de `@truco/game-server`. En el primer handshake Socket.IO, `apps/game-server` consume atómicamente `jti` en `GameStore` (`SET NX PX` con TTL restante) rechazando cualquier intento de reutilización. Al usar claves/prefijos distintos al de `truco_access`, una cookie HTTP jamás puede reutilizarse directamente como ticket WebSocket ni viceversa.
  4. **Promoción in-place de invitados:** `POST /v1/auth/promote-guest` actualiza la fila existente en `users` conservando intacto `users.id`, `profiles` (nivel/XP/ajustes) y `match_players`.
- **Consecuencias:**
  - Mitigación robusta frente a robo de tokens, replay de tickets WS y enumeración de cuentas, verificada end-to-end contra `apps/game-server`.

---

## ADR-015: `RateLimitStore` Dual (`InMemory` + `Redis`), Lockout Progresivo por `(Cuenta + IP)` y Escalado a Captcha por Cuenta

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:**
  1. Un limitador de tasa exclusivamente en memoria local pierde efectividad al escalar `apps/api` a múltiples réplicas detrás de un balanceador.
  2. Aplicar bloqueo progresivo (`423 ACCOUNT_LOCKED`) de forma global sobre el correo electrónico (`users.locked_until`) introduce una vulnerabilidad clásica de **denegación de servicio (DoS) contra cuentas de terceros**: cualquier atacante que conozca el email de un jugador competitivo (o de un moderador/streamer) puede enviar 5 contraseñas erróneas rotando direcciones IP cada pocos minutos y dejar al propietario legítimo permanentemente fuera de su cuenta, incluso cuando ingresa su contraseña real desde su dispositivo habitual.
- **Decisión:**
  1. **Puerto `RateLimitStore` con adaptadores `InMemoryRateLimitStore` y `RedisRateLimitStore`:** siguiendo el mismo patrón contractual que `GameStore`, todas las cuotas de ventana deslizante (`consumeWindow`), bloqueos progresivos (`getLockoutState` / `recordLockoutFailure`) y contadores de fallos (`incrementFailureCounter`) se abstraen detrás de `RateLimitStore`, usando scripts Lua atómicos sobre `ZSET` y `HASH` en Redis 7 y verificándose con una suite de contrato compartida (`rate-limit-store.contract.spec.ts`).
  2. **Lockout progresivo acotado a `(cuenta + IP)`:** el bloqueo escalonado (`60s -> 300s -> 900s -> 3600s` a partir de 5 fallos) actúa únicamente sobre la tupla normalizada `(emailLower + ip)`, frenando fuerza bruta desde un origen concreto sin bloquear jamás otros orígenes legítimos. De igual modo, la cuota HTTP de `POST /v1/auth/login` se aplica por `IP` y por `(cuenta + IP)`, nunca como bloqueo duro global por cuenta.
  3. **Umbral por cuenta con escalado a Captcha (`LOGIN_ACCOUNT_CAPTCHA_THRESHOLD = 3`):** cuando una cuenta acumula `>= 3` intentos fallidos dentro de la ventana activa (`15 min`) desde cualquier conjunto de IPs (p. ej. credential stuffing distribuido), `POST /v1/auth/login` exige resolver un `captchaToken` válido antes de evaluar credenciales (`400 CAPTCHA_FAILED` con `details.captchaRequired = true`), aplicando la misma regla tanto a emails registrados como inexistentes para preservar anti-enumeración.
- **Alternativas consideradas:**
  - _Mantener bloqueo global por cuenta con tiempos más cortos_: descartado porque un script automatizado trivial puede renovar el bloqueo indefinidamente e impedir que un jugador reconecte a un torneo o partida activa.
  - _Confiar únicamente en rate limit por IP sin umbral por cuenta_: descartado porque una botnet con miles de IPs residenciales probaría 1-2 contraseñas por IP sin activar ni el límite por IP ni el lockout `(cuenta + IP)`.
- **Consecuencias:**
  - Ningún tercero puede bloquear la cuenta de otro jugador conociendo su email: el dueño legítimo siempre puede iniciar sesión presentando su contraseña real junto con el desafío Captcha.
  - Consistencia horizontal entre múltiples instancias de `apps/api` respaldada por Redis 7 en producción y CI.

---

## ADR-016: Topología de Despliegue _Same-Site_ (`eTLD+1`) para Cookies `SameSite=Lax` entre `web`, `admin` y `api`

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** Las cookies de sesión (`truco_access` y `truco_refresh`) se emiten con `HttpOnly; Secure; SameSite=Lax` para mitigar CSRF en peticiones sub-recurso (`fetch`/`XHR`) originadas desde terceros maliciosos. En los navegadores modernos, la clasificación _same-site_ frente a _cross-site_ se evalúa sobre el **sitio registrable (`scheme + eTLD+1`)** conforme a la Public Suffix List:
  - Si `apps/web` y `apps/api` se desplegaran bajo dominios registrables distintos (por ejemplo `truco-web.vercel.app` y `truco-api.fly.dev`, ambos sufijos públicos independientes), toda petición `fetch('https://.../v1/...', { credentials: 'include' })` sería tratada como **cross-site** y el navegador **omitiría las cookies `SameSite=Lax`** en `POST`/`PATCH`/`DELETE` e incluso en `GET` de sub-recursos tras redirecciones cross-site.
- **Decisión:**
  1. Establecer como **invariante obligatoria de despliegue** en staging y producción que `apps/web`, `apps/admin` y `apps/api` compartan el mismo **sitio registrable (`eTLD+1`)** —p. ej. `app.truco.ar`, `admin.truco.ar` y `api.truco.ar` configurando `COOKIE_DOMAIN=.truco.ar`— o bien enrutar `/v1/*` mediante reverse-proxy/CDN bajo el mismo origen exacto (`https://truco.ar/v1/*`).
  2. Para `apps/game-server` (que puede residir en otro subdominio o incluso en otro borde regional), mantener la autenticación del handshake WebSocket desacoplada de cookies mediante el ticket efímero de un solo uso `POST /v1/auth/ws-ticket` enviado explícitamente en `socket.auth.token`.
- **Alternativas consideradas:**
  - _Relajar las cookies a `SameSite=None; Secure`_: descartado porque expone todas las mutaciones autenticadas a envío automático cross-site y queda sujeto al bloqueo progresivo de cookies de terceros (3PCD / CHIPS) en Safari, Firefox y Chrome.
- **Consecuencias:**
  - Protección CSRF nativa de `SameSite=Lax` intacta sin degradación por políticas de privacidad de navegadores, con requisito explícito de DNS/enrutamiento documentado para infraestructura.

---

## ADR-017: Contrato `apps/api` ↔ `apps/game-server` — Aprovisionamiento Autoritativo de Salas y Persistencia Transaccional Post-Partida vía BullMQ

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** `apps/api` y `apps/game-server` corren como procesos separados (ADR-001). Para implementar Lobby, Mesas y Matchmaking (M4) sin acoplamiento a base de datos compartida ni deriva de reglas:
  1. `apps/api` debe ser la única fuente de verdad relacional (`tables`, `table_seats`, `rulesets`, `matches`, `match_players`, `match_events` en PostgreSQL 16).
  2. `apps/game-server` **jamás debe escribir ni conectarse a PostgreSQL**, pero necesita instanciar cada sala en tiempo real con exactamente los mismos parámetros elegidos en la mesa (modo `1v1`/`2v2`, `RuleSet` completo validado, puntaje objetivo `15`/`30`, `flor`, visibilidad `PUBLIC`/`PRIVATE` y `turnTimeoutMs`) sin duplicar lógica de derivación de reglas ni permitir que el cliente sobrescriba esos parámetros en `table.join`.
  3. Al concluir una partida, el resultado, puntajes por jugador y log secuenciado auditable deben persistirse atómicamente en PostgreSQL.
- **Decisión:**
  1. **Aprovisionamiento unidireccional firmado (`apps/api -> apps/game-server`):** al crear una mesa (`POST /v1/tables` o matchmaking), `apps/api` construye y valida el `RuleSet` canónico de `@truco/engine`, persiste `tables` + `table_seats` en PostgreSQL e invoca el puerto `GameRoomProvisioner.provisionRoom(RoomProvisionSpec)`. En transporte HTTP (`POST /internal/rooms` y `DELETE /internal/rooms/:roomId`), el cuerpo viaja firmado con HMAC-SHA256 con separación de dominio (`internal-rpc-v1:<SECRET>`). `game-server` valida `RoomProvisionSpecSchema` + `validateRuleSet`, reclama el lease en `GameStore` e hidrata el `PersistedRoomSnapshot` usando `roomId === tables.id` y el objeto `RuleSet` recibido directamente (en producción `allowAdHocRooms = false`, impidiendo salas huérfanas fuera del lobby).
  2. **Eventos asíncronos de ciclo de vida y cierre (`apps/game-server -> BullMQ -> apps/api`):** `game-server` publica eventos tipados `MatchLifecycleEventSchema` (`match.started`, `table.seatVacated` y `match.completed`) a través del puerto `MatchLifecyclePublisher` (`BullMqMatchLifecyclePublisher` sobre la cola `truco-match-lifecycle` en Redis 7 con `jobId` determinístico por `matchId`, e `InMemoryMatchLifecycleBus` para tests sin Redis).
  3. **Persistencia transaccional idempotente en `apps/api`:** `MatchPersistenceService` consume `match.completed` y ejecuta **una única transacción PostgreSQL (`db.transaction`)** que verifica idempotencia sobre `matches.id`, actualiza `tables.status = 'FINISHED'`, libera asientos activos e inserta `matches`, `match_players` y `match_events`.
- **Alternativas consideradas:**
  - _Compartir credenciales de PostgreSQL en `apps/game-server`_: descartado porque rompe fronteras de dominio, acopla migraciones entre despliegues y mete latencia SQL en el bucle de eventos de partidas en vivo.
  - _Reconstruir reglas en `game-server` a partir de flags sueltos enviados por clientes WS_: descartado porque duplica lógica de negocio y abre vectores donde un cliente manipula `rulesetCode` o `turnTimeoutMs` al hacer `table.join`.
- **Consecuencias:**
  - Cero duplicación de estado o reglas: `tables.id === roomId` y el `RuleSet` nace una sola vez en `apps/api`.
  - Escritura ACID garantizada de `matches` + `match_players` + `match_events` con tolerancia a reintentos (at-least-once) de BullMQ.
