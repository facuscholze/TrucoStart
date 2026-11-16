# Mesa de Truco (`TrucoStart`)

Plataforma web (PWA, mobile-first) de **truco argentino online en tiempo real**, construida en español rioplatense con servidor autoritativo, reglas auditables y entretenimiento puramente social/competitivo **sin dinero real ni pay-to-win**.

> El nombre de producto (`APP_NAME="Mesa de Truco"`) está parametrizado por configuración.

---

## Arranque completo en 1 comando (`pnpm dev:all`)

Requisitos previos: **Node.js >= 20.11**, **pnpm >= 9** y **Docker Desktop / Docker Engine** en ejecución.

```bash
# 1. Instalar dependencias del monorepo
pnpm install

# 2. Levantar todo el stack local en un solo comando:
#    - Copia .env.example -> .env si aún no existe
#    - Inicia PostgreSQL 16 y Redis 7 (docker compose up -d) y espera puertos listos
#    - Compila paquetes compartidos (@truco/engine, @truco/shared, @truco/ui)
#    - Ejecuta migraciones SQL y RuleSets oficiales (pnpm db:migrate)
#    - Carga cuentas de prueba de desarrollo (pnpm db:seed:dev)
#    - Inicia en paralelo API (:3001), Game Server (:3002) y Web PWA (:5173)
pnpm dev:all
```

> Si ya tenés PostgreSQL 16 y Redis 7 corriendo por fuera de Docker Compose, podés usar `pnpm dev:all -- --skip-docker`.

### Servicios locales por defecto

- **PWA Jugador (`@truco/web`):** `http://localhost:5173`
- **Mesa solo desarrollo vs. bots (`DEV`):** `http://localhost:5173/dev/mesa`
- **API HTTP (`@truco/api`):** `http://localhost:3001/v1/health`
- **Game Server WS (`@truco/game-server`):** `http://localhost:3002/health`
- **Panel Admin (`@truco/admin`, cuando se levanta con `pnpm dev`):** `http://localhost:5174`

---

## Cuentas de prueba (`pnpm db:seed:dev`)

El seed de desarrollo (bloqueado automáticamente si `NODE_ENV=production`) crea de forma idempotente **4 cuentas verificadas** listas para probar partidas **1v1** y **2v2**:

| Email                 | Contraseña      | Apodo         | Perfil sugerido  |
| --------------------- | --------------- | ------------- | ---------------- |
| `facundo@truco.local` | `TrucoDev2026!` | `FacuCordoba` | Jugador 1 (Mano) |
| `lucia@truco.local`   | `TrucoDev2026!` | `LuciaDelSur` | Jugador 2        |
| `martin@truco.local`  | `TrucoDev2026!` | `TinchoMano`  | Jugador 3 (2v2)  |
| `sofia@truco.local`   | `TrucoDev2026!` | `SofiEnvido`  | Jugador 4 (2v2)  |

---

## Cómo probar la mesa de juego en local

1. **Inspección inmediata contra bots del motor (sin segundo navegador):**
   - Con `pnpm dev:all` corriendo, abrí `http://localhost:5173/dev/mesa`.
   - Vas a ver el distintivo **`MODO DESARROLLO`** (esta ruta se elimina por completo del bundle productivo de `vite build`). Podés jugar manos completas 1v1 o 2v2 contra bots determinísticos del motor, abrir la bandeja agrupada de cantos (_Envido_, _Truco_, _Flor_), inspeccionar el anotador de fósforos y probar vistas móviles (`360px`), tablet (`768px`) y escritorio (`1200px`).

2. **Partida multijugador real conectada al `game-server` autoritativo:**
   - Abrí una ventana normal en `http://localhost:5173` y una ventana privada/incógnito en `http://localhost:5173` (para aislar cookies `HttpOnly` de sesión).
   - En la **Ventana 1**, entrá como invitado (o con `facundo@truco.local` / `TrucoDev2026!`), creá una mesa **1v1** (a 15 o 30 puntos, con o sin Flor) y copiá el **código de 6 caracteres**.
   - En la **Ventana 2**, entrá como invitado (o con `lucia@truco.local` / `TrucoDev2026!`) y unite con ese código.
   - Ambos jugadores se conectan al `game-server` solicitando un `ws-ticket` **single-use** nuevo en cada conexión y reconexión; al marcar **¡Listo!**, arranca la partida en tiempo real renderizando exclusivamente `viewFor` y las jugadas legales enviadas por el servidor.

