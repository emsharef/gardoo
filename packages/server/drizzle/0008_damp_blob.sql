ALTER TABLE "plants" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "plants" ADD COLUMN "retired_at" timestamp;--> statement-breakpoint
ALTER TABLE "plants" ADD COLUMN "retired_reason" text;