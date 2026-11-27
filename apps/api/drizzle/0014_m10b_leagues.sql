CREATE TABLE "league_closures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"standings" jsonb NOT NULL,
	"champion_user_id" uuid,
	"promoted_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relegated_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forfeited_matches" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"round_id" uuid,
	"round_number" integer,
	"home_user_id" uuid NOT NULL,
	"away_user_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'SCHEDULED' NOT NULL,
	"winner_user_id" uuid,
	"home_score" integer,
	"away_score" integer,
	"forfeit_reason" varchar(24),
	"match_id" uuid,
	"room_id" uuid,
	"deadline_at" timestamp with time zone,
	"reschedules_used" integer DEFAULT 0 NOT NULL,
	"no_show_user_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"resolved_from_match_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_matches_status_chk" CHECK ("league_matches"."status" IN ('SCHEDULED','READY','IN_PROGRESS','COMPLETED','FORFEITED','VOID')),
	CONSTRAINT "league_matches_forfeit_chk" CHECK ("league_matches"."forfeit_reason" IS NULL OR "league_matches"."forfeit_reason" IN ('NO_SHOW','DOUBLE_NO_SHOW','ABANDON','RESCHEDULED_EXPIRED','DISQUALIFIED')),
	CONSTRAINT "league_matches_distinct_players_chk" CHECK ("league_matches"."home_user_id" <> "league_matches"."away_user_id"),
	CONSTRAINT "league_matches_result_chk" CHECK (("league_matches"."status" IN ('SCHEDULED','READY','IN_PROGRESS','VOID')
             AND "league_matches"."winner_user_id" IS NULL AND "league_matches"."forfeit_reason" IS NULL)
          OR ("league_matches"."status" = 'COMPLETED'
             AND "league_matches"."winner_user_id" IS NOT NULL AND "league_matches"."home_score" IS NOT NULL AND "league_matches"."away_score" IS NOT NULL
             AND "league_matches"."forfeit_reason" IS NULL)
          OR ("league_matches"."status" = 'FORFEITED' AND "league_matches"."forfeit_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "league_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"from_division" varchar(16) NOT NULL,
	"to_division" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_movements_kind_chk" CHECK ("league_movements"."kind" IN ('PROMOTION','RELEGATION','TIE_AT_CUT'))
);
--> statement-breakpoint
CREATE TABLE "league_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seed" integer NOT NULL,
	"status" varchar(16) DEFAULT 'REGISTERED' NOT NULL,
	"joined_division" varchar(16) NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_participants_status_chk" CHECK ("league_participants"."status" IN ('REGISTERED','ACTIVE','WITHDRAWN','DISQUALIFIED','PROMOTED','RELEGATED'))
);
--> statement-breakpoint
CREATE TABLE "league_prize_awards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"cosmetic_id" varchar(64),
	"wallet_transaction_id" uuid,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_prize_awards_position_chk" CHECK ("league_prize_awards"."position" >= 1 AND "league_prize_awards"."position" <= 200),
	CONSTRAINT "league_prize_awards_nonempty_chk" CHECK ("league_prize_awards"."coins" > 0 OR "league_prize_awards"."cosmetic_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "league_prizes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"cosmetic_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_prizes_position_chk" CHECK ("league_prizes"."position" >= 1 AND "league_prizes"."position" <= 200),
	CONSTRAINT "league_prizes_amount_chk" CHECK ("league_prizes"."coins" >= 0 AND "league_prizes"."coins" <= 100000),
	CONSTRAINT "league_prizes_nonempty_chk" CHECK ("league_prizes"."coins" > 0 OR "league_prizes"."cosmetic_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "league_reschedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"reason" varchar(300) NOT NULL,
	"previous_deadline_at" timestamp with time zone NOT NULL,
	"new_deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_reschedules_reason_chk" CHECK (length("league_reschedules"."reason") >= 5),
	CONSTRAINT "league_reschedules_extends_chk" CHECK ("league_reschedules"."new_deadline_at" > "league_reschedules"."previous_deadline_at")
);
--> statement-breakpoint
CREATE TABLE "league_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" varchar(16) DEFAULT 'SCHEDULED' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_rounds_status_chk" CHECK ("league_rounds"."status" IN ('SCHEDULED','OPEN','CLOSED','CANCELLED')),
	CONSTRAINT "league_rounds_number_chk" CHECK ("league_rounds"."number" >= 1 AND "league_rounds"."number" <= 30),
	CONSTRAINT "league_rounds_window_chk" CHECK ("league_rounds"."deadline_at" > "league_rounds"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"mode" varchar(8) NOT NULL,
	"division" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"official" boolean DEFAULT false NOT NULL,
	"season_label" varchar(60) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"rating_season_id" uuid,
	"ruleset_id" uuid NOT NULL,
	"ruleset_code" varchar(64) NOT NULL,
	"target_score" integer NOT NULL,
	"flor_enabled" boolean DEFAULT true NOT NULL,
	"turn_timeout_ms" integer DEFAULT 25000 NOT NULL,
	"schedule_format" varchar(16) DEFAULT 'ROUNDS' NOT NULL,
	"rounds" integer DEFAULT 1 NOT NULL,
	"days_between_rounds" integer DEFAULT 7 NOT NULL,
	"round_window_hours" integer DEFAULT 72 NOT NULL,
	"max_reschedules_per_match" integer DEFAULT 2 NOT NULL,
	"reschedule_min_hours_before_deadline" integer DEFAULT 12 NOT NULL,
	"reschedule_extension_hours" integer DEFAULT 48 NOT NULL,
	"promotions" integer DEFAULT 0 NOT NULL,
	"relegations" integer DEFAULT 0 NOT NULL,
	"min_matches_to_move" integer DEFAULT 1 NOT NULL,
	"capacity" integer NOT NULL,
	"registration_closes_at" timestamp with time zone NOT NULL,
	"first_round_starts_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" varchar(500),
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_status_chk" CHECK ("leagues"."status" IN ('DRAFT','REGISTRATION','ACTIVE','CLOSING','FINISHED','CANCELLED')),
	CONSTRAINT "leagues_mode_chk" CHECK ("leagues"."mode" IN ('1v1','2v2')),
	CONSTRAINT "leagues_division_chk" CHECK ("leagues"."division" IN ('BRONCE','PLATA','ORO','PLATINO')),
	CONSTRAINT "leagues_schedule_format_chk" CHECK ("leagues"."schedule_format" IN ('ROUNDS','WINDOW')),
	CONSTRAINT "leagues_capacity_chk" CHECK ("leagues"."capacity" >= 2 AND "leagues"."capacity" <= 200),
	CONSTRAINT "leagues_target_score_chk" CHECK ("leagues"."target_score" >= 15 AND "leagues"."target_score" <= 30),
	CONSTRAINT "leagues_rounds_chk" CHECK ("leagues"."rounds" >= 1 AND "leagues"."rounds" <= 30),
	CONSTRAINT "leagues_movement_chk" CHECK ("leagues"."promotions" >= 0 AND "leagues"."promotions" <= 10 AND "leagues"."relegations" >= 0 AND "leagues"."relegations" <= 10),
	CONSTRAINT "leagues_season_chk" CHECK ("leagues"."ends_at" > "leagues"."starts_at" AND "leagues"."registration_closes_at" >= "leagues"."created_at"),
	CONSTRAINT "leagues_first_round_chk" CHECK ("leagues"."first_round_starts_at" >= "leagues"."registration_closes_at")
);
--> statement-breakpoint
ALTER TABLE "league_closures" ADD CONSTRAINT "league_closures_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_closures" ADD CONSTRAINT "league_closures_champion_user_id_users_id_fk" FOREIGN KEY ("champion_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_matches" ADD CONSTRAINT "league_matches_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_matches" ADD CONSTRAINT "league_matches_round_id_league_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."league_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_matches" ADD CONSTRAINT "league_matches_home_user_id_users_id_fk" FOREIGN KEY ("home_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_matches" ADD CONSTRAINT "league_matches_away_user_id_users_id_fk" FOREIGN KEY ("away_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_matches" ADD CONSTRAINT "league_matches_winner_user_id_users_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_matches" ADD CONSTRAINT "league_matches_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_matches" ADD CONSTRAINT "league_matches_no_show_user_id_users_id_fk" FOREIGN KEY ("no_show_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_movements" ADD CONSTRAINT "league_movements_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_movements" ADD CONSTRAINT "league_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_participants" ADD CONSTRAINT "league_participants_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_participants" ADD CONSTRAINT "league_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_prize_awards" ADD CONSTRAINT "league_prize_awards_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_prize_awards" ADD CONSTRAINT "league_prize_awards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_prizes" ADD CONSTRAINT "league_prizes_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_reschedules" ADD CONSTRAINT "league_reschedules_match_id_league_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."league_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_reschedules" ADD CONSTRAINT "league_reschedules_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_rounds" ADD CONSTRAINT "league_rounds_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_rating_season_id_rating_seasons_id_fk" FOREIGN KEY ("rating_season_id") REFERENCES "public"."rating_seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_ruleset_id_rulesets_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "league_closures_league_uniq" ON "league_closures" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "league_closures_closed_idx" ON "league_closures" USING btree ("closed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "league_matches_round_pair_uniq" ON "league_matches" USING btree ("league_id","round_number","home_user_id","away_user_id") WHERE "league_matches"."round_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "league_matches_resolved_uniq" ON "league_matches" USING btree ("league_id","resolved_from_match_id") WHERE "league_matches"."resolved_from_match_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "league_matches_league_round_idx" ON "league_matches" USING btree ("league_id","round_number");--> statement-breakpoint
CREATE INDEX "league_matches_home_idx" ON "league_matches" USING btree ("home_user_id","status");--> statement-breakpoint
CREATE INDEX "league_matches_away_idx" ON "league_matches" USING btree ("away_user_id","status");--> statement-breakpoint
CREATE INDEX "league_matches_deadline_idx" ON "league_matches" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "league_movements_user_uniq" ON "league_movements" USING btree ("league_id","user_id");--> statement-breakpoint
CREATE INDEX "league_movements_user_idx" ON "league_movements" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "league_participants_user_uniq" ON "league_participants" USING btree ("league_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "league_participants_seed_uniq" ON "league_participants" USING btree ("league_id","seed");--> statement-breakpoint
CREATE INDEX "league_participants_user_idx" ON "league_participants" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "league_prize_awards_position_uniq" ON "league_prize_awards" USING btree ("league_id","position","user_id");--> statement-breakpoint
CREATE INDEX "league_prize_awards_user_idx" ON "league_prize_awards" USING btree ("user_id","awarded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "league_prizes_position_uniq" ON "league_prizes" USING btree ("league_id","position");--> statement-breakpoint
CREATE INDEX "league_reschedules_match_idx" ON "league_reschedules" USING btree ("match_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "league_rounds_number_uniq" ON "league_rounds" USING btree ("league_id","number");--> statement-breakpoint
CREATE INDEX "league_rounds_status_starts_idx" ON "league_rounds" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "league_rounds_deadline_idx" ON "league_rounds" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_division_season_uniq" ON "leagues" USING btree ("mode","season_label","division");--> statement-breakpoint
CREATE INDEX "leagues_status_start_idx" ON "leagues" USING btree ("status","first_round_starts_at");--> statement-breakpoint
CREATE INDEX "leagues_mode_division_idx" ON "leagues" USING btree ("mode","division","status");--> statement-breakpoint
CREATE INDEX "leagues_created_by_idx" ON "leagues" USING btree ("created_by","status");