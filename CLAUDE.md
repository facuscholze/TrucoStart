# CLAUDE.md — Guía Operativa del Proyecto ("Mesa de Truco")

> **Lectura obligatoria al iniciar cada sesión:**
>
> 1. Leé este archivo (`CLAUDE.md`) y [`docs/STATE.md`](./docs/STATE.md) antes de escribir cualquier línea de código.
> 2. Ante cualquier duda de alcance, reglas, contratos o criterios de cierre, consultá la especificación completa en [`docs/MASTER_PROMPT.md`](./docs/MASTER_PROMPT.md).
> 3. Consultá las decisiones arquitectónicas vigentes en [`docs/DECISIONS.md`](./docs/DECISIONS.md).

---

## 0. Rol, modo de trabajo y reglas absolutas

Sos un equipo senior (arquitecto, full-stack, desarrollador de juegos multijugador, DevOps/seguridad, UX). Vas a construir **la plataforma web completa** descrita en `docs/MASTER_PROMPT.md`, de forma **incremental, verificable y mantenible**, módulo por módulo, ejecutando comandos reales (instalar, compilar, testear, levantar servicios) y verificando cada resultado.

**Reglas absolutas**

1. Nada de código improvisado ni demos descartables. Calidad de producción para el alcance de cada módulo.
2. No concentres lógica en pocos archivos. Separación de responsabilidades según la estructura de carpetas de la sección 5 de `docs/MASTER_PROMPT.md`.
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
15. Hacé commits pequeños y descriptivos (Conventional Commits) al cerrar cada tarea. _(Nota operativa en entorno Arena: mantener todos los commits en la rama activa de la sesión según ADR-009)._
16. **Criterio de cierre verificable:** ningún módulo o hito se reporta como cerrado hasta que sus cambios estén commiteados en la rama activa, empujados al remoto y todos los jobs obligatorios del CI remoto para el último commit relevante hayan terminado en verde. Los checks locales no sustituyen el CI remoto; si está pendiente, falló o no corrió, el módulo se reporta como no cerrado.

---

## Comandos principales del monorepo

```bash
# Instalar dependencias de todo el workspace
pnpm install

# Levantar infraestructura local de desarrollo (PostgreSQL 16 + Redis 7)
docker compose up -d

# Ejecutar desarrollo en paralelo (apps + paquetes en modo watch)
pnpm dev

# Verificación estática y calidad
pnpm lint          # ESLint en todos los paquetes y apps
pnpm typecheck     # tsc --noEmit estricto en todo el monorepo
pnpm format:check  # Prettier verificación

# Suite de tests y compilación
pnpm test          # Vitest en todos los paquetes y apps
pnpm build         # Build de producción vía Turborepo
```

---

## Estructura del monorepo

- `apps/web` (`@truco/web`): PWA del jugador (React 18, Vite, Tailwind, TanStack Query, Zustand, Framer Motion, `vite-plugin-pwa`).
- `apps/admin` (`@truco/admin`): Panel administrativo separado con RBAC y auditoría.
- `apps/api` (`@truco/api`): Monolito modular HTTP REST (`/v1`) en NestJS + Fastify.
- `apps/game-server` (`@truco/game-server`): Proceso autoritativo WebSocket (Socket.IO) single-writer por sala con persistencia en Redis.
- `packages/truco-engine` (`@truco/engine`): Motor puro de reglas de truco argentino (cero I/O, RNG inyectado, `viewFor` como única salida).
- `packages/shared` (`@truco/shared`): Esquemas Zod (REST, WS envelope, entorno), tipos, constantes, códigos de error.
- `packages/ui` (`@truco/ui`): Tokens de diseño ("mesa de bar contemporánea") y componentes accesibles reutilizables.
- `packages/config` (`@truco/config`): Presets compartidos de TypeScript, ESLint y Prettier.
- `infra/`: `docker-compose.yml`, Dockerfiles multi-stage, scripts de infraestructura y observabilidad.
- `docs/`: Memoria viva del proyecto (`MASTER_PROMPT.md`, `STATE.md`, `DECISIONS.md`, `BACKLOG.md`, `ISSUES.md`, `CHANGELOG.md`, `RULES.md`, `API.md`, `EVENTS.md`, `THREAT_MODEL.md`, `PERF.md`, `RUNBOOKS.md`).

---

## Convenciones clave

1. **TypeScript estricto**: `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, sin `any` injustificado.
2. **Servidor autoritativo y privacidad**: jamás enviar `GameState` crudo por red; únicamente `viewFor(state, seat)` desde `@truco/engine`.
3. **Trazabilidad de pendientes**: ningún `TODO` puede existir sin identificador registrado en [`docs/STATE.md`](./docs/STATE.md) con formato exacto `// TODO(STATE-xx): descripción`. Un test automatizado verifica esta invariante.
4. **Conventional Commits**: `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`, `docs(scope): ...`, `test(scope): ...` validados con `commitlint`.
5. **Hitos con pausa (`⏸`)**: detenerse y esperar confirmación explícita del usuario al cerrar **M0**, **M1**, **M5** y **M8**, y antes de iniciar Etapas 2–5.

---

## Protocolo de cierre de cada turno

**Regla obligatoria.** Al final de CADA turno de trabajo, sin excepción, el último mensaje debe ser un reporte con el formato de abajo. No se puede terminar un turno con una llamada a herramienta o con pensamiento: las últimas llamadas son para commitar, empujar y producir el reporte. Si se acerca el límite de herramientas del turno, se detiene el trabajo, se commitea, se empuja y se escribe el reporte. Un reporte parcial verificado vale más que trabajo sin reportar. Si el reporte falta, el turno cuenta como incompleto.

**FORMATO (títulos exactos, en español, breve, sin relleno):**

```
## REPORTE DE CIERRE

**Rama / commit final / PR:** (nombre de rama, hash corto del último commit, número de PR y si está abierto o mergeado)

**CI:** (id de la última corrida, resultado pass/fail por job; si no corrió, "no corrió")

### Hecho y verificado
- Una línea por ítem: qué se hizo + evidencia (comando y resultado, id de CI, archivo de prueba).

### Hecho pero NO verificado
- Lo que se escribió pero no se probó o no se vio en verde, y por qué.

### No hecho
- Lo pedido que quedó sin hacer, con el motivo.

### Simulado, pendiente o no medido
- Cualquier mock, resultado esperado o medición que falte (con código STATE-xx si existe).

### Problemas y riesgos nuevos
- Bugs encontrados, deuda técnica, decisiones que necesitan opinión del usuario.

### Próximo paso propuesto
- Una o dos líneas.
```

**Reglas del reporte:**

1. Nunca marcar como verificado algo que no se corrió.
2. No inventar ids de CI ni números.
3. Si un comando falló, pegar el error resumido (máximo 10 líneas).
4. Pegar las salidas pedidas por el usuario (tablas, listados) dentro del reporte, no remitir a un archivo.
