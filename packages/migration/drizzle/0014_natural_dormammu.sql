CREATE SEQUENCE "public"."audit_logs_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "audit_export_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secret_encrypted" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_delivered_seq" bigint DEFAULT 0 NOT NULL,
	"skipped_seq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_export_destinations_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "caep_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid,
	"event_type" text NOT NULL,
	"subject_id" varchar(64) NOT NULL,
	"jti" varchar(64) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"response_status" integer,
	"delivered_at" timestamp with time zone,
	"dead_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caep_deliveries_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "cidr_allowlist" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "decision" jsonb;--> statement-breakpoint
-- P-6=B: staged low-lock add of the monotonic export-dequeue column. A
-- one-shot ADD COLUMN bigint DEFAULT nextval(...) carries a volatile default
-- = full-table rewrite under ACCESS EXCLUSIVE on the highest-write table
-- (panel run 2 PH-6). Staged: NULL column (metadata-only) -> bounded-batch
-- backfill (nextval; row locks only; the sequence was created at the head of
-- this file) -> default -> validated NOT NULL (pre-validated CHECK lets PG
-- skip the rescan). All inside this file's BEGIN/COMMIT; the batch bounds
-- per-statement work only.
-- DEPLOY CONTRACT (review #10): migrate.sh runs BEFORE the server listens
-- (entrypoint order) — an audit write committed DURING this file's own
-- transaction window could land a NULL seq after the backfill loop drained
-- (uncommitted DDL is invisible to concurrent sessions). Serving starts only
-- after the chain is applied, so the window is closed by startup ordering,
-- not by this SQL.
ALTER TABLE "audit_logs" ADD COLUMN "seq" bigint;--> statement-breakpoint
DO $$
DECLARE
  updated int;
BEGIN
  LOOP
    UPDATE "audit_logs"
       SET "seq" = nextval('audit_logs_seq')
     WHERE "ctid" IN (SELECT "ctid" FROM "audit_logs" WHERE "seq" IS NULL LIMIT 5000);
    GET DIAGNOSTICS updated = ROW_COUNT;
    EXIT WHEN updated = 0;
  END LOOP;
END
$$;--> statement-breakpoint
SELECT setval('audit_logs_seq', GREATEST((SELECT COALESCE(max("seq"), 0) FROM "audit_logs"), 1));--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "seq" SET DEFAULT nextval('audit_logs_seq');--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_seq_not_null" CHECK ("seq" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "audit_logs" VALIDATE CONSTRAINT "audit_logs_seq_not_null";--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD COLUMN "caep_endpoint_uri" text;--> statement-breakpoint
ALTER TABLE "caep_deliveries" ADD CONSTRAINT "caep_deliveries_client_id_oidc_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oidc_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_caep_deliveries_due" ON "caep_deliveries" USING btree ("tenant_id","next_attempt_at") WHERE "caep_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_audit_logs_seq" ON "audit_logs" USING btree ("seq");