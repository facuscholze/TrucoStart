-- M8d: constancia de aceptación de los documentos legales.
--
-- Se guarda QUÉ versión de los Términos y de la Política de Privacidad aceptó la
-- persona, CUÁNDO y con qué edad mínima configurada regía, para poder demostrar
-- el consentimiento (Ley 25.326, art. 5: el consentimiento debe ser expreso).
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_version" varchar(64);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privacy_version" varchar(64);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "legal_accepted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "legal_min_age" integer;