3. **Suite E2E automatizada multi-cliente (sin `pnpm dev:all`, todo efímero):**
   - `pnpm --filter @truco/web build && pnpm --filter @truco/web test:e2e` levanta automáticamente `apps/api/scripts/e2e-stack.ts` (API `:3001` + `game-server` `:3002` con base de datos adaptativa) y `vite preview` en `http://localhost:4173`, ejecutando dos escenarios reales: **Desktop `1280x800`** (crear mesa, unirse por código, reconexión a mitad de mano con `game.rejoin`, partida completa, revancha y perfil con estadísticas reales) y **Mobile `360x800`** (mismo flujo con drawer de cantos y `/anotador` recargado sin red vía Service Worker).
   - El reparto es **determinístico**: `apps/api/scripts/e2e-stack.ts` fija `E2E_DEAL_SEED_HEX` (configurable por variable de entorno) y la suite verifica que ambos asientos reciben siempre exactamente las mismas cartas y que la revancha reparte igual, de modo que cada corrida juega la misma partida.
   - `pnpm --filter @truco/web screenshots:m5b` regenera las **20 capturas** (`360px` y `1200px`) de `docs/screenshots/` sembrando una partida y una mesa pública reales.

---

## Arquitectura del monorepo

```
/
├─ apps/
│  ├─ web/            # PWA jugador (React 18 + Vite + Tailwind + PWA)
│  ├─ admin/          # Panel administrativo aislado
│  ├─ api/            # NestJS + Fastify (/v1) + namespace WS /lobby
│  └─ game-server/    # Proceso autoritativo Socket.IO (single-writer por sala)
├─ packages/
│  ├─ truco-engine/   # Motor puro de reglas, RuleSets, viewFor, IA base
│  ├─ shared/         # Esquemas Zod, contratos REST/WS, anti-replay RPC, errores
│  ├─ ui/             # Sistema de diseño accesible (WCAG AA) y baraja española SVG (40 cartas)
│  └─ config/         # Presets compartidos de ESLint, TypeScript y Prettier
├─ scripts/           # Orquestación local unificada (dev-all.mjs)
├─ infra/             # Dockerfiles multi-stage, compose staging y scripts SQL
├─ docs/              # Memoria del proyecto, ADRs, reglas, API, eventos, capturas y runbooks
└─ .github/workflows/ # Integración continua (GitHub Actions con Postgres 16 + Redis 7)
```

---

## Comandos de verificación

```bash
pnpm lint          # ESLint en todo el workspace
pnpm typecheck     # Chequeo estricto TypeScript (strict + noUncheckedIndexedAccess)
pnpm format:check  # Verificación de formato Prettier
pnpm test          # Suite completa de tests (Vitest + fast-check)
pnpm build         # Compilación de todos los paquetes y aplicaciones

# E2E y capturas de la PWA (apps/web)
pnpm --filter @truco/web test:e2e        # Playwright multi-cliente (Desktop + Mobile)
pnpm --filter @truco/web screenshots:m5b # Regenera docs/screenshots/m5b-*.png
```

---

## Documentación de referencia

- [`CLAUDE.md`](./CLAUDE.md) — Guía operativa, reglas absolutas y convenciones.
- [`docs/MASTER_PROMPT.md`](./docs/MASTER_PROMPT.md) — Especificación maestra íntegra del proyecto.
- [`docs/STATE.md`](./docs/STATE.md) — Estado vivo de módulos e inventario `STATE-xx`.
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — Registro de decisiones arquitectónicas.
- [`docs/BACKLOG.md`](./docs/BACKLOG.md) — Funcionalidades de Etapas 2 a 5.
- [`docs/ISSUES.md`](./docs/ISSUES.md) — Riesgos, deuda técnica y restricciones operativas.
- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — Historial de entregas por módulo.
