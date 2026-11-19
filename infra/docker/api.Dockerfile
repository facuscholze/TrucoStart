# syntax=docker/dockerfile:1.7
# Multi-stage producción para la API HTTP (@truco/api).
# - Imagen runner sin código fuente ni devDependencies.
# - Usuario no privilegiado `truco` (uid 1001).
# - Sin secretos: todas las credenciales por env en tiempo de ejecución.
# - Healthcheck contra /v1/health que verifica Postgres y Redis.
# - dumb-init como PID 1 para correcta re-envío de señales y drenaje graceful.
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
RUN apk add --no-cache dumb-init wget
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/truco-engine/package.json ./packages/truco-engine/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json ./apps/api/
# `@truco/api` declara `@truco/game-server` como devDependency (lo usan sus tests
# de integración). `pnpm --prod deploy` re-resuelve las dependencias del paquete y
# falla con ERR_PNPM_WORKSPACE_PKG_NOT_FOUND si el manifiesto no está en el
# workspace de la imagen, aunque no se instale su código.
COPY apps/game-server/package.json ./apps/game-server/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/truco-engine ./packages/truco-engine
COPY packages/ui ./packages/ui
COPY apps/api ./apps/api
# `--filter-prod` sigue sólo las dependencias de PRODUCCIÓN: @truco/game-server es
# una devDependency de la API (para sus tests), así que no se intenta compilar
# aquí. El deploy sí necesita su manifiesto presente (ver etapa `deps`).
RUN pnpm --filter-prod '@truco/api...' build && pnpm --filter @truco/api --prod deploy /prod/api

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache dumb-init wget \
    && addgroup --system --gid 1001 truco \
    && adduser --system --uid 1001 truco
COPY --from=build --chown=truco:truco /prod/api ./
USER truco
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/v1/health || exit 1
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
