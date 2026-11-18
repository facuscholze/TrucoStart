# Guía de despliegue a staging / producción (M8c)

> **Versión:** 2026-11-18 (M8c). Esta guía asume M8b y M8c cerrados (CI verde, adaptadores
> productivos de email/OAuth/Captcha implementados). La guía está pensada para el primer
> despliegue del MVP (staging) y luego se extiende sin cambios arquitectónicos a
> producción.

## Proveedor elegido (MVP)

**VPS en Hetzner AX102/CPX (región Falkenstein, Alemania — `fsn1`) con Cloudflare delante.**

Justificación:

- **Precio del VPS:** un CPX21 (3 vCPU AMD / 4 GB RAM / 80 GB NVMe) cuesta ~ €6,40/mes. Un CPX31
  (4 vCPU / 8 GB) para absorber el pico inicial ~ €11/mes. Es dos órdenes de magnitud más barato
  que cualquier alternativa cloud gestionada en LATAM.
- **Latencia a Argentina:** desde Falkenstein a Bs.As./Córdoba la RTT típica es 210–240 ms; con
  TLS 1.3 + 0-RTT resumido + caché estática de Cloudflare con PoP en Buenos Aires (Ezeiza) el p95
  de acciones WS queda dentro del objetivo <150 ms del cliente al edge y ~40 ms del edge al
  game-server (región este-US o FSN). Fly.io tiene edge en EZE pero los nodos workers corren en
  us-east con precios 4×; Render no tiene región LATAM.
- **Servicios gestionados:** en el MVP Postgres y Redis corren como contenedores en el mismo VPS
  (con backups diarios con `pg_dump` a volumen externo y snapshots automáticos de Hetzner).
  Cuando el uso supere las 200 partidas simultáneas se migra PG a **Neon** (us-east-1 o sa-east-1
  si está disponible) y Redis a **Upstash**, sin cambios en código (sólo `DATABASE_URL`/`REDIS_URL`).
- **CDN/WAF:** Cloudflare en el plan Free delante: TLS terminado en el edge, caché de assets
  estáticos (SPA de web/admin), WAF anti-bots y Turnstile. Cloudflare expone sus rangos de IP
  confiables para setear `TRUSTED_PROXY_CIDRS`.
- **Dominio:** un dominio `.com.ar` o `.ar` (apunta `app.truco.ar`, `api.truco.ar`,
  `admin.truco.ar` al mismo eTLD+1 `truco.ar` — ADR-016 SameSite=Lax).

## Arquitectura DNS/TLS

| Subdominio       | Origen                                               | Cabeceras                                                                 |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `app.truco.ar`   | Cloudflare → VPS :8443 (nginx) → `web` (nginx SPA)   | HSTS + CSP + COOP desde el contenedor nginx                               |
| `api.truco.ar`   | Cloudflare → VPS :8443 (nginx) → `api` (Fastify)     | `X-Forwarded-For` confiable sólo desde rangos Cloudflare                  |
| `admin.truco.ar` | Cloudflare → VPS :8443 (nginx) → `admin` (nginx SPA) | `X-Robots-Tag: noindex`, `Cache-Control: no-store`                        |
| `game.truco.ar`  | Cloudflare → VPS :8443 (nginx) → `game-server` WS    | Upgrade a WebSocket, `CF-Connecting-IP` confiable desde rangos Cloudflare |

La cookie `truco_access` (HttpOnly; Secure; SameSite=Lax) se emite con `Domain=.truco.ar`
por lo que el navegador la envía a cualquiera de los tres subdominios sin ser cross-site.

## Rangos de Cloudflare (TRUSTED_PROXY_CIDRS)

Cloudflare publica sus rangos en:

- IPv4: https://www.cloudflare.com/ips-v4
- IPv6: https://www.cloudflare.com/ips-v6

Configuración para `TRUSTED_PROXY_HEADER=cf-connecting-ip` (recomendado cuando sólo Cloudflare
toca el VPS). Copiar la lista IPv4 separada por coma como valor de `TRUSTED_PROXY_CIDRS` en
`.env`. Script auxiliar:

```bash
curl -s https://www.cloudflare.com/ips-v4 | paste -sd ',' -
```

## Checklist manual (lo que tenés que hacer una sola vez)

1. **Cuenta Hetzner Cloud:** crear proyecto `truco-mvp`, comprar un CPX21 (Ubuntu 24.04 LTS)
   en Falkenstein con firewall que sólo abra 22 (tu IP) y 8443 (público). Agregar un volumen
   de backups de 40 GB (`/mnt/backups`).
2. **Dominio:** comprar `truco.ar` (o el que elijas) en NIC.ar y delegar los nameservers a Cloudflare.
3. **Cloudflare:**
   - Crear los registros A/AAAA para `app`, `api`, `admin`, `game` apuntando a la IP del VPS
     (proxy naranja = "Proxied").
   - En SSL/TLS → Mode: **Full (strict)**.
   - Crear regla WAF que rate-limit `/v1/auth/login` y `/v1/auth/register` si no querés depender
     del rate-limit de la app.
   - Crear API Token con permisos `Zone:Cache Purge` (opcional para el paso post-deploy del
     workflow).
   - Crear una clave **Turnstile** (Sitio → Turnstile, dominio `*.truco.ar`, Managed o non-interactive).
     Guardar `Site Key` y `Secret Key`.
4. **Resend (email transaccional):** crear cuenta en https://resend.com, verificar dominio
   `truco.ar` (agregar DKIM/SPF/DMARC como indica Resend), generar API key.
