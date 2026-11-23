-- M9a — social graph, in-app notifications, single-use invitations and
-- verifiable match-history queries. The derived stats remain sourced from
-- match_events; no counters are stored as an unverifiable cache.
ALTER TABLE "matches"
  ADD COLUMN "has_bots" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "profiles"
SET "settings" = jsonb_set(
  jsonb_set(
    "settings",
    '{historyVisibility}',
    coalesce("settings" -> 'historyVisibility', '"FRIENDS"'::jsonb),
    true
  ),
  '{presenceVisibility}',
  coalesce("settings" -> 'presenceVisibility', '"FRIENDS"'::jsonb),
  true
)
WHERE NOT ("settings" ? 'historyVisibility') OR NOT ("settings" ? 'presenceVisibility');
--> statement-breakpoint
CREATE TABLE "friendships" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_low" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_high" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" varchar(16) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "friendships_not_self_check" CHECK ("user_low" <> "user_high"),
  CONSTRAINT "friendships_canonical_pair_check" CHECK ("user_low" < "user_high"),
  CONSTRAINT "friendships_requester_member_check" CHECK ("requested_by" = "user_low" OR "requested_by" = "user_high"),
  CONSTRAINT "friendships_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'REMOVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_active_pair_uniq"
  ON "friendships" USING btree ("user_low", "user_high")
  WHERE "status" IN ('PENDING', 'ACCEPTED');
--> statement-breakpoint
CREATE INDEX "friendships_low_status_created_idx"
  ON "friendships" USING btree ("user_low", "status", "created_at" DESC)
  WHERE "status" IN ('PENDING', 'ACCEPTED');
--> statement-breakpoint
CREATE INDEX "friendships_high_status_created_idx"
  ON "friendships" USING btree ("user_high", "status", "created_at" DESC)
  WHERE "status" IN ('PENDING', 'ACCEPTED');
--> statement-breakpoint
CREATE INDEX "friendships_requested_by_status_idx"
  ON "friendships" USING btree ("requested_by", "status");
--> statement-breakpoint
CREATE TABLE "user_blocks" (
  "blocker_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "blocked_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_blocks_not_self_check" CHECK ("blocker_id" <> "blocked_id"),
  CONSTRAINT "user_blocks_pk" PRIMARY KEY ("blocker_id", "blocked_id")
);
--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx"
  ON "user_blocks" USING btree ("blocked_id", "blocker_id");
--> statement-breakpoint
CREATE TABLE "social_invitations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "kind" varchar(16) NOT NULL,
  "status" varchar(16) NOT NULL,
  "sender_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "recipient_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "table_id" uuid REFERENCES "tables"("id") ON DELETE SET NULL,
  "mode" varchar(8),
  "ruleset_code" varchar(64),
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "social_invitations_not_self_check" CHECK ("sender_id" <> "recipient_id"),
  CONSTRAINT "social_invitations_kind_check" CHECK ("kind" IN ('TABLE', 'CHALLENGE')),
  CONSTRAINT "social_invitations_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')),
  CONSTRAINT "social_invitations_payload_check" CHECK (
    ("kind" = 'TABLE' AND "table_id" IS NOT NULL AND "mode" IS NULL AND "ruleset_code" IS NULL)
    OR
    ("kind" = 'CHALLENGE' AND "table_id" IS NULL AND "mode" = '1v1' AND "ruleset_code" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "social_invitations_pending_pair_uniq"
  ON "social_invitations" USING btree (
    "kind", "sender_id", "recipient_id",
    (coalesce("table_id", '00000000-0000-0000-0000-000000000000'::uuid))
  ) WHERE "status" = 'PENDING';
--> statement-breakpoint
CREATE INDEX "social_invitations_recipient_pending_idx"
  ON "social_invitations" USING btree ("recipient_id", "expires_at", "created_at" DESC)
  WHERE "status" = 'PENDING';
--> statement-breakpoint
CREATE INDEX "social_invitations_sender_pending_idx"
  ON "social_invitations" USING btree ("sender_id", "expires_at", "created_at" DESC)
  WHERE "status" = 'PENDING';
--> statement-breakpoint
CREATE TABLE "social_notifications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "type" varchar(40) NOT NULL,
  "reference_id" uuid,
  "table_id" uuid REFERENCES "tables"("id") ON DELETE SET NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "read_at" timestamp with time zone,
  CONSTRAINT "social_notifications_type_check" CHECK (
    "type" IN (
      'FRIEND_REQUEST', 'FRIEND_REQUEST_ACCEPTED', 'FRIEND_REQUEST_REJECTED',
      'TABLE_INVITATION', 'TABLE_INVITATION_ACCEPTED', 'TABLE_INVITATION_DECLINED', 'CHALLENGE',
      'CHALLENGE_ACCEPTED', 'CHALLENGE_DECLINED'
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "social_notifications_reference_type_uniq"
  ON "social_notifications" USING btree ("user_id", "type", "reference_id")
  WHERE "reference_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "social_notifications_user_created_idx"
  ON "social_notifications" USING btree ("user_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "social_notifications_user_unread_idx"
  ON "social_notifications" USING btree ("user_id", "created_at" DESC, "id" DESC)
  WHERE "read_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "match_events_match_type_seq_idx"
  ON "match_events" USING btree ("match_id", "type", "seq");
--> statement-breakpoint
CREATE INDEX "matches_mode_ended_idx"
  ON "matches" USING btree ("mode", "ended_at" DESC, "id" DESC);
