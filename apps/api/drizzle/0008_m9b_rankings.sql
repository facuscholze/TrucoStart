-- M9b — competitive matchmaking, Glicko-2 seasons, ranking projections and human review queue.
ALTER TABLE "tables"
  ADD COLUMN "is_competitive" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "matches"
  ADD COLUMN "is_competitive" boolean NOT NULL DEFAULT false,
  ADD COLUMN "season_id" uuid;
--> statement-breakpoint
ALTER TABLE "match_players"
  ALTER COLUMN "rating_delta" TYPE double precision USING "rating_delta"::double precision;
--> statement-breakpoint
CREATE TABLE "rating_seasons" (
  "id" uuid PRIMARY KEY NOT NULL,
  "season_number" integer NOT NULL UNIQUE,
  "label" varchar(80) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'ACTIVE',
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rating_seasons_status_check" CHECK ("status" IN ('ACTIVE', 'CLOSED')),
  CONSTRAINT "rating_seasons_time_check" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rating_seasons_single_active_uniq"
  ON "rating_seasons" ("status") WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX "rating_seasons_status_ends_idx" ON "rating_seasons" ("status", "ends_at");
--> statement-breakpoint
ALTER TABLE "matches"
  ADD CONSTRAINT "matches_season_id_rating_seasons_id_fk"
  FOREIGN KEY ("season_id") REFERENCES "rating_seasons"("id") ON DELETE SET NULL;
--> statement-breakpoint
INSERT INTO "rating_seasons" (
  "id", "season_number", "label", "status", "starts_at", "ends_at", "created_at", "updated_at"
) VALUES (
  '01900000-0000-7000-8000-000000000001', 1, 'Temporada 1', 'ACTIVE', now(), now() + interval '90 days', now(), now()
);
--> statement-breakpoint
CREATE TABLE "rating_profiles" (
  "season_id" uuid NOT NULL REFERENCES "rating_seasons"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "mode" varchar(8) NOT NULL CHECK ("mode" IN ('1v1', '2v2')),
  "rating" double precision NOT NULL DEFAULT 1500 CHECK ("rating" >= 0 AND "rating" < 'Infinity'::double precision),
  "deviation" double precision NOT NULL DEFAULT 350 CHECK ("deviation" BETWEEN 30 AND 350),
  "volatility" double precision NOT NULL DEFAULT 0.06 CHECK ("volatility" > 0 AND "volatility" < 'Infinity'::double precision),
  "matches_played" integer NOT NULL DEFAULT 0 CHECK ("matches_played" >= 0),
  "opponents_count" integer NOT NULL DEFAULT 0 CHECK ("opponents_count" >= 0),
  "wins" integer NOT NULL DEFAULT 0,
  "losses" integer NOT NULL DEFAULT 0,
  "abandons" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rating_profiles_pk" PRIMARY KEY ("season_id", "user_id", "mode")
);
--> statement-breakpoint
CREATE INDEX "rating_profiles_mode_rank_idx" ON "rating_profiles" ("season_id", "mode", "rating" DESC);
--> statement-breakpoint
CREATE INDEX "rating_profiles_user_idx" ON "rating_profiles" ("user_id", "season_id");
--> statement-breakpoint
CREATE TABLE "rating_rivalries" (
  "season_id" uuid NOT NULL REFERENCES "rating_seasons"("id") ON DELETE CASCADE,
  "mode" varchar(8) NOT NULL CHECK ("mode" IN ('1v1', '2v2')),
  "player_low" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "player_high" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "matches_played" integer NOT NULL DEFAULT 0 CHECK ("matches_played" >= 0),
  "short_matches" integer NOT NULL DEFAULT 0 CHECK ("short_matches" >= 0),
  "abandon_matches" integer NOT NULL DEFAULT 0 CHECK ("abandon_matches" >= 0),
  "player_low_wins" integer NOT NULL DEFAULT 0,
  "player_high_wins" integer NOT NULL DEFAULT 0,
  "first_played_at" timestamp with time zone NOT NULL,
  "last_played_at" timestamp with time zone NOT NULL,
  CONSTRAINT "rating_rivalries_pk" PRIMARY KEY ("season_id", "mode", "player_low", "player_high"),
  CONSTRAINT "rating_rivalries_canonical_pair_check" CHECK ("player_low" < "player_high")
);
--> statement-breakpoint
CREATE INDEX "rating_rivalries_low_count_idx" ON "rating_rivalries" ("season_id", "mode", "player_low", "matches_played");
--> statement-breakpoint
CREATE INDEX "rating_rivalries_high_count_idx" ON "rating_rivalries" ("season_id", "mode", "player_high", "matches_played");
--> statement-breakpoint
CREATE TABLE "rating_period_stats" (
  "season_id" uuid NOT NULL REFERENCES "rating_seasons"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "mode" varchar(8) NOT NULL CHECK ("mode" IN ('1v1', '2v2')),
  "period_type" varchar(8) NOT NULL CHECK ("period_type" IN ('WEEK', 'MONTH')),
  "period_start" timestamp with time zone NOT NULL,
  "rating_points" double precision NOT NULL DEFAULT 0,
  "matches_played" integer NOT NULL DEFAULT 0 CHECK ("matches_played" >= 0),
  "opponent_ids" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("opponent_ids") = 'array'),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rating_period_stats_pk" PRIMARY KEY ("season_id", "user_id", "mode", "period_type", "period_start")
);
--> statement-breakpoint
CREATE INDEX "rating_period_stats_rank_idx"
  ON "rating_period_stats" ("season_id", "mode", "period_type", "period_start", "rating_points" DESC);
