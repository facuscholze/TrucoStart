-- Configuración inicial idempotente para PostgreSQL 16 (desarrollo local)
ALTER DATABASE truco_dev SET timezone TO 'UTC';
CREATE EXTENSION IF NOT EXISTS citext;
