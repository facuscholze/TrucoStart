CREATE TABLE "table_seats" (
	"table_id" uuid NOT NULL,
	"seat" integer NOT NULL,
	"team" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"nickname" varchar(32) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "table_seats_table_id_seat_pk" PRIMARY KEY("table_id","seat")
);
--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "ruleset_code" varchar(64) DEFAULT 'ar-standard-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "target_score" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "flor_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "turn_timeout_ms" integer DEFAULT 25000 NOT NULL;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "closed_reason" varchar(32);--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "table_seats" ADD CONSTRAINT "table_seats_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_seats" ADD CONSTRAINT "table_seats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "table_seats_table_user_uniq" ON "table_seats" USING btree ("table_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "table_seats_one_active_per_user_uniq" ON "table_seats" USING btree ("user_id") WHERE "table_seats"."is_active" = true;--> statement-breakpoint
CREATE INDEX "tables_status_expires_idx" ON "tables" USING btree ("status","expires_at");