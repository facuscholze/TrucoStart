CREATE TABLE "tournament_awards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"cosmetic_id" varchar(64),
	"wallet_transaction_id" uuid,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"bracket" varchar(12) DEFAULT 'WINNERS' NOT NULL,
	"round" integer NOT NULL,
	"slot" integer NOT NULL,
	"home_user_id" uuid,
	"away_user_id" uuid,
	"home_seed" integer,
	"away_seed" integer,
	"status" varchar(16) DEFAULT 'SCHEDULED' NOT NULL,
	"winner_user_id" uuid,
	"loser_user_id" uuid,
	"forfeit_reason" varchar(16),
	"match_id" uuid,
	"room_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"resolved_from_match_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_matches_status_chk" CHECK ("tournament_matches"."status" IN ('SCHEDULED','READY','IN_PROGRESS','COMPLETED','FORFEITED')),
	CONSTRAINT "tournament_matches_bracket_chk" CHECK ("tournament_matches"."bracket" IN ('WINNERS','LOSERS','GRAND_FINAL'))
);
--> statement-breakpoint
CREATE TABLE "tournament_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'REGISTERED' NOT NULL,
	"seed" integer,
	"seed_rating" integer,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_in_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "tournament_participants_status_chk" CHECK ("tournament_participants"."status" IN ('REGISTERED','CHECKED_IN','NO_SHOW','WITHDRAWN','DISQUALIFIED','ELIMINATED','WINNER'))
);
--> statement-breakpoint
CREATE TABLE "tournament_prizes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"cosmetic_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_prizes_position_chk" CHECK ("tournament_prizes"."position" >= 1 AND "tournament_prizes"."position" <= 64),
	CONSTRAINT "tournament_prizes_amount_chk" CHECK ("tournament_prizes"."coins" >= 0 AND "tournament_prizes"."coins" <= 100000),
	CONSTRAINT "tournament_prizes_nonempty_chk" CHECK ("tournament_prizes"."coins" > 0 OR "tournament_prizes"."cosmetic_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"format" varchar(24) NOT NULL,
	"visibility" varchar(16) DEFAULT 'PRIVATE' NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"mode" varchar(8) NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"ruleset_code" varchar(64) NOT NULL,
	"target_score" integer NOT NULL,
	"flor_enabled" boolean DEFAULT true NOT NULL,
	"turn_timeout_ms" integer DEFAULT 25000 NOT NULL,
	"capacity" integer NOT NULL,
	"join_code" varchar(12),
	"no_show_minutes" integer DEFAULT 10 NOT NULL,
	"registration_closes_at" timestamp with time zone NOT NULL,
	"check_in_closes_at" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" varchar(500),
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_status_chk" CHECK ("tournaments"."status" IN ('DRAFT','REGISTRATION','CHECK_IN','IN_PROGRESS','FINISHED','CANCELLED')),
	CONSTRAINT "tournaments_format_chk" CHECK ("tournaments"."format" IN ('SINGLE_ELIMINATION','DOUBLE_ELIMINATION')),
	CONSTRAINT "tournaments_visibility_chk" CHECK ("tournaments"."visibility" IN ('OFFICIAL','PRIVATE')),
	CONSTRAINT "tournaments_capacity_chk" CHECK ("tournaments"."capacity" >= 2 AND "tournaments"."capacity" <= 64),
	CONSTRAINT "tournaments_target_score_chk" CHECK ("tournaments"."target_score" >= 15 AND "tournaments"."target_score" <= 30),
	CONSTRAINT "tournaments_no_show_chk" CHECK ("tournaments"."no_show_minutes" >= 1 AND "tournaments"."no_show_minutes" <= 60),
	CONSTRAINT "tournaments_join_code_chk" CHECK (("tournaments"."visibility" = 'PRIVATE' AND "tournaments"."join_code" IS NOT NULL) OR ("tournaments"."visibility" = 'OFFICIAL'))
);
--> statement-breakpoint
ALTER TABLE "tournament_awards" ADD CONSTRAINT "tournament_awards_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_awards" ADD CONSTRAINT "tournament_awards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_home_user_id_users_id_fk" FOREIGN KEY ("home_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_away_user_id_users_id_fk" FOREIGN KEY ("away_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_winner_user_id_users_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_loser_user_id_users_id_fk" FOREIGN KEY ("loser_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_prizes" ADD CONSTRAINT "tournament_prizes_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_ruleset_id_rulesets_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_awards_position_uniq" ON "tournament_awards" USING btree ("tournament_id","position");--> statement-breakpoint
CREATE INDEX "tournament_awards_user_idx" ON "tournament_awards" USING btree ("user_id","awarded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_slot_uniq" ON "tournament_matches" USING btree ("tournament_id","bracket","round","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_resolved_uniq" ON "tournament_matches" USING btree ("tournament_id","resolved_from_match_id") WHERE "tournament_matches"."resolved_from_match_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tournament_matches_tournament_round_idx" ON "tournament_matches" USING btree ("tournament_id","bracket","round");--> statement-breakpoint
CREATE INDEX "tournament_matches_user_idx" ON "tournament_matches" USING btree ("home_user_id","away_user_id");--> statement-breakpoint
CREATE INDEX "tournament_matches_deadline_idx" ON "tournament_matches" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_participants_unique" ON "tournament_participants" USING btree ("tournament_id","user_id");--> statement-breakpoint
CREATE INDEX "tournament_participants_tournament_status_idx" ON "tournament_participants" USING btree ("tournament_id","status");--> statement-breakpoint
CREATE INDEX "tournament_participants_user_idx" ON "tournament_participants" USING btree ("user_id","registered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_prizes_position_uniq" ON "tournament_prizes" USING btree ("tournament_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_join_code_uniq" ON "tournaments" USING btree ("join_code") WHERE "tournaments"."join_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tournaments_status_registration_idx" ON "tournaments" USING btree ("status","registration_closes_at");--> statement-breakpoint
CREATE INDEX "tournaments_status_checkin_idx" ON "tournaments" USING btree ("status","check_in_closes_at");--> statement-breakpoint
CREATE INDEX "tournaments_visibility_status_idx" ON "tournaments" USING btree ("visibility","status","created_at");--> statement-breakpoint
CREATE INDEX "tournaments_created_by_idx" ON "tournaments" USING btree ("created_by","status");