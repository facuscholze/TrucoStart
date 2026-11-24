# Lista de Verificación Legal — Mesa de Truco

> **Documento de trabajo para revisión profesional.**
> Nada de lo que sigue es asesoramiento legal ni una afirmación de cumplimiento.
> Es un inventario de hechos verificables del sistema y de las preguntas que un
> abogado necesita responder antes de publicar el producto. Cada punto está
> marcado como **PENDIENTE** (requiere decisión legal) o **RESUELTO EN CÓDIGO**
> (el sistema ya implementa el mecanismo; falta la validación profesional).
>
> Última actualización: M9b (2026-11-19). Si el esquema de base de datos cambia,
> la sección 2 queda desactualizada: es la parte que hay que revisar primero.

---

## 1. Marco normativo a considerar

| Norma                                                                              | Por qué aplica                                                                                                                                    | Estado                                                                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Ley 25.326** (Protección de Datos Personales) y su Decreto 1558/2001             | La plataforma recolecta y trata datos de personas identificadas e identificables (correo, apodo, IP, historial de partidas). Es de orden público. | **PENDIENTE** de análisis profesional.                                                                               |
| **Artículo 21 Ley 25.326** — Registro Nacional de Bases de Datos (AAIP / ex DNPDP) | Establece la inscripción de bases de datos. La obligación se analiza según finalidad y uso real de cada base, no sólo su nombre.                  | **PENDIENTE** de definir si corresponde y, en su caso, inscribir.                                                    |
| **Artículo 24 Ley 25.326**                                                         | Extiende el registro a archivos privados que no sean de uso exclusivamente personal. Es el punto que un abogado debe interpretar para este caso.  | **PENDIENTE**.                                                                                                       |
| **Artículos 3 a 11 Ley 25.326** — principios                                       | Calidad de los datos, consentimiento, finalidad, seguridad.                                                                                       | Parcialmente cubierto en código (ver §3).                                                                            |
| **Artículo 14 y ss. Ley 25.326** — derechos del titular                            | Acceso, rectificación, actualización y supresión.                                                                                                 | **PENDIENTE**: existe exportación y borrado técnico, falta el procedimiento publicado y el plazo legal de respuesta. |
| **Artículo 7 Ley 25.326** — datos sensibles                                        | El producto **no** los trata (ver §2.4).                                                                                                          | **RESUELTO EN CÓDIGO** (no se recolectan), **PENDIENTE** de confirmación profesional.                                |
| **CCyC arts. 25 y 26** — mayoría de edad / capacidad                               | Plena capacidad para contratar a los 18 años.                                                                                                     | **RESUELTO EN CÓDIGO** (edad mínima por defecto 18), ver §4.                                                         |
| **CCyC art. 1117 y ss.** — contratos por adhesión y cláusulas abusivas             | Los Términos son un contrato de adhesión.                                                                                                         | **PENDIENTE** de redacción definitiva y control de cláusulas abusivas.                                               |
| **Ley 24.240** (Defensa del Consumidor)                                            | Puede aplicar a la relación con el usuario aun sin pago.                                                                                          | **PENDIENTE** de análisis.                                                                                           |
| **Ley 26.043** — clasificación de videojuegos                                      | Establece el etiquetado de edad para videojuegos en Argentina.                                                                                    | **PENDIENTE**: definir si corresponde clasificación del título.                                                      |
| **Ley 25.326 reforma / proyectos**                                                 | Hay proyectos de reforma en trámite. No se asume aprobada ninguna.                                                                                | **PENDIENTE** de seguimiento.                                                                                        |

> **Nota:** este cuadro se armó con fuentes públicas (InfoLeg y material de la
> AAIP). **No se citó jurisprudencia ni doctrina como concluyente.** El abogado
> debe validar vigencia y aplicabilidad de cada punto.

---

## 2. Datos personales que el sistema guarda HOY

Esta sección **no es una plantilla**: se generó leyendo el esquema real en
`apps/api/src/db/schema/*.ts` y las migraciones `apps/api/drizzle/0000`–`0009`.
Son 29 tablas; M9a agregó cuatro tablas sociales y M9b agregó nueve tablas de
ratings, temporadas y revisión competitiva, además de columnas de rating en
`matches` y `tables`.

