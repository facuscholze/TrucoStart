CREATE TABLE "tournament_teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"name" varchar(40) NOT NULL,
	"captain_user_id" uuid NOT NULL,
	"seed" integer,
	"seed_rating" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_teams_seed_chk" CHECK ("tournament_teams"."seed" IS NULL OR ("tournament_teams"."seed" >= 1 AND "tournament_teams"."seed" <= 64))
);
--> statement-breakpoint
DROP INDEX "tournament_awards_position_uniq";--> statement-breakpoint
ALTER TABLE "tournament_awards" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD COLUMN "home_team_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD COLUMN "away_team_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD COLUMN "winner_team_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD COLUMN "loser_team_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD COLUMN "home_present_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD COLUMN "away_present_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament_teams" ADD CONSTRAINT "tournament_teams_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_teams" ADD CONSTRAINT "tournament_teams_captain_user_id_users_id_fk" FOREIGN KEY ("captain_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_teams_name_uniq" ON "tournament_teams" USING btree ("tournament_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_teams_captain_uniq" ON "tournament_teams" USING btree ("tournament_id","captain_user_id");--> statement-breakpoint
CREATE INDEX "tournament_teams_tournament_idx" ON "tournament_teams" USING btree ("tournament_id");--> statement-breakpoint
ALTER TABLE "tournament_awards" ADD CONSTRAINT "tournament_awards_team_id_tournament_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_home_team_id_tournament_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_away_team_id_tournament_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_winner_team_id_tournament_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_loser_team_id_tournament_teams_id_fk" FOREIGN KEY ("loser_team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_team_id_tournament_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tournament_matches_home_team_idx" ON "tournament_matches" USING btree ("home_team_id");--> statement-breakpoint
CREATE INDEX "tournament_matches_away_team_idx" ON "tournament_matches" USING btree ("away_team_id");--> statement-breakpoint
CREATE INDEX "tournament_participants_team_idx" ON "tournament_participants" USING btree ("tournament_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_awards_position_uniq" ON "tournament_awards" USING btree ("tournament_id","position","user_id");