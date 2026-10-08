ALTER TABLE "oauth_accounts" ADD COLUMN "id_token" text;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "session_index" text;--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD COLUMN "jwks" jsonb;