### 2.1 Identidad y cuenta — `users` (24 columnas)

| Dato                        | Columna                                                                  | Comentario                                                                                   |
| --------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Correo electrónico          | `email`                                                                  | Identificable directo. Nulo en invitados.                                                    |
| Verificación de correo      | `email_verified_at`                                                      | Fecha.                                                                                       |
| Contraseña                  | `password_hash`                                                          | **Argon2id**, nunca texto plano.                                                             |
| Identificador de Google     | `google_sub`                                                             | Identificable directo si se usa OAuth.                                                       |
| Apodo                       | `nickname`, `nickname_lower`                                             | Visible públicamente en la mesa.                                                             |
| Condición de invitado       | `is_guest`                                                               |                                                                                              |
| Rol y estado de cuenta      | `role`, `status`, `status_reason`, `status_expires_at`                   | `status_reason` puede contener texto de moderación.                                          |
| Silencio de chat            | `muted_until`                                                            |                                                                                              |
| Forzar cambio de apodo      | `nickname_must_change`                                                   |                                                                                              |
| Intentos fallidos y bloqueo | `failed_login_count`, `locked_until`, `last_failed_login_at`             | Seguridad.                                                                                   |
| Fechas                      | `created_at`, `updated_at`, `deleted_at`                                 | `deleted_at` sostiene el borrado lógico.                                                     |
| **Aceptación legal**        | `terms_version`, `privacy_version`, `legal_accepted_at`, `legal_min_age` | **Nuevo en M8d.** Constancia de qué versión se aceptó, cuándo y con qué edad mínima vigente. |

### 2.2 Perfil — `profiles` (9 columnas)

`user_id`, `avatar_id`, `level`, `xp`, `bio` (hasta 280 caracteres, texto libre),
`settings` (JSON: preferencias y visibilidad independiente de historial,
estadísticas y presencia), `created_at`, `updated_at`. Las tres visibilidades
admiten `ALL`, `FRIENDS` o `NOBODY` y tienen default técnico `FRIENDS`; el
bloqueo prevalece sobre una visibilidad pública.

> `bio` es el único campo de **texto libre público** escrito por el usuario. Es
> el candidato más probable a contener datos personales no previstos: conviene
> definirlo explícitamente en la política.

### 2.3 Sesiones y seguridad — `sessions`, `auth_tokens`, `admin_sessions`, `admin_two_factor`

| Tabla                  | Datos personales                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `sessions` (13)        | `refresh_hash`, **`device_name`**, **`user_agent`**, **`ip_address`**, fechas, motivo de revocación. |
| `auth_tokens` (7)      | `token_hash` (hash, no el token), finalidad, vencimiento.                                            |
| `admin_sessions` (9)   | `token_hash`, `totp_verified_at`, **`ip_address`**, **`user_agent`**.                                |
| `admin_two_factor` (7) | `secret_encrypted`, `recovery_codes` (cifrados), `last_used_step`.                                   |

> **`ip_address` y `user_agent` son datos personales** según la Ley 25.326 y
> deben figurar en la política como tales, con su finalidad (seguridad y
> prevención de abuso) y su plazo de conservación. **PENDIENTE** de definir plazo.

### 2.4 Datos que el sistema NO guarda (verificado)

- **No** se guarda la fecha de nacimiento ni la edad declarada: `legal.age` se usa
  en el alta para el control de edad mínima y se descarta (test explícito).
- **No** se guardan datos sensibles del art. 7 de la Ley 25.326.
- **No** se guardan datos de tarjetas, CBU, CVU, alias bancario, billetera virtual
  ni saldo: el esquema no tiene ninguna columna monetaria. Verificado por
  `scripts/check-no-real-money.mjs`.
- **No** se guarda la semilla de barajado antes de revelarla: sólo se persiste el
  compromiso (`seed_commitment`) hasta el final de la partida.

### 2.5 Actividad de juego — `tables`, `table_seats`, `matches`, `match_players`, `match_events`, `rulesets`

- `tables` (16): `owner_id`, modalidad, reglas, código de invitación, estado, vencimiento.
- `table_seats` (7): `user_id`, `nickname`, asiento, equipo.
- `matches` (13): `seed_commitment`, `result` (JSON), `has_bots`, `is_competitive`, `season_id`, fechas.
- `match_players` (8): `user_id`, asiento, equipo, puntaje, resultado, `rating_delta`.
- `match_events` (5): `payload` (JSON con los eventos de la partida).
- `rulesets` (6): configuración de reglas; sin datos personales.

