# syntax=docker/dockerfile:1.7
# PWA del jugador servida por nginx (estático).
# - Cabeceras de seguridad definidas en nginx-web.conf (HSTS, CSP, COOP, etc.)
# - Sin variables de entorno en tiempo de build que contengan secretos
#   (sólo VITE_API_BASE_URL y endpoints públicos en build args).
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG VITE_API_BASE_URL
ARG VITE_GAME_SERVER_URL
ARG VITE_CAPTCHA_SITE_KEY
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_GAME_SERVER_URL=${VITE_GAME_SERVER_URL}
ENV VITE_CAPTCHA_SITE_KEY=${VITE_CAPTCHA_SITE_KEY}
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
COPY apps/web ./apps/web
RUN pnpm --filter @truco/web... build

FROM nginx:1.27-alpine AS runner
RUN addgroup -S -g 1001 nginx-run && adduser -S -u 1001 -G nginx-run nginx-run \
    && rm -rf /usr/share/nginx/html/*
COPY infra/docker/nginx-web.conf /etc/nginx/conf.d/default.conf
# nginx master se ejecuta como root para bindear 8080 pero el worker corre
# con usuario `nginx` sin privilegios (configuración por defecto de la imagen).
COPY --from=build --chown=nginx-run:nginx-run /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz.txt || exit 1
RUN printf 'ok' > /usr/share/nginx/html/healthz.txt
CMD ["nginx", "-g", "daemon off;"]
