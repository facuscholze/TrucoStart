ALTER TABLE "matches" ADD COLUMN "is_practice" boolean NOT NULL DEFAULT false;--> statement-breakpoint

CREATE TABLE "progression_config" (
  "id" integer PRIMARY KEY NOT NULL DEFAULT 1,
  "human_match_xp" integer NOT NULL DEFAULT 25,
  "bot_match_xp" integer NOT NULL DEFAULT 8,
  "daily_xp_cap" integer NOT NULL DEFAULT 200,
  "bot_daily_xp_cap" integer NOT NULL DEFAULT 40,
  "daily_bonus_xp_cap" integer NOT NULL DEFAULT 100,
  "human_match_coins" integer NOT NULL DEFAULT 3,
  "bot_match_coins" integer NOT NULL DEFAULT 1,
  "daily_coin_cap" integer NOT NULL DEFAULT 40,
  "bot_daily_coin_cap" integer NOT NULL DEFAULT 10,
  "daily_coin_spend_cap" integer NOT NULL DEFAULT 100,
  "base_xp_per_level" integer NOT NULL DEFAULT 100,
  "xp_growth_per_level" integer NOT NULL DEFAULT 50,
  "mission_reward_multiplier_bp" integer NOT NULL DEFAULT 10000,
  "achievement_reward_multiplier_bp" integer NOT NULL DEFAULT 10000,
  "currency_type" varchar(24) NOT NULL DEFAULT 'VIRTUAL_COIN',
  "has_economic_value" boolean NOT NULL DEFAULT false,
  "player_transfers_enabled" boolean NOT NULL DEFAULT false,
  "money_purchases_enabled" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1,
  "updated_by" uuid,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "progression_config_singleton_chk" CHECK ("id" = 1),
  CONSTRAINT "progression_config_virtual_currency_chk" CHECK (
    "currency_type" = 'VIRTUAL_COIN' AND "has_economic_value" = false AND
    "player_transfers_enabled" = false AND "money_purchases_enabled" = false
  ),
  CONSTRAINT "progression_config_nonnegative_rewards_chk" CHECK (
    "human_match_xp" >= 0 AND "bot_match_xp" >= 0 AND "daily_xp_cap" >= 0 AND
    "bot_daily_xp_cap" >= 0 AND "daily_bonus_xp_cap" >= 0 AND "human_match_coins" >= 0 AND
    "bot_match_coins" >= 0 AND "daily_coin_cap" >= 0 AND "bot_daily_coin_cap" >= 0 AND
    "daily_coin_spend_cap" >= 0 AND "base_xp_per_level" > 0 AND "xp_growth_per_level" >= 0
  ),
  CONSTRAINT "progression_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by")
    REFERENCES "users"("id") ON DELETE SET NULL
);--> statement-breakpoint
INSERT INTO "progression_config" ("id") VALUES (1);--> statement-breakpoint

CREATE TABLE "achievement_catalog" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "title_key" varchar(120) NOT NULL,
  "description_key" varchar(160) NOT NULL,
  "icon" varchar(48) NOT NULL,
  "condition" jsonb NOT NULL,
  "reward_xp" integer NOT NULL DEFAULT 0,
  "reward_coins" integer NOT NULL DEFAULT 0,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "achievement_catalog_rewards_chk" CHECK ("reward_xp" >= 0 AND "reward_coins" >= 0)
);--> statement-breakpoint
CREATE INDEX "achievement_catalog_enabled_idx" ON "achievement_catalog" USING btree ("enabled", "id");--> statement-breakpoint

