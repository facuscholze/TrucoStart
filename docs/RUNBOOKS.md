# Runbooks Operativos (`RUNBOOKS.md`)

> **Estado:** Guía inicial de entorno local creada en **M0**. Procedimientos completos de despliegue sin downtime, drenaje del `game-server`, rotación de claves y restauración de backups cifrados se completan en **M8** (`STATE-08`).

## Desarrollo local rápido

1. Copiar configuración base:
   ```bash
   cp .env.example .env
   ```
2. Levantar servicios de infraestructura (PostgreSQL 16 + Redis 7):
   ```bash
   docker compose up -d
   ```
3. Instalar dependencias y levantar aplicaciones:
   ```bash
   pnpm install
   pnpm dev
   ```
4. Verificar salud de API:
   ```bash
   curl -fsS http://localhost:3001/v1/health
   ```
