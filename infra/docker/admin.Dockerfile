# syntax=docker/dockerfile:1.7
# Panel administrativo servido por nginx (estático, sin secretos en bundle).
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
COPY apps/admin/package.json ./apps/admin/
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG VITE_API_BASE_URL
ARG VITE_CAPTCHA_SITE_KEY
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_CAPTCHA_SITE_KEY=${VITE_CAPTCHA_SITE_KEY}
# El bundle admin NUNCA se construye con VITE_ADMIN_DEMO en producción.
ENV VITE_ADMIN_DEMO=""
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
COPY apps/admin ./apps/admin
RUN pnpm --filter @truco/admin... build

FROM nginx:1.27-alpine AS runner
RUN addgroup -S -g 1001 nginx-run && adduser -S -u 1001 -G nginx-run nginx-run \
    && rm -rf /usr/share/nginx/html/*
COPY infra/docker/nginx-admin.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx-run:nginx-run /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz.txt || exit 1
RUN printf 'ok' > /usr/share/nginx/html/healthz.txt
CMD ["nginx", "-g", "daemon off;"]
