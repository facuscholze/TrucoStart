-- M7: cambio de apodo forzado por moderación.
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "nickname_must_change" boolean DEFAULT false NOT NULL;