> El historial permite inferir con quién jugó cada persona y cuándo; las
> estadísticas agregadas permiten inferir resultados. En M9a existe control
> técnico separado (`historyVisibility` / `statsVisibility`, default `FRIENDS`),
> con acceso propio y bloqueo prevalente. **PENDIENTE** de validar legalmente la
> finalidad, base de tratamiento, alcance de publicación y plazos de retención.

### 2.5.1 Grafo social M9a — `friendships`, `user_blocks`, `social_invitations`, `social_notifications`

- `friendships` (7): identificadores de ambas cuentas, quién inició la solicitud,
  estado y fechas; revela relaciones/contactos y actividad de solicitudes.
- `user_blocks` (3): ambas cuentas y fecha; información de preferencias de
  interacción y seguridad.
- `social_invitations` (12): emisor, destinatario, tipo/estado, mesa/reglas,
  expiración, aceptación y fechas; revela actividad social y de juego.
- `social_notifications` (9): destinatario, actor, tipo, referencias a solicitud
  o mesa, payload, fecha y lectura; entrega de forma privada por usuario.
- La presencia no se conserva como historial relacional: se calcula desde leases
  efímeros de Redis (TTL 45 s, heartbeat 15 s) y se filtra por preferencia y
  bloqueos. **PENDIENTE** de validar aviso, finalidad y retención de datos sociales;
  el default técnico no sustituye una base legal ni una política publicada.

### 2.5.2 Ratings y temporadas M9b

- `rating_seasons`: identificadores, número/etiqueta y fechas de cada temporada;
  no contiene perfil de jugador por sí sola.
- `rating_profiles`: relación cuenta, modo (`1v1`/`2v2`) y temporada, rating,
  desviación, volatilidad y agregados de resultados. Es un perfil de rendimiento
  derivado de partidas.
- `rating_rivalries`: identificadores de pares de rivales, modalidad/temporada,
  frecuencia, resultados y fechas; permite inferir relaciones y actividad de juego.
- `rating_period_stats`: puntos de rating y conteos por semana/mes; conserva una
  lista de identificadores de rivales distintos (`opponent_ids`).
- `rating_season_snapshots`: posiciones congeladas, rating, división y actividad
  elegible por usuario al cerrar una temporada.
- `rating_jobs` y `rating_redis_outbox`: marcas por partida/temporada y cargas de
  proyección que pueden contener identificadores, puntajes y elegibilidad. Redis
  es una caché reconstruible; PostgreSQL conserva el registro durable.
- `rating_season_audits`: relación entre temporadas cerradas/siguientes y conteos
  de snapshots; es un registro operativo de cierre.
- `competitive_review_cases`: cuentas y partidas relacionadas, señales, duración,
  conteos de rivalidad y evidencia para revisión humana; puede registrar quién
  tomó/resolvió el caso y su nota. No aplica sanciones automáticamente.

> El rating y la clasificación son datos de rendimiento vinculables a una cuenta.
> El ranking público sólo incluye cuentas activas que cumplen mínimos y configuran
> `statsVisibility=ALL`; el perfil privado aplica las reglas de visibilidad y
> bloqueos. La finalidad, la base legal, la publicación y los plazos de retención
> de ratings, rivalidades, snapshots y evidencia **siguen PENDIENTES** de revisión
> profesional. El control técnico no sustituye una política informada.

### 2.6 Moderación y auditoría — `reports`, `sanctions`, `audit_logs`

- `reports` (18): denunciante (`reporter_id`), denunciado (`target_id`), motivo,
  **`details` (texto libre)**, estado, resolución, quién resolvió.
- `sanctions` (9): usuario, tipo, motivo, vencimiento, quién la emitió.
- `audit_logs` (11): `actor_id`, acción, entidad, **`before_state`/`after_state`
  (JSON)**, **`ip`**.

