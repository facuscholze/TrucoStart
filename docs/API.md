# Contratos API REST (`/v1`)

> **Especificación OpenAPI 3.1.0:** servida en vivo en `GET /v1/openapi.json` y versionada en `docs/openapi.v1.json` (verificada automáticamente contra deriva en Vitest).

---

## 1. Convenciones globales

- **Prefijo base:** `/v1`
- **Modelo de autenticación HTTP:** cookies `HttpOnly; Secure; SameSite=Lax`:
  - `truco_access` (`Path=/`, TTL `900 s` / 15 min): cookie de acceso firmada con HMAC-SHA256 (`access-v1:<SESSION_SECRET>`) y verificada contra estado vivo de sesión y cuenta en PostgreSQL.
  - `truco_refresh` (`Path=/v1/auth`, TTL `2592000 s` / 30 días): token opaco CSPRNG (32 bytes base64url; solo su hash `SHA-256` se almacena en `sessions.refresh_hash`). Rota en cada `POST /v1/auth/refresh` dentro de `family_id`; si se reutiliza un token ya rotado, se revoca **toda la familia de sesiones** (`REUSE_DETECTED`) y se registra en `audit_logs`.
  - **Requisito de despliegue (`SameSite=Lax`):** `apps/web`, `apps/admin` y `apps/api` deben compartir el mismo **sitio registrable (`eTLD+1`)** —por ejemplo `app.truco.ar`, `admin.truco.ar` y `api.truco.ar` con `COOKIE_DOMAIN=.truco.ar`, o enrutar `/v1` por reverse-proxy en el mismo origen— para que el navegador adjunte cookies `SameSite=Lax` en peticiones `fetch(..., { credentials: 'include' })` (véase `ADR-016` en `docs/DECISIONS.md`).