CREATE TABLE "user_achievements" (
  "user_id" uuid NOT NULL,
  "achievement_id" varchar(64) NOT NULL,
  "progress" integer NOT NULL DEFAULT 0,
  "unlocked_at" timestamp with time zone,
  "source_match_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_achievements_pk" PRIMARY KEY ("user_id", "achievement_id"),
  CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_achievements_achievement_id_achievement_catalog_id_fk" FOREIGN KEY ("achievement_id")
    REFERENCES "achievement_catalog"("id") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX "user_achievements_user_unlocked_idx" ON "user_achievements" USING btree ("user_id", "unlocked_at");--> statement-breakpoint

CREATE TABLE "quest_templates" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "period" varchar(8) NOT NULL,
  "title_key" varchar(120) NOT NULL,
  "description_key" varchar(160) NOT NULL,
  "condition" jsonb NOT NULL,
  "reward_xp" integer NOT NULL DEFAULT 0,
  "reward_coins" integer NOT NULL DEFAULT 0,
  "always_assign" boolean NOT NULL DEFAULT false,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "quest_templates_period_chk" CHECK ("period" IN ('DAILY', 'WEEKLY')),
  CONSTRAINT "quest_templates_rewards_chk" CHECK ("reward_xp" >= 0 AND "reward_coins" >= 0)
);--> statement-breakpoint
CREATE INDEX "quest_templates_period_enabled_idx" ON "quest_templates" USING btree ("period", "enabled");--> statement-breakpoint

CREATE TABLE "user_quests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "template_id" varchar(64) NOT NULL,
  "period" varchar(8) NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "title_key" varchar(120) NOT NULL,
  "description_key" varchar(160) NOT NULL,
  "condition" jsonb NOT NULL,
  "target" integer NOT NULL,
  "reward_xp" integer NOT NULL,
  "reward_coins" integer NOT NULL,
  "progress" integer NOT NULL DEFAULT 0,
  "completed_at" timestamp with time zone,
  "claimed_at" timestamp with time zone,
  "version" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_quests_user_id_users_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_quests_template_id_quest_templates_id_fk" FOREIGN KEY ("template_id")
    REFERENCES "quest_templates"("id") ON DELETE RESTRICT,
  CONSTRAINT "user_quests_assignment_uniq" UNIQUE ("user_id", "template_id", "period_start"),
  CONSTRAINT "user_quests_progress_chk" CHECK ("target" > 0 AND "progress" >= 0),
  CONSTRAINT "user_quests_rewards_chk" CHECK ("reward_xp" >= 0 AND "reward_coins" >= 0)
);--> statement-breakpoint
CREATE INDEX "user_quests_user_period_idx" ON "user_quests" USING btree ("user_id", "period", "period_start");--> statement-breakpoint

CREATE TABLE "progression_xp_entries" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "source_kind" varchar(24) NOT NULL,
  "source_id" varchar(160) NOT NULL,
  "idempotency_key" varchar(192) NOT NULL,
  "cap_class" varchar(16) NOT NULL,
  "xp_amount" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "progression_xp_entries_user_id_users_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "progression_xp_entries_idempotency_uniq" UNIQUE ("user_id", "idempotency_key"),
  CONSTRAINT "progression_xp_entries_nonnegative_chk" CHECK ("xp_amount" >= 0),
  CONSTRAINT "progression_xp_entries_cap_class_chk" CHECK ("cap_class" IN ('HUMAN_MATCH', 'BOT_MATCH', 'BONUS'))
);--> statement-breakpoint
CREATE INDEX "progression_xp_entries_daily_cap_idx" ON "progression_xp_entries" USING btree ("user_id", "cap_class", "created_at");--> statement-breakpoint

CREATE TABLE "wallet_accounts" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "currency_type" varchar(24) NOT NULL DEFAULT 'VIRTUAL_COIN',
  "has_economic_value" boolean NOT NULL DEFAULT false,
  "player_transfers_enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "wallet_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "wallet_accounts_virtual_only_chk" CHECK (
    "currency_type" = 'VIRTUAL_COIN' AND "has_economic_value" = false AND "player_transfers_enabled" = false
  )
);--> statement-breakpoint