--> statement-breakpoint
CREATE TABLE "rating_jobs" (
  "match_id" uuid PRIMARY KEY REFERENCES "matches"("id") ON DELETE CASCADE,
  "season_id" uuid NOT NULL REFERENCES "rating_seasons"("id") ON DELETE CASCADE,
  "processed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_redis_outbox" (
  "match_id" uuid PRIMARY KEY REFERENCES "matches"("id") ON DELETE CASCADE,
  "season_id" uuid NOT NULL REFERENCES "rating_seasons"("id") ON DELETE CASCADE,
  "payload" jsonb NOT NULL,
  "projected_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "rating_redis_outbox_pending_idx"
  ON "rating_redis_outbox" ("created_at") WHERE "projected_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "rating_season_snapshots" (
  "season_id" uuid NOT NULL REFERENCES "rating_seasons"("id") ON DELETE CASCADE,
  "mode" varchar(8) NOT NULL CHECK ("mode" IN ('1v1', '2v2')),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "position" integer NOT NULL CHECK ("position" > 0),
  "rating" double precision NOT NULL CHECK ("rating" >= 0 AND "rating" < 'Infinity'::double precision),
  "deviation" double precision NOT NULL CHECK ("deviation" BETWEEN 30 AND 350),
  "matches_played" integer NOT NULL,
  "opponents_count" integer NOT NULL,
  "wins" integer NOT NULL,
  "division" varchar(16) NOT NULL,
  "frozen_at" timestamp with time zone NOT NULL,
  CONSTRAINT "rating_season_snapshots_pk" PRIMARY KEY ("season_id", "mode", "user_id"),
  CONSTRAINT "rating_season_snapshots_rank_uniq" UNIQUE ("season_id", "mode", "position")
);
--> statement-breakpoint
CREATE INDEX "rating_season_snapshots_user_idx" ON "rating_season_snapshots" ("user_id", "season_id");
--> statement-breakpoint
CREATE TABLE "rating_season_audits" (
  "season_id" uuid PRIMARY KEY REFERENCES "rating_seasons"("id") ON DELETE CASCADE,
  "next_season_id" uuid NOT NULL REFERENCES "rating_seasons"("id") ON DELETE RESTRICT,
  "snapshot_count" integer NOT NULL CHECK ("snapshot_count" >= 0),
  "reset_strategy" varchar(80) NOT NULL,
  "closed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitive_review_cases" (
  "id" uuid PRIMARY KEY NOT NULL,
  "fingerprint" varchar(160) NOT NULL UNIQUE,
  "status" varchar(16) NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'IN_REVIEW', 'RESOLVED')),
  "severity" varchar(8) NOT NULL CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH')),
  "signals" jsonb NOT NULL CHECK (jsonb_typeof("signals") = 'array'),
  "user_ids" uuid[] NOT NULL,
  "match_ids" uuid[] NOT NULL,
  "evidence" jsonb NOT NULL,
  "claimed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "claimed_at" timestamp with time zone,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamp with time zone,
  "resolution_note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "competitive_review_cases_status_created_idx"
  ON "competitive_review_cases" ("status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "competitive_review_cases_claimed_idx"
  ON "competitive_review_cases" ("claimed_by", "status");
