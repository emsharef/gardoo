ALTER TABLE "sensors" ALTER COLUMN "zone_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gardens" ADD COLUMN "webhook_token" text;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "garden_id" uuid;--> statement-breakpoint
ALTER TABLE "sensors" ADD CONSTRAINT "sensors_garden_id_gardens_id_fk" FOREIGN KEY ("garden_id") REFERENCES "public"."gardens"("id") ON DELETE cascade ON UPDATE no action;