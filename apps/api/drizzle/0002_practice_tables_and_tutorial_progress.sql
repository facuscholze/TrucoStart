ALTER TABLE "tables" ADD COLUMN "is_practice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "tutorial_progress" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"completed_lessons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tutorial_progress" ADD CONSTRAINT "tutorial_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
