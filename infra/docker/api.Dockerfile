# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/truco-engine/package.json ./packages/truco-engine/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/truco-engine ./packages/truco-engine
COPY apps/api ./apps/api
RUN pnpm --filter @truco/api... build && pnpm --filter @truco/api --prod deploy /prod/api

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 1001 truco && adduser --system --uid 1001 truco
COPY --from=build --chown=truco:truco /prod/api ./
USER truco
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/v1/health || exit 1
CMD ["node", "dist/main.js"]
