# Guía de despliegue a staging / producción (M8c)

> **Versión:** 2026-11-19 (M8c). La guía cubre el **primer despliegue del MVP** en un VPS
> con Caddy como terminador TLS y Cloudflare delante. Se extiende a producción sin cambios
> arquitectónicos (mismo compose, otros dominios y secretos).

Índice: [Proveedor y región](#proveedor-y-región) · [Arquitectura](#arquitectura-de-red-y-tls) ·
[Primer despliegue](#primer-despliegue) · [Lo que tenés que hacer vos](#4-lo-que-tenés-que-hacer-vos-checklist) ·
[Firewall](#firewall-docker-se-salta-ufw) · [IP real del cliente](#ip-real-del-cliente) · [Drenaje](#drenaje-graceful-del-game-server) ·
[Backups](#backups-y-restauración) · [Verificación](#verificación-post-deploy)

---

## Proveedor y región

**VPS con `docker compose` + Cloudflare delante.**

### Región: São Paulo (`sa-east-1` / `nbg1` como respaldo)

La decisión de M8c es **São Paulo** para el cómputo del MVP:

| Opción                          | RTT Córdoba/Bs.As. | Notas                                                                                       |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| **AWS `sa-east-1` (São Paulo)** | **~35–55 ms**      | La región LATAM con menor latencia real a Argentina. `t4g.small`/`t4g.medium` (ARM) barato. |
| Hetzner `fsn1` (Alemania)       | ~210–240 ms        | Barato y confiable, pero la RTT domina el p95 de acciones WS. Sólo como respaldo.           |
| Fly.io edge EZE (Buenos Aires)  | ~10–25 ms          | Edge en EZE pero los workers corren en `us-east` a ~4× precio; sobre-complejo para el MVP.  |
| Render / Railway                | ~120–180 ms        | Sin región en LATAM ni en São Paulo en el plan base.                                        |

**Recomendación:** un único VPS pequeño en **São Paulo** (`sa-east-1`, `t4g.small` 2 vCPU ARM /
2 GB o `t4g.medium` 2 vCPU / 4 GB) para `caddy + api + game-server + web + admin`. Postgres y
Redis corren en el mismo host durante el MVP y se migran a gestionado cuando el uso supere
~200 partidas simultáneas:

- **Postgres:** **Neon `sa-east-1`** (São Paulo) o Supabase `sa-east-1`.
- **Redis:** **Upstash `sa-east-1`**.

Sin cambios de código: sólo `DATABASE_URL` / `REDIS_URL`. Si el proveedor elegido no tiene
São Paulo, el respaldo documentado es Hetzner `fsn1` + Cloudflare con PoP en Buenos Aires
(Ezeiza), aceptando 210–240 ms de RTT.

**Por qué importa la región:** el objetivo de M8b/`PERF.md` es p95 de acción WS < 150 ms
_cliente↔edge_. Con el nodo en São Paulo la RTT Córdoba→São Paulo (~35–55 ms) deja margen
suficiente; con el nodo en Alemania la RTT sola ya consume el presupuesto.

### Costos de referencia (2026, aproximados)

| Ítem                                    | Mensual        |
| --------------------------------------- | -------------- |
| VPS São Paulo `t4g.small` (ARM, 2 GB)   | ~USD 12–15     |
| Volumen de backups 20–40 GB             | ~USD 2–4       |
| Cloudflare Free (CDN + WAF + Turnstile) | USD 0          |
| Dominio `.ar` / `.com.ar`               | ~USD 1–2       |
| **Total MVP**                           | **~USD 15–21** |

---

## Arquitectura de red y TLS

```
Cliente ──TLS──▶ Cloudflare (edge, WAF, Turnstile) ──▶ VPS :443 ──▶ caddy ──▶ [red interna Docker]
                                                          :80 (ACME + redirect)   ├─ web:8080
                                                                                  ├─ api:3001
                                                                                  ├─ admin:8080
                                                                                  └─ game-server:3002
```

| Subdominio       | Origen                                     | Cabeceras                                                          |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `app.truco.ar`   | Cloudflare → `caddy` → `web` (nginx SPA)   | HSTS + COOP + CSP desde `web`                                      |
| `api.truco.ar`   | Cloudflare → `caddy` → `api` (Fastify)     | `X-Forwarded-For` reescrito por Caddy con la IP real de Cloudflare |
| `admin.truco.ar` | Cloudflare → `caddy` → `admin` (nginx SPA) | `X-Robots-Tag: noindex`, `Cache-Control: no-store`                 |
| `game.truco.ar`  | Cloudflare → `caddy` → `game-server` (WS)  | Upgrade a WebSocket, sin timeout de lectura                        |

**Sólo `caddy` publica puertos.** `api`, `game-server`, `web`, `admin`, `postgres` y `redis`
viven en la red `truco-net` y no son alcanzables desde la IP pública (ni siquiera desde el
propio host por la interfaz externa). Esto lo verifica `scripts/check-caddyfile.mjs` en CI.

La cookie `truco_access` (HttpOnly; Secure; SameSite=Lax) se emite con `Domain=.truco.ar`,
así el navegador la envía a los tres subdominios sin ser cross-site (ADR-016).

TLS: Caddy obtiene y renueva certificados ACME automáticamente en `:80`/`:443`. El modo de
Cloudflare debe ser **Full (strict)**: Cloudflare valida el certificado de Caddy, y Caddy
valida el de Cloudflare.

---

## Primer despliegue

Sigue las fases en orden. Las fases 1–3 son **tuyas** (consola de proveedores); las fases
4–7 las ejecuta el workflow de GitHub Actions salvo donde se indica.

### Fase 0 — Pre-requisitos en el repo (una vez)

1. CI de `main` en verde.
2. GitHub → Settings → **Environments** → `staging` → _Required reviewers_ = tu usuario.
3. GitHub → Settings → Secrets and variables → Actions: `STAGING_SSH_HOST`, `STAGING_SSH_USER`,
   `STAGING_SSH_KEY`, `STAGING_ENV` (contenido completo del `.env` de staging, ver más abajo).

### Fase 1 — Servidor

```bash
# En el VPS (Ubuntu 24.04 LTS), como root/sudo:
apt update && apt install -y docker.io docker-compose-plugin rsync curl ufw iptables-persistent

# El workflow de deploy copia el repo en este directorio:
mkdir -p ~/truco-start && cd ~/truco-start

# Firewall (ver sección "Firewall"): security group del proveedor + DOCKER-USER
sudo SSH_ALLOW_FROM=<tu-ip>/32 ./scripts/cloudflare-ufw.sh apply
```

El security group del proveedor debe dejar abiertos **sólo**:

- `22/tcp` desde **tu IP** (no `0.0.0.0/0`).
- `80/tcp` y `443/tcp` desde `0.0.0.0/0` **sólo si** no podés restringirlo a los rangos de
  Cloudflare; si podés, restringilo a `https://www.cloudflare.com/ips-v4` + `ips-v6`.
- **Nada más.** Ni 3001, ni 3002, ni 5432, ni 6379: no están publicados por el compose.

### Fase 2 — DNS y TLS (Cloudflare)

1. Delegar el dominio a Cloudflare (nameservers).
2. Registros **A/AAAA proxied (naranja)** para `app`, `api`, `admin`, `game` → IP del VPS.
3. SSL/TLS → **Full (strict)**. Activar _Always Use HTTPS_.
4. Regla WAF de rate-limit en `/v1/auth/login` y `/v1/auth/register`.
5. Clave Turnstile (dominio `*.truco.ar`).

### Fase 3 — Proveedores externos

- **Email:** Resend (`EMAIL_PROVIDER=resend` + `RESEND_API_KEY`) o SMTP
  (`EMAIL_PROVIDER=smtp` + `SMTP_CONNECTION_URL`). Verificar SPF/DKIM/DMARC del dominio.
- **Google OAuth:** credencial OAuth 2.0 "Web application", orígenes
  `https://app.truco.ar`, redirect `https://app.truco.ar/auth/google/callback`.
  `GOOGLE_CLIENT_ID` activa la verificación real de ID tokens por JWKS (`jose`).

### Fase 4 — Preparar el `.env` de staging

Copiar `.env.example` y completar. **Nunca versionar este archivo.**

```bash
NODE_ENV=staging
APP_NAME="Mesa de Truco Staging"

# Dominio y TLS (Caddy)
APP_DOMAIN=truco.ar
ACME_EMAIL=ops@truco.ar

# Base de datos / Redis
POSTGRES_USER=truco_staging
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=truco_staging
DATABASE_URL=postgres://truco_staging:${POSTGRES_PASSWORD}@postgres:5432/truco_staging
REDIS_URL=redis://redis:6379

# Secretos (openssl rand -hex 32)
SESSION_SECRET=<32+ chars>
SEED_ENCRYPTION_KEY=<64 hex chars>
INTERNAL_RPC_SECRET=<32+ chars>

# Cookies / CORS
COOKIE_DOMAIN=.truco.ar
CORS_ORIGINS=https://app.truco.ar
ADMIN_ORIGIN=https://admin.truco.ar
ADMIN_ALLOWED_NETWORKS=<tu-ip>/32

# IP real del cliente: rangos de Cloudflare (ver sección dedicada)
TRUSTED_PROXY_CIDRS=$(curl -s https://www.cloudflare.com/ips-v4 | paste -sd, -)
TRUSTED_PROXY_HEADER=x-forwarded-for
```

> `TRUSTED_PROXY_CIDRS` alimenta **dos** consumidores: el `trusted_proxies` de Caddy (la
> cabecera `CF-Connecting-IP` sólo se acepta desde esos rangos) y la lista de proxies
> confiables de la API. Ver [IP real del cliente](#ip-real-del-cliente).

### Fase 5 — Primer `up`

> **`--env-file .env` es obligatorio.** Docker Compose interpola `${POSTGRES_USER}`, `${POSTGRES_PASSWORD}`,
> `${APP_DOMAIN}`, etc. desde un `.env` ubicado en el **directorio del archivo compose**
> (`infra/`), no en la raíz del repo. Si se omite `--env-file .env`, esos valores quedan
> vacíos, Postgres arranca sin usuario y el stack falla. Los servicios además usan
> `env_file: ../.env` para sus variables de runtime, así que el mismo archivo sirve para ambos.
> (Este error se reprodujo en CI y está cubierto por el job `perimeter-smoke`.)

```bash
cd ~/truco-start
COMPOSE="docker compose --env-file .env -f infra/docker-compose.staging.yml"

$COMPOSE build
$COMPOSE run --rm migrate     # migraciones (aborta el deploy si fallan)
$COMPOSE up -d --wait
$COMPOSE ps                   # todo "healthy"
$COMPOSE logs -f caddy        # emisión ACME (Let's Encrypt)
```

Si Caddy no obtiene el certificado: el registro DNS no está proxied, o el puerto 80 no llega
al VPS (security group o DOCKER-USER). Ver [RUNBOOKS.md](./RUNBOOKS.md#incidentes).

### Fase 6 — Verificación

```bash
curl -fsS https://api.truco.ar/v1/health
curl -fsS https://game.truco.ar/health
curl -fsSI https://app.truco.ar | grep -i strict-transport-security

# La IP directa del VPS NO debe aceptar 80/443:
./scripts/cloudflare-ufw.sh verify <ip-publica-del-vps>
```

### Fase 7 — Despliegues siguientes

Actions → **"Deploy to staging (M8c)"** → _Run workflow_. El job `build-and-smoke-test`
valida compose + Caddyfile + firewall y levanta un stack efímero; después el environment
`staging` espera tu aprobación y recién ahí se copia al VPS, se migra y se reinicia con
`--wait`.

---

## 4. Lo que tenés que hacer vos (checklist)

Todo lo que requiere una cuenta, un pago o un clic en una consola externa. **Nada de esto
puede hacerlo un agente desde el repo.**

| #   | Tarea                                                                                        | Dónde                         | Listo |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------- | :---: |
| 1   | Contratar el VPS en **São Paulo** (Ubuntu 24.04 LTS)                                         | Proveedor cloud               |   ☐   |
| 2   | Configurar el **security group**: sólo 22 (tu IP) + 80/443                                   | Consola del proveedor         |   ☐   |
| 3   | Crear el volumen de backups y montarlo en `/mnt/backups`                                     | Consola del proveedor         |   ☐   |
| 4   | Comprar el dominio y delegar los nameservers a Cloudflare                                    | NIC.ar / registrador          |   ☐   |
| 5   | Crear los 4 registros A proxied (`app`, `api`, `admin`, `game`)                              | Cloudflare                    |   ☐   |
| 6   | Poner SSL/TLS en **Full (strict)**                                                           | Cloudflare                    |   ☐   |
| 7   | Crear la regla WAF de rate-limit en `/v1/auth/*`                                             | Cloudflare                    |   ☐   |
| 8   | Crear la clave de **Turnstile**                                                              | Cloudflare                    |   ☐   |
| 9   | Verificar el dominio en **Resend** (SPF/DKIM/DMARC) y generar API key                        | Resend                        |   ☐   |
| 10  | Crear credencial **Google OAuth 2.0** (orígenes + redirect)                                  | Google Cloud Console          |   ☐   |
| 11  | Generar `SESSION_SECRET`, `SEED_ENCRYPTION_KEY`, `INTERNAL_RPC_SECRET`, `POSTGRES_PASSWORD`  | Local (`openssl rand -hex …`) |   ☐   |
| 12  | Cargar los 4 secrets de Actions y crear el environment `staging` con tu aprobación           | GitHub                        |   ☐   |
| 13  | Instalar Docker + ufw + iptables-persistent en el VPS                                        | Fase 1                        |   ☐   |
| 14  | Ejecutar `sudo SSH_ALLOW_FROM=<ip>/32 ./scripts/cloudflare-ufw.sh apply`                     | VPS                           |   ☐   |
| 15  | Verificar desde **fuera** que la IP directa rechaza 80/443 (`cloudflare-ufw.sh verify <ip>`) | Tu máquina                    |   ☐   |
| 16  | Ejecutar el workflow de deploy y aprobar el environment                                      | GitHub Actions                |   ☐   |
| 17  | Alta del primer admin: `pnpm --filter @truco/api admin:create`                               | VPS                           |   ☐   |
| 18  | Revisión legal de privacidad/Términos (bloquea M8d)                                          | Abogado                       |   ☐   |

---

## Firewall: Docker se salta ufw

**El problema.** Cuando un servicio publica un puerto, el motor de Docker inserta reglas
DNAT/ACCEPT en `iptables` que se evalúan **antes** que las de `ufw`. Por eso
`ufw deny 443` **no** protege un puerto publicado por Docker: el tráfico llega igual al
contenedor. Cualquier guía que diga "abrí sólo 443 en ufw" está incompleta.

**Las dos capas.**

1. **Defensa principal — firewall del proveedor (security group / cloud firewall).**
   Es el único control que no depende del software del servidor. Debe permitir sólo `22`
   (desde tu IP) y `80`/`443`. Si este firewall se abre de más, las reglas de abajo siguen
   protegiendo, pero la primera capa ya falló.
2. **Segunda capa — cadena `DOCKER-USER`.**
   Es la única cadena que Docker **respeta y no sobrescribe** (se evalúa antes que sus
   reglas). Acota el origen de 80/443 a los rangos de Cloudflare.

**Aplicar.**

```bash
# Regenera los rangos de Cloudflare en vivo y aplica en forma atómica (valida antes):
sudo SSH_ALLOW_FROM=<tu-ip>/32 ./scripts/cloudflare-ufw.sh apply --dry-run   # revisar
sudo SSH_ALLOW_FROM=<tu-ip>/32 ./scripts/cloudflare-ufw.sh apply

# Versión estática con los rangos vigentes (la que valida CI con iptables-restore --test):
sudo iptables-restore infra/firewall/docker-user-cloudflare.rules
```

Reglas efectivas (archivo `infra/firewall/docker-user-cloudflare.rules`):

| Origen                            | Puerto           | Acción          |
| --------------------------------- | ---------------- | --------------- |
| `RELATED,ESTABLISHED`             | cualquiera       | `RETURN`        |
| Rangos de Cloudflare              | `tcp 80,443`     | `RETURN` (pasa) |
| Rangos de Cloudflare              | `udp 443` (QUIC) | `RETURN` (pasa) |
| Cualquier otro                    | `tcp 80,443`     | **`DROP`**      |
| Cualquier otro                    | `udp 443`        | **`DROP`**      |
| Resto del tráfico de contenedores | —                | `RETURN`        |

**Persistencia.** Docker no recrea `DOCKER-USER` al reiniciar: el script guarda con
`netfilter-persistent`. Verificá tras un reboot con `sudo iptables -S DOCKER-USER | head`.

**Cómo verificar desde afuera que la IP directa rechaza conexiones.**

```bash
# Desde TU máquina (no desde el VPS). Esperado: fallo/timeout en ambos puertos.
curl -sS --connect-timeout 5 https://<ip-del-vps>/ -o /dev/null -w '%{http_code}\n'   # error de conexión
curl -sS --connect-timeout 5 http://<ip-del-vps>/v1/health                            # error de conexión

# Alternativa con el script:
./scripts/cloudflare-ufw.sh verify <ip-del-vps>
#   OK: <ip>:80 rechaza/timeout la conexión directa
#   OK: <ip>:443 rechaza/timeout la conexión directa

# Confirmación complementaria: el dominio SÍ responde (vía Cloudflare)
curl -fsS https://api.truco.ar/v1/health
```

Si la IP directa responde, la conexión no está pasando por Cloudflare:
`cloudflare-ufw.sh verify` falla y hay que revisar `iptables -S DOCKER-USER`, el security
group del proveedor y que los registros DNS estén proxied (naranja).

---

## IP real del cliente

**Regla:** la IP del cliente se resuelve **sólo** desde proxies confiables (ADR-020, ADR-022).
Un cliente que falsifique `X-Forwarded-For` o `CF-Connecting-IP` no puede cambiar la IP que
ve la aplicación.

Cadena de confianza:

1. Cloudflare conecta al VPS. Caddy ve como par TCP a un **edge de Cloudflare**.
2. `trusted_proxies static {$TRUSTED_PROXY_CIDRS}` + `client_ip_headers CF-Connecting-IP`
   (con `trusted_proxies_strict`): Caddy acepta `CF-Connecting-IP` **sólo** desde esos rangos.
3. Caddy **reescribe** `X-Forwarded-For` con `{client_ip}`
   (`header_up X-Forwarded-For {client_ip}`). No la appendea: si la appendeara, la API —que
   toma la **primera** IP de la lista— leería la IP falsificada que prependeó el cliente.
4. La API y el game-server confían en `x-forwarded-for` únicamente desde
   `TRUSTED_PROXY_CIDRS=172.16.0.0/12` (red interna de Docker, `TRUSTED_PROXY_HEADER=x-forwarded-for`).
5. Fuera de esos rangos, todas las cabeceras se ignoran y se usa la IP del socket.

**Configuración coherente (los tres componentes):**

| Componente  | Variable               | Valor de staging                                    |
| ----------- | ---------------------- | --------------------------------------------------- |
| Caddy       | `TRUSTED_PROXY_CIDRS`  | rangos de Cloudflare (`ips-v4`, separados por coma) |
| API         | `TRUSTED_PROXY_CIDRS`  | `172.16.0.0/12`                                     |
| API         | `TRUSTED_PROXY_HEADER` | `x-forwarded-for`                                   |
| game-server | `TRUSTED_PROXY_CIDRS`  | `172.16.0.0/12`                                     |
| game-server | `TRUSTED_PROXY_HEADER` | `x-forwarded-for`                                   |

> No pongas los rangos de Cloudflare en la API: la API nunca ve una conexión de Cloudflare
> directa (Caddy está en el medio). Si los pusieras, un fallo de Caddy dejaría la API
> expuesta a confiar en cabeceras de cualquier IP pública.

**Prueba de que las cabeceras falsas no funcionan** (corre en CI contra el compose y se
puede correr en el VPS):

```bash
node scripts/test-client-ip-spoofing.mjs                                  # contra compose en CI
node scripts/test-client-ip-spoofing.mjs --url http://127.0.0.1:18080    # contra un stack local
```

El test envía `X-Forwarded-For`, `CF-Connecting-IP` y `X-Real-IP` falsificadas y exige que la
IP registrada por la API sea la del socket, no la falsa. Además
`scripts/verify-client-ip.mjs --caddyfile` verifica la configuración sin red.

---

## Drenaje graceful del game-server (por qué no se cortan partidas)

- `docker compose up -d` envía SIGTERM al contenedor viejo y espera
  `stop_grace_period: 45s` antes de SIGKILL.
- `apps/game-server/src/main.ts` escucha SIGTERM, llama a `roomManager.setDraining(true)` y
  luego `server.close()`.
- En modo draining: no se aceptan mesas nuevas, `/ready` responde **503** (Caddy/Cloudflare
  lo sacan del pool) y las partidas activas siguen hasta terminar o hasta que expire
  `reconnectGraceMs`.

---

## Backups y restauración

- `infra/backups/backup-postgres.sh` hace `pg_dump -F c` a `/mnt/backups/truco-YYYYMMDD.dump`
  con retención configurable (`BACKUP_RETENTION_DAYS`).
- CI ejecuta un simulacro real (migrar → sembrar → respaldar → restaurar en base vacía →
  **comparar conteos**).
- En el VPS: habilitar **snapshots automáticos** del volumen y un cron diario del script.
  Procedimiento de restauración: [RUNBOOKS.md](./RUNBOOKS.md#respaldos-y-restauración).

---

## Verificación post-deploy

```bash
curl -fsS https://api.truco.ar/v1/health          # {"status":"ok"}
curl -fsS https://game.truco.ar/health
curl -fsSI https://app.truco.ar | grep -iE 'strict-transport-security|x-content-type'
curl -fsSI https://admin.truco.ar | grep -i 'x-robots-tag'
ssh <user>@<ip> "sudo iptables -S DOCKER-USER | head -5"   # reglas aplicadas
ssh <user>@<ip> "cd ~/truco-start && docker compose --env-file .env -f infra/docker-compose.staging.yml ps"
./scripts/cloudflare-ufw.sh verify <ip>                    # IP directa rechaza 80/443
```

Si todo responde 200/`ok` y la IP directa está cerrada, el deploy quedó bien.
