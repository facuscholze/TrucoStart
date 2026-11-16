# Mesa de Truco (`TrucoStart`)

Plataforma web (PWA, mobile-first) de **truco argentino online en tiempo real**, construida en español rioplatense con servidor autoritativo, reglas auditables y entretenimiento puramente social/competitivo **sin dinero real ni pay-to-win**.

> El nombre de producto (`APP_NAME="Mesa de Truco"`) está parametrizado por configuración.

---

## Arranque rápido en local

```bash
# 1. Preparar variables de entorno
cp .env.example .env

# 2. Levantar PostgreSQL 16 y Redis 7
docker compose up -d

# 3. Instalar dependencias y arrancar el monorepo en desarrollo
pnpm install
pnpm dev
```

Servicios locales por defecto:

- **PWA Jugador (`@truco/web`):** `http://localhost:5173`
- **Panel Admin (`@truco/admin`):** `http://localhost:5174`
- **API HTTP (`@truco/api`):** `http://localhost:3001/v1/health`
- **Game Server WS (`@truco/game-server`):** `http://localhost:3002/health`

---

## Arquitectura del monorepo

```
/
├─ apps/
│  ├─ web/            # PWA jugador (React 18 + Vite + Tailwind + PWA)
│  ├─ admin/          # Panel administrativo aislado
│  ├─ api/            # NestJS + Fastify (/v1)
│  └─ game-server/    # Proceso autoritativo Socket.IO (single-writer por sala)
├─ packages/
│  ├─ truco-engine/   # Motor puro de reglas, RuleSets, viewFor, IA base
│  ├─ shared/         # Esquemas Zod, contratos REST/WS, validación de entorno, errores
│  ├─ ui/             # Tokens de diseño accesibles (WCAG AA) y componentes
│  └─ config/         # Presets compartidos de ESLint, TypeScript y Prettier
├─ infra/             # Dockerfiles multi-stage, compose staging y scripts SQL
├─ docs/              # Memoria del proyecto, ADRs, reglas, API, eventos, seguridad y runbooks
└─ .github/workflows/ # Integración continua (GitHub Actions)
```

---

## Comandos de verificación

```bash
pnpm lint          # ESLint en todo el workspace
pnpm typecheck     # Chequeo estricto TypeScript (strict + noUncheckedIndexedAccess)
pnpm format:check  # Verificación de formato Prettier
pnpm test          # Suite completa de tests (Vitest + fast-check)
pnpm build         # Compilación de todos los paquetes y aplicaciones
```

---

## Documentación de referencia

- [`CLAUDE.md`](./CLAUDE.md) — Guía operativa, reglas absolutas y convenciones.
- [`docs/MASTER_PROMPT.md`](./docs/MASTER_PROMPT.md) — Especificación maestra íntegra del proyecto.
- [`docs/STATE.md`](./docs/STATE.md) — Estado vivo de módulos e inventario `STATE-xx`.
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — Registro de decisiones arquitectónicas (ADR-001 a ADR-009).
- [`docs/BACKLOG.md`](./docs/BACKLOG.md) — Funcionalidades de Etapas 2 a 5.
- [`docs/ISSUES.md`](./docs/ISSUES.md) — Riesgos, deuda técnica y restricciones operativas.
- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — Historial de entregas por módulo.
