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
- **Paginación:** basada en cursor (`cursor`, `limit`, `nextCursor`) ordenada por `UUIDv7` descendente.

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

| Método   | Ruta                    | Auth           | Código OK | Descripción                                                                                    |
| -------- | ----------------------- | -------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `GET`    | `/v1/me`                | `truco_access` | `200`     | Cuenta y perfil privados del usuario autenticado (`email`, `settings`, `bio`, `xp`, `level`).  |
| `PATCH`  | `/v1/me`                | `truco_access` | `200`     | Actualiza `nickname`, `avatarId`, `bio` o `settings` propios.                                  |
| `GET`    | `/v1/me/export`         | `truco_access` | `200`     | Exportación portátil JSON de datos personales, estadísticas y partidas recientes (Ley 25.326). |
| `DELETE` | `/v1/me`                | `truco_access` | `200`     | Elimina cuenta propia (exige `password` si aplica), anonimiza PII y revoca todas las sesiones. |
| `GET`    | `/v1/users/:id`         | No             | `200`     | Perfil estrictamente público (`id`, `nickname`, `isGuest`, `avatarId`, `level`, `xp`, `bio`).  |
| `GET`    | `/v1/users/:id/stats`   | No             | `200`     | Estadísticas agregadas públicas (`matchesPlayed`, `wins`, `losses`, `abandons`, `winRate`).    |
| `GET`    | `/v1/users/:id/matches` | No             | `200`     | Historial público de partidas paginado por cursor (`?limit=20&cursor=<matchId>`).              |

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
      "confirmCalls": true
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
