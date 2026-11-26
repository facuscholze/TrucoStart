-- M10a: los avisos de torneo son tipos de notificación social de M9a.
-- La restricción de 0007 se definió en SQL directo, así que drizzle no la conocía y
-- generaba un `ADD CONSTRAINT` que choca con la existente. Se reemplaza explícitamente
-- (idempotente: `IF EXISTS`), manteniendo el conjunto anterior y sumando los dos nuevos.
ALTER TABLE "social_notifications" DROP CONSTRAINT IF EXISTS "social_notifications_type_check";
--> statement-breakpoint
ALTER TABLE "social_notifications" ADD CONSTRAINT "social_notifications_type_check" CHECK ("social_notifications"."type" IN (
        'FRIEND_REQUEST', 'FRIEND_REQUEST_ACCEPTED', 'FRIEND_REQUEST_REJECTED',
        'TABLE_INVITATION', 'TABLE_INVITATION_ACCEPTED', 'TABLE_INVITATION_DECLINED',
        'CHALLENGE', 'CHALLENGE_ACCEPTED', 'CHALLENGE_DECLINED',
        'TOURNAMENT_ROUND_STARTED', 'TOURNAMENT_MATCH_READY'
      ));
