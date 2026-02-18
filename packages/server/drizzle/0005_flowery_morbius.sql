CREATE TYPE "public"."completed_via" AS ENUM('user', 'ai');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'completed', 'cancelled', 'snoozed');--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"garden_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"target_type" "target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"action_type" "action_type" NOT NULL,
	"priority" "priority" NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"label" text NOT NULL,
	"context" text,
	"suggested_date" text NOT NULL,
	"recurrence" text,
	"photo_requested" text DEFAULT 'false',
	"completed_at" timestamp,
	"completed_via" "completed_via",
	"care_log_id" uuid,
	"source_analysis_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_garden_id_gardens_id_fk" FOREIGN KEY ("garden_id") REFERENCES "public"."gardens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_care_log_id_care_logs_id_fk" FOREIGN KEY ("care_log_id") REFERENCES "public"."care_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_analysis_id_analysis_results_id_fk" FOREIGN KEY ("source_analysis_id") REFERENCES "public"."analysis_results"("id") ON DELETE no action ON UPDATE no action;