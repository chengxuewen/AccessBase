CREATE TABLE "audit_chain_anchors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"seq" integer NOT NULL,
	"first_id" uuid NOT NULL,
	"last_id" uuid NOT NULL,
	"row_count" integer NOT NULL,
	"root" text NOT NULL,
	"prev_root" text,
	"pruned_at" timestamp with time zone,
	"anchored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_erasures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"legal_basis" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"rows_affected" integer NOT NULL,
	"events_scrubbed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "row_hash" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "anchor_id" bigint;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "erasure_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_chain_anchors_day_seq_unique" ON "audit_chain_anchors" USING btree ("day","seq");