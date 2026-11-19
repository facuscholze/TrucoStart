-- M8b: índices faltantes para consultas críticas de lobby, historial, estadísticas,
-- moderación y barridos de expiración. Añadidos después de perfilar con EXPLAIN sobre
-- la carga de trabajo esperada (lobby público, perfil/historial paginado, estadísticas
-- del jugador, barrido de salas inactivas).

-- Historial de partidas de un jugador ordenado por started_at DESC (cursor por UUID v7
-- que es monotónico en el tiempo). El índice compuesto evita ordenar y permite el
-- filtrado por userId+matchId del cursor.
CREATE INDEX IF NOT EXISTS "match_players_user_started_idx"
  ON "match_players" USING btree ("user_id", "match_id" DESC);
--> statement-breakpoint
-- Eventos de una partida para reconstrucción de replay (seq ASC es el orden natural).
CREATE INDEX IF NOT EXISTS "match_events_match_seq_idx"
  ON "match_events" USING btree ("match_id", "seq");
--> statement-breakpoint
-- El barrido de salas expiradas filtra por status y compara updated_at/expires_at.
-- El índice existente (status, expires_at) sirve para WAITING pero no cubre el caso
-- IN_GAME + updated_at (partidas zombi). Se agrega uno específico.
CREATE INDEX IF NOT EXISTS "tables_status_updated_idx"
  ON "tables" USING btree ("status", "updated_at");
--> statement-breakpoint
-- Lobby público: el listado filtra por (visibility, status IN (..), opcionalmente
-- mode/ruleset/flor) y ordena por created_at DESC. El índice compuesto permite
-- Index Scan + ordenamiento por el índice (avoid sort).
CREATE INDEX IF NOT EXISTS "tables_lobby_listing_idx"
  ON "tables" USING btree ("visibility", "status", "mode", "created_at" DESC);
--> statement-breakpoint
-- Asientos activos por mesa (usados para construir el snapshot de lobby).
CREATE INDEX IF NOT EXISTS "table_seats_table_active_idx"
  ON "table_seats" USING btree ("table_id") WHERE "is_active" = true;
--> statement-breakpoint
-- Sanciones activas de un usuario (la moderación efectiva en el game-server).
CREATE INDEX IF NOT EXISTS "sanctions_user_active_idx"
  ON "sanctions" USING btree ("user_id", "expires_at") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
-- Reportes asignados a un moderador (vista de cola).
CREATE INDEX IF NOT EXISTS "reports_claimed_status_idx"
  ON "reports" USING btree ("claimed_by", "status");
--> statement-breakpoint
-- Sesiones activas de un usuario (listado en /ajustes).
CREATE INDEX IF NOT EXISTS "sessions_user_active_idx"
  ON "sessions" USING btree ("user_id", "last_used_at" DESC) WHERE "revoked_at" IS NULL;
--> statement-breakpoint
-- Tokens de autenticación por propósito activos (recuperación de contraseña).
CREATE INDEX IF NOT EXISTS "auth_tokens_user_purpose_active_idx"
  ON "auth_tokens" USING btree ("user_id", "purpose", "expires_at") WHERE "consumed_at" IS NULL;
--> statement-breakpoint
-- Auditoría paginada por fecha (panel admin). `audit_logs_created_idx` ya existe
-- desde la migración 0003 (moderación); aquí agregamos el compuesto por (created_at
-- DESC, action) que evita ordenar en el listado con filtros por tipo de acción.
CREATE INDEX IF NOT EXISTS "audit_logs_created_action_idx"
  ON "audit_logs" USING btree ("created_at" DESC, "action");
