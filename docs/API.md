# Contratos API REST (`/v1`)

> **Estado:** Base y endpoints de salud activos desde **M0** (`/v1/health`, `/v1/ready`). Los módulos `auth`/`users` (`STATE-03`), `lobby` (`STATE-04`) y `moderation`/`admin` (`STATE-07`) completan este documento junto con la especificación OpenAPI generada.

## Convenciones globales

- **Prefijo base:** `/v1`
- **Formato de error estándar** (`@truco/shared` -> `ApiErrorResponseSchema`):
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Los datos enviados no son válidos.",
      "details": {}
    }
  }
  ```
- **Paginación:** basada en cursor (`cursor`, `limit`, `nextCursor`).

## Endpoints implementados en M0

- `GET /v1/health`: estado vivo del proceso API.
- `GET /v1/ready`: disponibilidad del servicio para recibir tráfico.