- **Puente HTTP → WebSocket (`apps/game-server`):** el cliente autenticado solicita un ticket efímero de **un solo uso** (`jti` único + TTL `60 s`) en `POST /v1/auth/ws-ticket` y lo presenta en el handshake Socket.IO (`auth: { token }`). `apps/game-server` consume atómicamente `jti` en `GameStore` rechazando cualquier reúso. La firma del ticket y la firma de `truco_access` están criptográficamente separadas por dominio.
- **Formato uniforme de error** (`@truco/shared` -> `ApiErrorResponseSchema`):
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Los datos enviados no son válidos",
      "details": {
        "issues": [
          { "path": "password", "message": "La contraseña debe tener al menos 8 caracteres" }
        ]
      }
    }
  }
  ```
- **Rate limiting en Auth:** doble ventana deslizante independiente **por dirección IP** y **por cuenta** (`email` normalizado o `userId`), devolviendo `429 RATE_LIMITED` + cabecera `Retry-After`.
- **Paginación:** basada en cursor (`cursor`, `limit`, `nextCursor`) ordenada por UUIDv7 descendente, salvo rankings (cursor numérico de posición).

---

## 2. Salud y Especificación

| Método | Ruta               | Auth | Descripción                                                      |
| ------ | ------------------ | ---- | ---------------------------------------------------------------- |
| `GET`  | `/v1/health`       | No   | Liveness probe del proceso HTTP.                                 |
| `GET`  | `/v1/ready`        | No   | Readiness probe (`SELECT 1` contra PostgreSQL 16 / PGlite).      |
| `GET`  | `/v1/openapi.json` | No   | Documento OpenAPI 3.1.0 completo de todos los endpoints activos. |

---

## 3. Autenticación y Sesiones (`/v1/auth/*`)

| Método   | Ruta                           | Auth            | Código OK | Descripción                                                                                          |
| -------- | ------------------------------ | --------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `POST`   | `/v1/auth/guest`               | No              | `201`     | Crea cuenta invitada efímera con apodo criollo autogenerado y emite cookies `HttpOnly`.              |
| `POST`   | `/v1/auth/promote-guest`       | `truco_access`  | `200`     | Convierte cuenta invitada en registrada **conservando el mismo `user.id`, nivel/XP y partidas**.     |
| `POST`   | `/v1/auth/register`            | No              | `201`     | Registra cuenta con Argon2id, unicidad case-insensitive de apodo, filtro ofensivo y email verify.    |
| `POST`   | `/v1/auth/login`               | No              | `200`     | Inicia sesión con Argon2id, lockout progresivo por `(cuenta + IP)` y Captcha tras umbral por cuenta. |
| `POST`   | `/v1/auth/google`              | No              | `200`     | Inicia sesión o vincula cuenta existente mediante Google ID Token (`GoogleOAuthVerifier`).           |
| `POST`   | `/v1/auth/refresh`             | `truco_refresh` | `200`     | Rota refresh token; revoca toda la familia si detecta reutilización de token ya rotado.              |
| `POST`   | `/v1/auth/logout`              | Cookie opcional | `200`     | Revoca sesión actual (o todas si `allDevices: true`) y limpia cookies.                               |
| `GET`    | `/v1/auth/sessions`            | `truco_access`  | `200`     | Lista dispositivos/sesiones activas marcando `isCurrent`.                                            |
| `DELETE` | `/v1/auth/sessions/:sessionId` | `truco_access`  | `200`     | Revoca una sesión propia (`403 FORBIDDEN` si pertenece a otro usuario).                              |
| `POST`   | `/v1/auth/forgot`              | No              | `200`     | Solicita reseteo de clave con respuesta idéntica exista o no el correo (anti-enumeración).           |
| `POST`   | `/v1/auth/reset`               | No              | `200`     | Consume token de un solo uso, actualiza clave Argon2id y revoca todas las sesiones previas.          |
| `POST`   | `/v1/auth/verify-email`        | No              | `200`     | Confirma correo electrónico mediante token de verificación de un solo uso.                           |
| `POST`   | `/v1/auth/resend-verification` | No              | `200`     | Reenvía enlace de verificación con respuesta uniforme anti-enumeración.                              |
| `POST`   | `/v1/auth/ws-ticket`           | `truco_access`  | `200`     | Emite ticket firmado efímero (`60 s`) para conectar a `apps/game-server` vía Socket.IO.              |

### Ejemplos de Request / Response — Auth

#### `POST /v1/auth/register` (`201 Created`)

```json
// Request
{
  "email": "lucia@truco.ar",
  "password": "ClaveFuerte123",
  "nickname": "LuciaCriolla",
  "deviceName": "Celular Lucia"
}

// Response (Set-Cookie: truco_access=...; HttpOnly; Secure; SameSite=Lax; Path=/, truco_refresh=...; HttpOnly; Secure; SameSite=Lax; Path=/v1/auth)
{
  "user": {
    "id": "019a8d2c-4f10-7b12-9a31-08c42b19e101",
    "email": "lucia@truco.ar",
    "emailVerified": false,
    "nickname": "LuciaCriolla",
    "isGuest": false,
    "role": "PLAYER",
    "status": "ACTIVE",
    "createdAt": "2026-11-13T14:00:00.000Z"
  },
  "sessionId": "019a8d2c-4f10-7b13-8c10-91a03c774202",
  "expiresAt": "2026-12-13T14:00:00.000Z"
}
```

#### `POST /v1/auth/promote-guest` (`200 OK`)

```json
// Request (autenticado como invitado)
{
  "email": "invitado.promovido@truco.ar",
  "password": "ClavePromovida2026",
  "nickname": "GauchoPromovido"
}

// Response (preserva exactamente el user.id previo del invitado)
{
  "user": {
    "id": "019a8d2c-1100-7a01-8b22-44d19f002311",
    "email": "invitado.promovido@truco.ar",
    "emailVerified": false,
    "nickname": "GauchoPromovido",
    "isGuest": false,
    "role": "PLAYER",
    "status": "ACTIVE",
    "createdAt": "2026-11-13T13:45:00.000Z"
  },
  "sessionId": "019a8d2c-5500-7d40-9011-77e81b220901",
  "expiresAt": "2026-12-13T14:05:00.000Z"
}
```

#### `POST /v1/auth/ws-ticket` (`200 OK`)

```json
// Response
{
  "ticket": "eyJ1c2VySWQiOiIwMTlhOGQyYy00ZjEwLTdiMTItOWEzMS0wOGM0MmIxOWUxMDEiLCJzZXNzaW9uSWQiOi...",
  "expiresAt": 1794578460000
}
```

---

## 4. Cuenta Propia y Usuarios (`/v1/me` y `/v1/users/:id`)

| Método   | Ruta                             | Auth           | Código OK     | Descripción                                                                                         |
| -------- | -------------------------------- | -------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `GET`    | `/v1/me`                         | `truco_access` | `200`         | Cuenta y perfil privados del usuario autenticado (`email`, `settings`, `bio`, `xp`, `level`).       |
| `PATCH`  | `/v1/me`                         | `truco_access` | `200`         | Actualiza `nickname`, `avatarId`, `bio` o `settings` propios.                                       |
| `GET`    | `/v1/me/export`                  | `truco_access` | `200`         | Exportación portátil JSON de datos personales, estadísticas y partidas recientes (Ley 25.326).      |
| `DELETE` | `/v1/me`                         | `truco_access` | `200`         | Elimina cuenta propia (exige `password` si aplica), anonimiza PII y revoca todas las sesiones.      |
| `GET`    | `/v1/users/:id`                  | No             | `200`         | Perfil estrictamente público (`id`, `nickname`, `isGuest`, `avatarId`, `level`, `xp`, `bio`).       |
| `GET`    | `/v1/users/:id/stats`            | `truco_access` | `200` / `404` | Estadísticas agregadas, condicionadas por `statsVisibility` (independiente del historial).          |
| `GET`    | `/v1/users/:id/matches`          | `truco_access` | `200` / `404` | Historial paginado por cursor, condicionado por `historyVisibility` (`?limit=20&cursor=<matchId>`). |
| `GET`    | `/v1/users/:id/matches/:matchId` | `truco_access` | `200` / `404` | Detalle público filtrado de una partida visible; nunca devuelve cartas ni señas privadas.           |

### Ejemplos de Request / Response — Users

#### `GET /v1/users/:id` (`200 OK` — sin PII)

```json
{
  "id": "019a8d2c-4f10-7b12-9a31-08c42b19e101",
  "nickname": "LuciaCriolla",
  "isGuest": false,
  "avatarId": "mate-classic",
  "level": 3,
  "xp": 320,
  "bio": "Juego sin flor los domingos",
  "createdAt": "2026-11-13T14:00:00.000Z"
}
```

#### `GET /v1/me/export` (`200 OK`)

```json
{
  "exportedAt": "2026-11-13T16:10:00.000Z",
  "user": {
    "id": "019a8d2c-4f10-7b12-9a31-08c42b19e101",
    "email": "lucia@truco.ar",
    "emailVerified": true,
    "nickname": "LuciaCriolla",
    "isGuest": false,
    "role": "PLAYER",
    "status": "ACTIVE",
    "createdAt": "2026-11-13T14:00:00.000Z"
  },
  "profile": {
    "avatarId": "mate-classic",
    "level": 3,
    "xp": 320,
    "bio": "Juego sin flor los domingos",
    "settings": {
      "soundEnabled": true,
      "animationsReduced": false,
      "confirmCalls": true,
      "historyVisibility": "FRIENDS",
      "statsVisibility": "FRIENDS",
      "presenceVisibility": "FRIENDS"
    }
  },
  "activeSessionsCount": 1,
  "stats": {
    "userId": "019a8d2c-4f10-7b12-9a31-08c42b19e101",
    "matchesPlayed": 3,
    "wins": 2,
    "losses": 1,
    "abandons": 0,
    "winRate": 0.6667
  },
  "recentMatches": []
}
```

---

## 4. Lobby y Mesas (`/v1/tables`) — Módulo M4

`apps/api` es la única fuente de verdad de las mesas en PostgreSQL (`tables` + `table_seats`) y aprovisiona de forma síncrona cada sala en `apps/game-server` vía RPC interno firmado con HMAC-SHA256 (`POST /internal/rooms` y `DELETE /internal/rooms/:id`, documentado en `ADR-017`).

| Método   | Ruta                      | Auth                  | Descripción                                                                                                                                                                                                     |
| -------- | ------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/v1/tables`              | Pública               | Lista únicamente mesas con `visibility = 'PUBLIC'` filtradas por `mode` (`1v1` \| `2v2`), `targetScore` (`15` \| `30`), `flor` (`true` \| `false`), `rulesetCode`, `status` (`WAITING` \| `IN_GAME`) y `limit`. |
| `POST`   | `/v1/tables`              | Cookie `truco_access` | Crea mesa `PUBLIC` o `PRIVATE`, asigna asiento `0` al anfitrión, genera `joinCode` de 6 caracteres sin ambigüedad (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`) y aprovisiona la sala en `game-server`.                  |
| `GET`    | `/v1/tables/:id`          | Cookie `truco_access` | Devuelve detalle de mesa. Si es `PRIVATE` y el solicitante no la integra, responde `404 NOT_FOUND` para impedir enumeración.                                                                                    |
| `POST`   | `/v1/tables/:id/join`     | Cookie `truco_access` | Reserva atómicamente (`SELECT ... FOR UPDATE`) un asiento libre en una mesa `PUBLIC`. Rechaza mesas `PRIVATE` con `403 FORBIDDEN`.                                                                              |
| `POST`   | `/v1/tables/join-by-code` | Cookie `truco_access` | Ingresa por `code` de 6 caracteres (protegido con rate limit independiente por IP y por cuenta) o por `inviteToken` firmado con HMAC y expiración.                                                              |
| `POST`   | `/v1/tables/:id/invite`   | Cookie `truco_access` | Genera un enlace de invitación firmado (`table-invite-v1`) con expiración acotada al TTL de la mesa (solo integrantes mientras `status = 'WAITING'`).                                                           |
| `POST`   | `/v1/tables/:id/leave`    | Cookie `truco_access` | Abandona mesa en espera (`WAITING`). Si sale el dueño, transfiere la propiedad determinísticamente al integrante más antiguo o cierra la mesa si queda vacía.                                                   |
| `DELETE` | `/v1/tables/:id`          | Cookie `truco_access` | Cierra la mesa y elimina la sala en `game-server` (exclusivo para el dueño y únicamente antes de que comience la partida).                                                                                      |

### Ejemplos de Lobby REST

#### `POST /v1/tables` (`201 Created`)

Solicitud:

```json
{
  "mode": "1v1",
  "visibility": "PRIVATE",
  "targetScore": 15,
  "flor": true,
  "turnTimeoutMs": 20000
}
```

Respuesta:

```json
{
  "id": "019a8d80-2100-7a10-8b20-112233445566",
  "roomId": "019a8d80-2100-7a10-8b20-112233445566",
  "mode": "1v1",
  "visibility": "PRIVATE",
  "rulesetCode": "ar-corto-15-flor-v1",
  "targetScore": 15,
  "flor": true,
  "turnTimeoutMs": 20000,
  "status": "WAITING",
  "ownerNickname": "LuciaCriolla",
  "isOwner": true,
  "mySeat": 0,
  "occupiedSeats": 1,
  "maxSeats": 2,
  "seats": [
    {
      "seat": 0,
      "team": 0,
      "occupied": true,
      "nickname": "LuciaCriolla",
      "isOwner": true,
      "isSelf": true
    },
    { "seat": 1, "team": 1, "occupied": false, "nickname": null, "isOwner": false, "isSelf": false }
  ],
  "joinCode": "K7M4P9",
  "inviteToken": "eyJ0YWJsZUlkIjoiMDE5YThkODAtMjEwMC03YTEwLThiMjAtMTEyMjMzNDQ1NTY2IiwiZXhwIjoxNzYzMDUwOTAwMDAwfQ.abc123...",
  "inviteExpiresAt": "2026-11-13T16:25:00.000Z",
  "expiresAt": "2026-11-13T16:20:00.000Z",
  "createdAt": "2026-11-13T16:10:00.000Z"
}
```

#### `POST /v1/tables/join-by-code` (`200 OK`)

```json
{
  "code": "K7M4P9"
}
```

---

## 5. Matchmaking Rápido (`/v1/matchmaking/queue`) — Módulo M4 / M9b

| Método   | Ruta                    | Auth                  | Descripción                                                                                                                                                                                                                    |
| -------- | ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST`   | `/v1/matchmaking/queue` | Cookie `truco_access` | Encola por `(mode, rulesetCode, competitive)`: `1v1` cupo 2, `2v2` cupo 4. `competitive:false` (default) conserva cola casual; `true` usa ventana Glicko-2, equipos balanceados y límite de rematches. Responde `200` o `201`. |
| `GET`    | `/v1/matchmaking/queue` | Cookie `truco_access` | Devuelve `IDLE`, `QUEUED` (incluye modo competitivo y posición) o `MATCHED` (`tableId`, `roomId`, `mySeat`, `myTeam`).                                                                                                         |
| `DELETE` | `/v1/matchmaking/queue` | Cookie `truco_access` | Cancela la búsqueda en cola de manera atómica e idempotente (`{ "cancelled": true }`).                                                                                                                                         |

La cola competitiva no mezcla modalidades, reglas ni solicitudes casuales. Su ventana inicial usa `COMPETITIVE_RATING_WINDOW_BASE` (150 puntos por omisión), crece `COMPETITIVE_RATING_WINDOW_GROWTH` (50 puntos) cada diez segundos y se limita por `COMPETITIVE_RATING_WINDOW_MAX` (800). En 1v1 se compara la diferencia individual; en 2v2, la diferencia de rating medio entre equipos. Un jugador que alcanzó `COMPETITIVE_REPEAT_RIVAL_LIMIT` (5 por omisión) partidas contra el mismo rival no vuelve a emparejar con esa persona en la temporada. Práctica y partidas con bots no entran a la cola ni puntúan.

#### Ejemplo de cola competitiva

```json
// POST /v1/matchmaking/queue
{ "mode": "2v2", "rulesetCode": "ar-standard-v1", "competitive": true }

// Respuesta posible al completar el cupo (201 Created)
{
  "status": "MATCHED",
  "tableId": "019a8d85-9900-7c41-9d10-aabbccddeeff",
  "roomId": "019a8d85-9900-7c41-9d10-aabbccddeeff",
  "mode": "2v2",
  "rulesetCode": "ar-standard-v1",
  "competitive": true,
  "mySeat": 1,
  "myTeam": 1
}
```

---

## 6. Social, presencia e historial — M9a

Todas las rutas de `/v1/social/*` requieren cookie de sesión `truco_access` y una cuenta elegible (sin sanción social activa). Las entradas se validan con esquemas estrictos de `@truco/shared`; búsqueda y mutaciones tienen límites por cuenta/IP.

### Grafo social e invitaciones

| Método            | Ruta                                                  | Descripción y garantías                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`             | `/v1/social/search?nickname=<prefijo>`                | Busca apodos activos; no enumera al propio usuario, jugadores bloqueados ni cuentas con sanción activa.                                                                                 |
| `GET`             | `/v1/social/friends`                                  | Lista amistades aceptadas y presencia que el amigo permite mostrar.                                                                                                                     |
| `GET` / `POST`    | `/v1/social/friend-requests`                          | Lista solicitudes entrantes/salientes o crea `{ "targetUserId": "<uuid>" }`. Solicitudes cruzadas se resuelven como una amistad aceptada y las aceptaciones repetidas son idempotentes. |
| `POST`            | `/v1/social/friend-requests/:requestId/accept`        | Sólo el destinatario puede aceptar.                                                                                                                                                     |
| `POST`            | `/v1/social/friend-requests/:requestId/decline`       | Sólo el destinatario puede rechazar.                                                                                                                                                    |
| `POST`            | `/v1/social/friend-requests/:requestId/cancel`        | Sólo quien inició puede cancelar.                                                                                                                                                       |
| `DELETE`          | `/v1/social/friends/:userId`                          | Quita la amistad y cancela invitaciones sociales pendientes entre ambas cuentas.                                                                                                        |
| `GET`             | `/v1/social/blocks`                                   | Lista los bloqueos propios.                                                                                                                                                             |
| `POST` / `DELETE` | `/v1/social/blocks/:userId`                           | Bloquea/desbloquea; un bloqueo también quita la amistad, cancela invitaciones pendientes y limpia presencia visible para ambas cuentas.                                                 |
| `POST`            | `/v1/social/table-invitations`                        | Crea una invitación dirigida a una amistad para una mesa propia/en espera. Body: `{ "recipientUserId": "<uuid>", "tableId": "<uuid>" }`.                                                |
| `POST`            | `/v1/social/challenges`                               | Desafío directo 1v1 a una amistad. Body: `{ "recipientUserId": "<uuid>", "mode": "1v1", "rulesetCode": "ar-standard-v1" }`.                                                             |
| `GET`             | `/v1/social/invitations?direction=INCOMING\|OUTGOING` | Lista invitaciones pendientes por dirección. La omisión de `direction` equivale a `INCOMING`.                                                                                           |
| `POST`            | `/v1/social/invitations/:invitationId/accept`         | Acepta una invitación/desafío una sola vez y crea/abre la mesa. Se vuelve a validar amistad, bloqueo, sanción y expiración en servidor.                                                 |
| `POST`            | `/v1/social/invitations/:invitationId/decline`        | Rechaza una invitación recibida.                                                                                                                                                        |
| `POST`            | `/v1/social/invitations/:invitationId/cancel`         | Cancela una invitación propia pendiente.                                                                                                                                                |

Un bloqueo prevalece sobre visibilidad pública, solicitudes, invitaciones, desafíos y aceptación. Las respuestas `404` para pares bloqueados evitan confirmar la existencia de una relación. Las cuentas sancionadas no aparecen en búsqueda y no pueden enviar solicitudes ni invitaciones.

### Notificaciones

| Método | Ruta                                                  | Descripción                                                          |
| ------ | ----------------------------------------------------- | -------------------------------------------------------------------- |
| `GET`  | `/v1/social/notifications?cursor=&limit=&unreadOnly=` | Lista notificaciones propias (`limit` 1–50; cursor UUIDv7 opcional). |
| `GET`  | `/v1/social/notifications/unread-count`               | Cuenta notificaciones propias no leídas.                             |
| `POST` | `/v1/social/notifications/:notificationId/read`       | Marca una notificación propia como leída.                            |
| `POST` | `/v1/social/notifications/read-all`                   | Marca todas las propias como leídas.                                 |

### Privacidad de presencia, historial y estadísticas

`PATCH /v1/me` acepta por separado en `settings`:

```json
{
  "settings": {
    "historyVisibility": "FRIENDS",
    "statsVisibility": "NOBODY",
    "presenceVisibility": "FRIENDS"
  }
}
```

Cada valor admite `ALL`, `FRIENDS` o `NOBODY`; el default es `FRIENDS`. La propia cuenta siempre puede consultar sus datos. Bloquear a alguien invalida la visibilidad entre ese par aun si una de las partes eligió `ALL`. El historial y las estadísticas se autorizan de forma independiente; el endpoint devuelve `404` si la política no permite el acceso.

- `GET /v1/users/:id/stats`: estadísticas derivadas en servidor desde partidas/eventos finalizados; no se mantienen contadores editables.
- `GET /v1/users/:id/matches`: historial paginado, filtrable por modalidad, resultado y presencia de bots.
- `GET /v1/users/:id/matches/:matchId`: detalle resumido y timeline de eventos permitidos. Nunca incluye cartas, señas privadas ni semilla antes de la revelación.

---

## 7. Ratings competitivos, rankings y revisión humana — M9b

### Ratings y clasificación pública

| Método | Ruta                                                    | Auth                  | Descripción                                                                                                                         |
| ------ | ------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/v1/rankings?period=GLOBAL&mode=1v1&cursor=0&limit=20` | Pública               | Ranking `GLOBAL`, `WEEKLY` o `MONTHLY` por modo `1v1`/`2v2`, con paginación por posición y cuenta regresiva de temporada.           |
| `GET`  | `/v1/users/:id/ratings`                                 | Cookie `truco_access` | Ratings 1v1/2v2 de la temporada activa, sujeto a la misma política de `statsVisibility` y bloqueos que las estadísticas del perfil. |
| `POST` | `/v1/matchmaking/queue`                                 | Cookie `truco_access` | `competitive: true` opta por cola separada con matching por rating y equipos balanceados; falso/omitido mantiene la cola casual.    |

El ranking global ordena por rating Glicko-2; los rankings semanal y mensual ordenan por variación acumulada del rating dentro del período UTC. El cursor es un offset decimal (`"0"`, `"20"`, …), el límite admitido es 1–50 y las posiciones de ranking empiezan en 1. Para figurar se deben cumplir los mínimos configurados de partidas y rivales distintos. Sólo se publican perfiles activos con `statsVisibility=ALL`; el endpoint de perfil requiere sesión y aplica además la política de amigos/bloqueos.

```json
// GET /v1/rankings?period=GLOBAL&mode=1v1&limit=20
{
  "period": "GLOBAL",
  "mode": "1v1",
  "season": {
    "id": "019a8d85-9900-7c41-9d10-aabbccddeeff",
    "label": "Temporada 1",
    "startsAt": "2026-11-19T00:00:00.000Z",
    "endsAt": "2027-02-17T00:00:00.000Z",
    "secondsUntilReset": 7776000
  },
  "minimumMatches": 5,
  "minimumOpponents": 3,
  "items": [
    {
      "position": 1,
      "userId": "019a8d2c-4f10-7b12-9a31-08c42b19e101",
      "nickname": "LuciaCriolla",
      "score": 1732.4,
      "rating": 1732.4,
      "division": "Oro",
      "matchesPlayed": 28,
      "opponentsCount": 14,
      "wins": 19
    }
  ],
  "nextCursor": null,
  "generatedAt": "2026-11-19T14:00:00.000Z"
}
```

El ciclo durable es: persistir la partida y sus participantes; procesar una sola vez el resultado competitivo dentro de una transacción (ratings, `rating_delta`, agregados, rivalidades, evidencia, marcador idempotente y outbox); proyectar en Redis. PostgreSQL es la fuente de verdad; el outbox reintenta fallos y la proyección puede reconstruirse. Una partida sólo puntúa si terminó, pertenece a una mesa competitiva y todos sus asientos son humanos. Partidas de práctica y partidas con bots nunca afectan el rating. En 2v2 se aplica el resultado del equipo a dos observaciones Glicko-2 por jugador (una por rival); no se reparte un delta de equipo. Un abandono cuenta como derrota para el rating y como abandono en las estadísticas.

El cierre de temporada congela puestos elegibles, cierra la temporada anterior, crea la siguiente, reinicia suavemente los perfiles y registra una auditoría en una sola transacción PostgreSQL. Si falla cualquier paso, se revierte todo y el mismo cierre puede reintentarse sin snapshots, temporadas ni perfiles duplicados. Se difiere mientras existan partidas competitivas en juego o resultados pendientes.

### Cola de revisión de integridad (Admin)

Estos endpoints usan la cookie separada `truco_admin_access` (2FA obligatorio) y exigen `competitive:review` en cada request. La cola sirve para revisar indicios, no para decidir automáticamente culpabilidad ni aplicar sanciones.

| Método | Ruta                                                          | Body / filtros                                                                            | Resultado                                                                                                |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET`  | `/v1/admin/competitive-reviews?status=OPEN&cursor=0&limit=25` | `status`: `OPEN`, `IN_REVIEW`, `RESOLVED` u omitido; `cursor`: entero >=0; `limit`: 1–100 | Casos paginados con señales, cuentas, partidas y evidencia registrada.                                   |
| `POST` | `/v1/admin/competitive-reviews/:caseId/claim`                 | `{ "expectedVersion": 0 }`                                                                | Toma el caso atómicamente y devuelve `status`/`version`; conflicto 409 si cambió o lo tomó otra persona. |
| `POST` | `/v1/admin/competitive-reviews/:caseId/resolve`               | `{ "expectedVersion": 1, "resolutionNote": "Se revisó la evidencia…" }`                   | Registra la decisión humana y auditoría; sólo quien tomó el caso puede resolverlo. No aplica sanciones.  |

Las señales actuales son `REPEATED_OPPONENTS`, `SHORT_MATCH`, `COORDINATED_ABANDONS` y `NEW_ACCOUNT_FEEDING`. Un caso resuelto se reabre ante evidencia nueva del mismo patrón; el cambio de versión invalida vistas administrativas obsoletas. Toda señal queda asociada a partidas y evidencia concreta para revisión humana. Las sanciones sólo pueden aplicarse por el flujo de moderación existente, mediante una acción humana separada y auditada.

El esquema OpenAPI 3.1 vivo/versionado describe estos endpoints y la cookie administrativa.