> `reports.details` es texto libre de un tercero sobre otra persona: es el punto
> de mayor riesgo de contenido difamatorio o datos de terceros. **PENDIENTE** de
> definir plazo de conservación y política de acceso.
> `audit_logs` es un registro de seguridad: probablemente quede fuera del derecho
> de supresión, pero **eso lo tiene que confirmar el abogado**, no el equipo.

### 2.7 Tutorial — `tutorial_progress` (3)

`user_id`, `completed_lessons`, `updated_at`.

---

## 3. Mecanismos técnicos ya implementados

| Requisito                               | Implementación                                                                                                                      | Estado                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Consentimiento **expreso** para el alta | `legal.accepted` debe ser literalmente `true`; sin eso la API responde 400 y **no crea la cuenta**                                  | **RESUELTO** + test                                                              |
| Constancia de la versión aceptada       | `terms_version`, `privacy_version`, `legal_accepted_at`, `legal_min_age` + evento de auditoría `AUTH_REGISTERED`                    | **RESUELTO** + test                                                              |
| Rechazo de términos obsoletos           | Si el cliente aceptó otra versión: 409 y se le pide releer                                                                          | **RESUELTO** + test                                                              |
| Borrado de cuenta                       | Borrado lógico (`deleted_at`) y anonimización de PII                                                                                | Parcial: **falta plazo legal de conservación**                                   |
| Exportación de datos del titular        | Endpoint de exportación de cuenta                                                                                                   | Parcial: **falta procedimiento publicado**                                       |
| Contraseñas                             | Argon2id, sin texto plano                                                                                                           | **RESUELTO**                                                                     |
| Cookies de sesión                       | HttpOnly + SameSite + Secure en producción                                                                                          | **RESUELTO**                                                                     |
| Privacidad M9a                          | `historyVisibility`, `statsVisibility` y `presenceVisibility` independientes; `ALL`/`FRIENDS`/`NOBODY`; bloqueos prevalecen         | RESUELTO EN CÓDIGO; aviso, finalidad y alcance **PENDIENTES** legalmente         |
| Rating competitivo M9b                  | Datos por cuenta/modo/temporada; ranking público exige mínimos y `statsVisibility=ALL`; señales sólo crean casos de revisión humana | RESUELTO EN CÓDIGO; finalidad, publicación y retención **PENDIENTES** legalmente |
| Sin dinero real (regla 13)              | `scripts/check-no-real-money.mjs` en CI                                                                                             | **RESUELTO**                                                                     |
| Registro de bases de datos              | —                                                                                                                                   | **PENDIENTE** (trámite ante AAIP)                                                |

---

## 4. Edad mínima y menores de edad

**Estado actual:** la edad mínima es configurable por `LEGAL_MIN_AGE` (rango
admitido 13–21, por defecto **18**). Se publica en `GET /v1/legal`, la web la
muestra en el alta y el servidor rechaza con 403 el alta por debajo del mínimo.

**Preguntas para el abogado — todas PENDIENTES:**

1. ¿Corresponde exigir 18 años por la capacidad para contratar (CCyC arts. 25 y 26) o alcanza con la edad que se fije para consentir el tratamiento de datos?
2. Si se permite el alta a **menores de 18**, ¿qué régimen de representación
   aplica y qué evidencia de consentimiento del responsable parental se debe
   recabar? Hoy el sistema **no** pide consentimiento parental.
3. ¿Corresponde clasificación de edad del videojuego (Ley 26.043)? El contenido
   es un juego de cartas sin violencia gráfica, pero tiene chat entre usuarios.
4. ¿Qué se hace con una cuenta detectada como de menor de edad sin autorización?
   El sistema hoy no tiene un flujo específico para eso.

> **Advertencia honesta:** el control de edad actual es **declarativo**. Una
> persona puede escribir la edad que quiera. No hay verificación documental ni
> estimación. Si el abogado requiere verificación real, es desarrollo nuevo, no
> configuración.

---

## 5. Moneda virtual, dinero real y transferencias

**Hechos verificables del sistema:**

- No existe ninguna pasarela de pago integrada.
- No existe ninguna columna de saldo, billetera o libro contable.
- No existe ningún endpoint de depósito, retiro o cobro.
- No existe transferencia de puntos entre jugadores: `rating_delta`, el rating
  competitivo y `xp` son datos individuales, derivados de resultados; no se pueden
  enviar a otra cuenta ni canjear.
