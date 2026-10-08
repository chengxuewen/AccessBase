ALTER TABLE "groups" ADD COLUMN "kind" text DEFAULT 'group' NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD COLUMN "data_scope" text DEFAULT 'all' NOT NULL;