5. **Google OAuth (login):** crear credencial OAuth 2.0 en Google Cloud Console, tipo
   "Web application", orígenes autorizados `https://app.truco.ar` y URIs de redirección
   `https://app.truco.ar/auth/google/callback`. Copiar `Client ID` y `Client Secret`.
6. **GitHub Secrets (repo Settings → Secrets and variables → Actions):**
   - `STAGING_SSH_HOST`: IP pública del VPS
   - `STAGING_SSH_USER`: usuario SSH (p. ej. `ubuntu` o `root`)
   - `STAGING_SSH_KEY`: contenido de la clave privada SSH (ed25519) que tenga acceso al VPS
   - `STAGING_ENV`: archivo `.env` completo de staging generado desde `.env.example` (con
     secretos reales: `SESSION_SECRET`, `SEED_ENCRYPTION_KEY`, `INTERNAL_RPC_SECRET`, credenciales Resend,
     Google, Turnstile, Postgres/Redis)
7. **GitHub Environment:** Settings → Environments → `staging` → "Required reviewers" y poner
   tu usuario como aprobador obligatorio.
8. **En el VPS:**
   ```bash
   # Como root / usuario con sudo
   apt update && apt install -y docker.io docker-compose-plugin rsync ufw
   ufw allow 22/tcp from <TU_IP_PÚBLICA>
   ufw allow 8443/tcp
   ufw enable
   mkdir -p ~/truco-start && cd ~/truco-start
   # El workflow rsync copia el repo aquí.
   ```

## Pasos de despliegue

1. Ir a Actions → **"Deploy to staging (M8c)"** → Run workflow.
2. El job `build-and-smoke-test` compila todo, valida el compose y levanta un stack efímero en
   CI para verificar que los healthchecks quedan en `healthy`.
3. Si el smoke test pasa, GitHub te muestra el botón **"Awaiting approval"** → Approve.
4. El job `deploy` copia el repo y el `.env` al VPS, corre las migraciones (`migrate` service)
   y hace `docker compose up -d` con rolling restart de `api`, `game-server`, `web` y `admin`,
   esperando que los healthchecks queden `healthy` en ≤90 s.
5. Si algo falla, `docker compose logs <service>` en el VPS permite diagnosticar; la versión
   anterior sigue corriendo hasta que todos los contenedores nuevos están healthy (política
   `--wait` de docker compose + migración transaccional).

## Drenaje graceful del game-server (por qué no se cortan partidas)

- Al correr `docker compose up -d` con la nueva imagen, Compose envía SIGTERM al contenedor
  viejo y espera `stop_grace_period: 45s` antes de SIGKILL.
- `apps/game-server/src/main.ts` escucha SIGTERM, llama a `roomManager.setDraining(true)` y
  luego `server.close()`.
- En modo draining:
  - No se aceptan nuevas mesas (`table.join` sobre salas nuevas se rechaza).
  - El endpoint `/ready` responde 503 (Cloudflare/nginx saca al contenedor del pool).
  - Las partidas activas continúan hasta finalizar (no se cortan) o hasta que expire la
    `reconnectGraceMs`.
  - El socket existente sigue transmitiendo la partida en curso.

## Backups

El VPS de staging corre un cron diario (script `infra/backups/pg-backup.sh` que se instala en
M8d) que hace `pg_dump -F c` a `/mnt/backups/truco-YYYYMMDD.dump`, retención 7 días.
En Hetzner, habilitar snapshots automáticos diarios del volumen de 40 GB.

## Variables de entorno sensibles (cargarlas en GitHub Secret `STAGING_ENV`, NUNCA en el repo)

```bash
NODE_ENV=staging
APP_NAME=Mesa de Truco Staging

# Base de datos / Redis (corren en el mismo VPS para staging)
POSTGRES_USER=truco_staging
POSTGRES_PASSWORD=<generar con openssl rand -hex 24>
POSTGRES_DB=truco_staging
DATABASE_URL=postgres://<user>:<pass>@postgres:5432/<db>
REDIS_URL=redis://redis:6379

# Secretos (generar con openssl rand -hex 32)
SESSION_SECRET=<32+ chars>
SEED_ENCRYPTION_KEY=<32+ chars>
INTERNAL_RPC_SECRET=<32+ chars>

# Cookies/CORS
COOKIE_DOMAIN=.truco.ar
CORS_ORIGINS=https://app.truco.ar,https://admin.truco.ar
ADMIN_ORIGIN=https://admin.truco.ar
ADMIN_ALLOWED_NETWORKS=<tu-ip>/32  # Restringe panel admin a tu IP

# Proxies confiables (sólo la red docker interna + Cloudflare, abajo)
TRUSTED_PROXY_CIDRS=172.16.0.0/12,<pegar lista cf ips-v4 separada por coma>
TRUSTED_PROXY_HEADER=cf-connecting-ip

# Email (Resend)
EMAIL_PROVIDER=resend
EMAIL_FROM_ADDRESS=Mesa de Truco <no-reply@truco.ar>
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxx

# Google OAuth
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOcxxxxxxx

# Turnstile (captcha)
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SITE_KEY=0x4AAAAAAAtest
CAPTCHA_SECRET=0x4AAAAAAAtestsecret

# Web pública (para links en emails)
WEB_BASE_URL=https://app.truco.ar
```

## Verificación post-deploy

```bash
ssh $STAGING_SSH_USER@$STAGING_SSH_HOST
cd ~/truco-start
docker compose -f infra/docker-compose.staging.yml ps
curl -f https://api.truco.ar/v1/health
curl -f https://game.truco.ar/health
```

Si los dos healthchecks devuelven 200 con `status: ok`, el deploy quedó bien.