- Los puntos del marcador (truco), el rating y el progreso del perfil no tienen
  valor monetario; no hay una moneda virtual transferible ni un saldo.

**Preguntas para el abogado — PENDIENTES:**

1. ¿El sistema de `xp`/`level` requiere algún disclaimer de "sin valor monetario"?
2. ¿Hace falta una cláusula explícita de que los puntos no son canjeables?
3. Si en el futuro se agregara una moneda cosmética, ¿qué régimen aplica?
   (Hoy **no existe** y la regla 13 lo prohíbe.)

---

## 6. Retención y borrado

| Dato                                 | Plazo propuesto                           | Estado                              |
| ------------------------------------ | ----------------------------------------- | ----------------------------------- |
| Cuenta y perfil                      | Mientras la cuenta exista + plazo legal   | **PENDIENTE**                       |
| Sesiones                             | Hasta vencimiento/revocación              | Definido técnicamente               |
| `auth_tokens`                        | Hasta vencimiento o consumo               | Definido técnicamente               |
| Historial de partidas y eventos      | Indefinido hoy                            | **PENDIENTE**                       |
| Estadísticas derivadas               | Se calculan desde partidas/eventos        | **PENDIENTE** (retención de fuente) |
| Ratings, rivalidades y periodos      | Por cuenta, modalidad y temporada         | **PENDIENTE** (retención de fuente) |
| Snapshots y auditoría de temporadas  | Se conservan tras el cierre               | **PENDIENTE**                       |
| Evidencia de revisión competitiva    | Cuentas/partidas, señales y notas humanas | **PENDIENTE**                       |
| Amistades, bloqueos e invitaciones   | Sin purga automática hoy                  | **PENDIENTE**                       |
| Notificaciones sociales              | Sin purga automática hoy                  | **PENDIENTE**                       |
| Presencia en Redis                   | Lease de 45 s con heartbeat de 15 s       | Definido técnicamente               |
| `reports` y `sanctions`              | Indefinido hoy                            | **PENDIENTE**                       |
| `audit_logs`                         | Indefinido hoy                            | **PENDIENTE**                       |
| `ip_address` en sesiones y auditoría | Indefinido hoy                            | **PENDIENTE**                       |

> Ningún plazo de conservación está implementado como borrado automático. Esto es
> deuda real, no un detalle: la Ley 25.326 exige que los datos no se conserven más
> de lo necesario.

---

## 7. Textos legales

Archivos: `apps/web/src/features/legal/legal-content.ts`.
Versión vigente de cada documento: `LEGAL_DOCUMENT_VERSIONS` en
`packages/shared/src/legal/legal.schema.ts`.

- [x] Los cuatro documentos existen y son accesibles.
- [x] Todos muestran «BORRADOR, PENDIENTE DE REVISIÓN LEGAL» (verificado por test).
- [x] Enlazados desde el registro y desde el pie de todas las páginas.
- [ ] **Revisión profesional de los cuatro textos.**
- [ ] Definir canal de contacto y responsable de tratamiento (hoy **no existe**).
- [x] Versionado: toda edición sustantiva debe bumpear la versión del documento.
- [ ] Definir si hace falta volver a pedir aceptación al cambiar una versión (el
      mecanismo de rechazo existe; falta la política de cuándo re-solicitar).

---

## 8. Antes de publicar — resumen ejecutivo

1. **Nombramiento del responsable de tratamiento** y canal de contacto.
2. **Análisis de inscripción** en el Registro Nacional de Bases de Datos.
3. **Revisión y aprobación de los cuatro textos legales**; quitar la marca de
   borrador sólo después de esa aprobación.
4. **Definir edades y menores**: mantener 18 o implementar consentimiento
   parental si se baja el mínimo.
5. **Definir plazos de conservación** y, si corresponde, implementar borrado
   automático.
6. **Publicar el procedimiento** para ejercer los derechos de acceso,
   rectificación y supresión, con plazos.
7. **Confirmar** que no hay tratamiento de datos sensibles ni monetarios.

> Hasta que 1 a 6 no estén cerrados, los textos deben seguir marcados como
> borrador. El código ya impide crear cuentas sin consentimiento; lo que falta es
> que el contenido del consentimiento sea jurídicamente correcto.
