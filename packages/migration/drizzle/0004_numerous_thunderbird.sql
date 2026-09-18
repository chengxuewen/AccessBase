ALTER TABLE "users" ADD COLUMN "phone" varchar(20);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_phone" ON "users" ("phone") WHERE phone IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_phone_unique" ON "users" ("phone") WHERE phone IS NOT NULL;