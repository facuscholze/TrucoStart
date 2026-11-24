-- Capture the season at match start; human review actions use optimistic locking.
ALTER TABLE "tables"
  ADD COLUMN "competitive_season_id" uuid;
--> statement-breakpoint
ALTER TABLE "tables"
  ADD CONSTRAINT "tables_competitive_season_id_rating_seasons_id_fk"
  FOREIGN KEY ("competitive_season_id") REFERENCES "rating_seasons"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "competitive_review_cases"
  ADD COLUMN "version" integer NOT NULL DEFAULT 0;
