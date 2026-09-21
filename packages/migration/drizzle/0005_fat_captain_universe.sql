CREATE TABLE "oidc_adapter_state" (
  "kind" text NOT NULL,
  "id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "uid" text,
  "user_code" text,
  "grant_id" text,
  "not_after" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "oidc_adapter_state_pk" PRIMARY KEY ("kind","id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oidc_adapter_state_uid_idx" ON "oidc_adapter_state" ("kind","uid") WHERE "uid" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oidc_adapter_state_user_code_idx" ON "oidc_adapter_state" ("kind","user_code") WHERE "user_code" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oidc_adapter_state_grant_idx" ON "oidc_adapter_state" ("grant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oidc_adapter_state_ttl_idx" ON "oidc_adapter_state" ("not_after");