CREATE TABLE "wallet_transactions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "amount" integer NOT NULL,
  "kind" varchar(24) NOT NULL,
  "idempotency_key" varchar(192) NOT NULL,
  "reference_type" varchar(32) NOT NULL,
  "reference_id" varchar(160) NOT NULL,
  "reverses_transaction_id" uuid,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "wallet_transactions_reverses_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("reverses_transaction_id")
    REFERENCES "wallet_transactions"("id") ON DELETE RESTRICT,
  CONSTRAINT "wallet_transactions_idempotency_uniq" UNIQUE ("user_id", "idempotency_key"),
  CONSTRAINT "wallet_transactions_nonzero_amount_chk" CHECK ("amount" <> 0),
  CONSTRAINT "wallet_transactions_kind_amount_chk" CHECK (
    ("kind" IN ('MATCH_REWARD', 'MISSION_REWARD', 'ACHIEVEMENT_REWARD') AND "amount" > 0) OR
    ("kind" IN ('COSMETIC_REDEEM', 'ADMIN_REVERSAL') AND "amount" < 0)
  ),
  CONSTRAINT "wallet_transactions_reversal_kind_chk" CHECK (
    ("kind" = 'ADMIN_REVERSAL') = ("reverses_transaction_id" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_single_reversal_uniq" ON "wallet_transactions" USING btree ("reverses_transaction_id") WHERE "reverses_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "wallet_transactions_user_created_idx" ON "wallet_transactions" USING btree ("user_id", "created_at");--> statement-breakpoint
CREATE INDEX "wallet_transactions_user_kind_created_idx" ON "wallet_transactions" USING btree ("user_id", "kind", "created_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION wallet_transactions_guard_insert() RETURNS trigger AS $$
DECLARE
  current_total bigint;
  original_owner uuid;
  original_amount integer;
BEGIN
  PERFORM 1 FROM "wallet_accounts" WHERE "user_id" = NEW."user_id" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Falta la cuenta de moneda virtual del usuario' USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(SUM("amount"), 0) INTO current_total
  FROM "wallet_transactions" WHERE "user_id" = NEW."user_id";
  IF current_total + NEW."amount" < 0 THEN
    RAISE EXCEPTION 'El libro mayor no permite un saldo negativo' USING ERRCODE = '23514';
  END IF;

  IF NEW."kind" = 'ADMIN_REVERSAL' THEN
    SELECT "user_id", "amount" INTO original_owner, original_amount
    FROM "wallet_transactions" WHERE "id" = NEW."reverses_transaction_id" FOR UPDATE;
    IF NOT FOUND OR original_owner <> NEW."user_id" OR original_amount <= 0 OR NEW."amount" <> -original_amount THEN
      RAISE EXCEPTION 'La compensación debe revertir íntegramente un crédito del mismo usuario' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "wallet_transactions" WHERE "reverses_transaction_id" = NEW."reverses_transaction_id"
    ) THEN
      RAISE EXCEPTION 'El asiento ya fue compensado' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "wallet_transactions_guard_insert_trigger"
  BEFORE INSERT ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION wallet_transactions_guard_insert();--> statement-breakpoint

CREATE OR REPLACE FUNCTION wallet_transactions_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet_transactions es inmutable: no se permite % sobre un asiento', TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "wallet_transactions_no_update"
  BEFORE UPDATE ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION wallet_transactions_block_mutation();--> statement-breakpoint
CREATE TRIGGER "wallet_transactions_no_delete"
  BEFORE DELETE ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION wallet_transactions_block_mutation();--> statement-breakpoint

CREATE TABLE "cosmetic_catalog" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "name_key" varchar(120) NOT NULL,
  "description_key" varchar(160) NOT NULL,
  "category" varchar(32) NOT NULL,
  "price_coins" integer NOT NULL,
  "icon" varchar(48) NOT NULL,
  "affects_rules" boolean NOT NULL DEFAULT false,
  "affects_matchmaking" boolean NOT NULL DEFAULT false,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cosmetic_catalog_cosmetic_only_chk" CHECK ("affects_rules" = false AND "affects_matchmaking" = false),
  CONSTRAINT "cosmetic_catalog_price_chk" CHECK ("price_coins" > 0)
);--> statement-breakpoint
CREATE INDEX "cosmetic_catalog_enabled_price_idx" ON "cosmetic_catalog" USING btree ("enabled", "price_coins");--> statement-breakpoint

CREATE TABLE "user_cosmetics" (
  "user_id" uuid NOT NULL,
  "cosmetic_id" varchar(64) NOT NULL,
  "transaction_id" uuid NOT NULL,
  "acquired_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_cosmetics_pk" PRIMARY KEY ("user_id", "cosmetic_id"),
  CONSTRAINT "user_cosmetics_transaction_uniq" UNIQUE ("transaction_id"),
  CONSTRAINT "user_cosmetics_user_id_users_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_cosmetics_cosmetic_id_cosmetic_catalog_id_fk" FOREIGN KEY ("cosmetic_id")
    REFERENCES "cosmetic_catalog"("id") ON DELETE RESTRICT,
  CONSTRAINT "user_cosmetics_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("transaction_id")
    REFERENCES "wallet_transactions"("id") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX "user_cosmetics_user_acquired_idx" ON "user_cosmetics" USING btree ("user_id", "acquired_at");--> statement-breakpoint

CREATE TABLE "progression_notifications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" varchar(32) NOT NULL,
  "idempotency_key" varchar(192) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "read_at" timestamp with time zone,
  CONSTRAINT "progression_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "progression_notifications_idempotency_uniq" UNIQUE ("user_id", "idempotency_key")
);--> statement-breakpoint
CREATE INDEX "progression_notifications_user_created_idx" ON "progression_notifications" USING btree ("user_id", "created_at");--> statement-breakpoint

INSERT INTO "achievement_catalog"
  ("id", "title_key", "description_key", "icon", "condition", "reward_xp", "reward_coins")
VALUES
  ('first_match', 'progression.achievements.firstMatch.title', 'progression.achievements.firstMatch.description', 'cards', '{"kind":"MATCHES_COMPLETED","target":1}', 10, 3),
  ('clean_table', 'progression.achievements.cleanTable.title', 'progression.achievements.cleanTable.description', 'shield', '{"kind":"CLEAN_MATCHES","target":5}', 30, 8),
  ('tutorial_graduate', 'progression.achievements.tutorialGraduate.title', 'progression.achievements.tutorialGraduate.description', 'book', '{"kind":"TUTORIAL_LESSONS","target":6}', 15, 4),
  ('card_slinger', 'progression.achievements.cardSlinger.title', 'progression.achievements.cardSlinger.description', 'spade', '{"kind":"CARD_PLAYS","target":40,"eventType":"game.cardPlayed"}', 20, 5);--> statement-breakpoint

INSERT INTO "quest_templates"
  ("id", "period", "title_key", "description_key", "condition", "reward_xp", "reward_coins", "always_assign")
VALUES
  ('daily_play_match', 'DAILY', 'progression.missions.dailyPlay.title', 'progression.missions.dailyPlay.description', '{"kind":"MATCHES_COMPLETED","target":1}', 10, 3, true),
  ('daily_win_match', 'DAILY', 'progression.missions.dailyWin.title', 'progression.missions.dailyWin.description', '{"kind":"WINS","target":1}', 12, 4, false),
  ('daily_card_plays', 'DAILY', 'progression.missions.dailyCards.title', 'progression.missions.dailyCards.description', '{"kind":"CARD_PLAYS","target":6,"eventType":"game.cardPlayed"}', 8, 2, false),
  ('daily_clean_match', 'DAILY', 'progression.missions.dailyClean.title', 'progression.missions.dailyClean.description', '{"kind":"CLEAN_MATCHES","target":1}', 10, 3, false),
  ('weekly_play_three', 'WEEKLY', 'progression.missions.weeklyPlay.title', 'progression.missions.weeklyPlay.description', '{"kind":"MATCHES_COMPLETED","target":3}', 35, 10, true),
  ('weekly_win_three', 'WEEKLY', 'progression.missions.weeklyWins.title', 'progression.missions.weeklyWins.description', '{"kind":"WINS","target":3}', 40, 12, false),
  ('weekly_card_plays', 'WEEKLY', 'progression.missions.weeklyCards.title', 'progression.missions.weeklyCards.description', '{"kind":"CARD_PLAYS","target":30,"eventType":"game.cardPlayed"}', 30, 9, false),
  ('weekly_clean_five', 'WEEKLY', 'progression.missions.weeklyClean.title', 'progression.missions.weeklyClean.description', '{"kind":"CLEAN_MATCHES","target":5}', 45, 14, false);--> statement-breakpoint

INSERT INTO "cosmetic_catalog"
  ("id", "name_key", "description_key", "category", "price_coins", "icon")
VALUES
  ('frame_sunrise', 'progression.cosmetics.sunrise.name', 'progression.cosmetics.sunrise.description', 'AVATAR_FRAME', 20, 'sunrise'),
  ('card_back_flor', 'progression.cosmetics.florBack.name', 'progression.cosmetics.florBack.description', 'CARD_BACK', 35, 'flor');
