-- M7: moderación (reportes, sanciones) y panel administrativo (sesiones, 2FA, auditoría inmutable).

--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "reports" ADD COLUMN "reason_code" varchar(32) DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "details" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "dedupe_key" varchar(64);--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "event_log_ref" jsonb;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "claimed_by" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_status_idx" ON "reports" USING btree ("target_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_dedupe_open_uniq" ON "reports" USING btree ("dedupe_key") WHERE "reports"."status" IN ('OPEN','IN_REVIEW');--> statement-breakpoint

ALTER TABLE "sanctions" ADD COLUMN "report_id" uuid;--> statement-breakpoint
ALTER TABLE "sanctions" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sanctions_user_created_idx" ON "sanctions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sanctions_expires_idx" ON "sanctions" USING btree ("expires_at");--> statement-breakpoint

ALTER TABLE "audit_logs" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "admin_session_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "admin_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL UNIQUE,
	"totp_verified_at" timestamp with time zone NOT NULL,
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_sessions_user_idx" ON "admin_sessions" USING btree ("user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "admin_two_factor" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_encrypted" text NOT NULL,
	"recovery_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_step" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_two_factor" ADD CONSTRAINT "admin_two_factor_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- audit_logs es un registro inmutable: la base rechaza UPDATE y DELETE incluso desde SQL directo.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es inmutable: no se permite % sobre un registro de auditoría', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_logs_no_update ON "audit_logs";--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_no_delete ON "audit_logs";--> statement-breakpoint
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
