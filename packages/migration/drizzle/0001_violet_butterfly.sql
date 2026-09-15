CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"hash" varchar(64) NOT NULL,
	"scopes" jsonb DEFAULT '["*"]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(64),
	"user_id" varchar(64),
	"action" varchar(128) NOT NULL,
	"resource_type" varchar(64),
	"resource_id" varchar(64),
	"request_body" jsonb,
	"response_status" integer,
	"request_id" varchar(64),
	"ip" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"code_hash" varchar(255) NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_account_id" varchar(128) NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_oauth_provider_account" UNIQUE("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"post_logout_redirect_uris" jsonb DEFAULT '[]'::jsonb,
	"grant_types" jsonb NOT NULL,
	"scope" text NOT NULL,
	"token_endpoint_auth_method" text DEFAULT 'client_secret_basic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_grant_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_grants_provider_grant_id_unique" UNIQUE("provider_grant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "options" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "refresh_token_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_info" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip_address" varchar(45);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_keys_tenant" ON "api_keys" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created" ON "audit_logs" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_user" ON "audit_logs" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mfa_recovery_codes_user" ON "mfa_recovery_codes" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_accounts_user" ON "oauth_accounts" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_password_history_user" ON "password_history" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webauthn_credentials_user" ON "webauthn_credentials" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_refresh_hash" ON "sessions" ("refresh_token_hash");