-- M10b: los avisos de liga son tipos de notificación social de M9a.
-- Igual que 0012: la restricción original se definió en SQL directo, así que drizzle no la
-- conoce y generaría un `ADD CONSTRAINT` que choca con la existente. Se reemplaza
-- explícitamente (idempotente: `IF EXISTS`), manteniendo el conjunto anterior y sumando los
-- tres tipos nuevos de liga: jornada abierta, partida pendiente y temporada cerrada.
ALTER TABLE "social_notifications" DROP CONSTRAINT IF EXISTS "social_notifications_type_check";
--> statement-breakpoint
ALTER TABLE "social_notifications" ADD CONSTRAINT "social_notifications_type_check" CHECK ("social_notifications"."type" IN (
        'FRIEND_REQUEST', 'FRIEND_REQUEST_ACCEPTED', 'FRIEND_REQUEST_REJECTED',
        'TABLE_INVITATION', 'TABLE_INVITATION_ACCEPTED', 'TABLE_INVITATION_DECLINED',
        'CHALLENGE', 'CHALLENGE_ACCEPTED', 'CHALLENGE_DECLINED',
        'TOURNAMENT_ROUND_STARTED', 'TOURNAMENT_MATCH_READY',
        'LEAGUE_ROUND_OPEN', 'LEAGUE_MATCH_PENDING', 'LEAGUE_SEASON_FINISHED'
      ));
