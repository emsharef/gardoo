import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { zones } from "../db/schema";
import {
  assertGardenOwnership,
  assertZoneOwnership,
} from "../lib/ownership";

export const zonesRouter = router({
  list: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      return ctx.db.query.zones.findMany({
        where: eq(zones.gardenId, input.gardenId),
        with: {
          plants: true,
        },
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const zone = await ctx.db.query.zones.findFirst({
        where: eq(zones.id, input.id),
        with: {
          plants: true,
          sensors: true,
          garden: true,
        },
      });
      if (!zone || zone.garden.userId !== ctx.userId) {
        throw new Error("Zone not found");
      }
      return zone;
    }),

  create: protectedProcedure
    .input(
      z.object({
        gardenId: z.string().uuid(),
        name: z.string().min(1),
        zoneType: z.string().optional(),
        dimensions: z.string().optional(),
        photoUrl: z.string().optional(),
        soilType: z.string().optional(),
        sunExposure: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const [zone] = await ctx.db
        .insert(zones)
        .values({
          gardenId: input.gardenId,
          name: input.name,
          zoneType: input.zoneType,
          dimensions: input.dimensions,
          photoUrl: input.photoUrl,
          soilType: input.soilType,
          sunExposure: input.sunExposure,
          notes: input.notes,
        })
        .returning();
      return zone;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        zoneType: z.string().optional(),
        dimensions: z.string().optional(),
        photoUrl: z.string().optional(),
        soilType: z.string().optional(),
        sunExposure: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertZoneOwnership(ctx.db, input.id, ctx.userId);

      const { id, ...updates } = input;
      const [updated] = await ctx.db
        .update(zones)
        .set(updates)
        .where(eq(zones.id, id))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertZoneOwnership(ctx.db, input.id, ctx.userId);

      await ctx.db.delete(zones).where(eq(zones.id, input.id));
      return { success: true as const };
    }),

  rescan: protectedProcedure
    .input(
      z.object({
        zoneId: z.string().uuid(),
        imageBase64: z.string().min(1, "Image data is required"),
        mediaType: z
          .enum(["image/jpeg", "image/png", "image/gif", "image/webp"])
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Fetch zone with plants and garden (for ownership check)
      const zone = await ctx.db.query.zones.findFirst({
        where: eq(zones.id, input.zoneId),
        with: { plants: true, garden: true },
      });
      if (!zone || zone.garden.userId !== ctx.userId) {
        throw new Error("Zone not found");
      }

      // 2. Filter to active plants only
      const activePlants = zone.plants.filter(
        (p) => p.status !== "retired",
      );

      // 3. Build inventory for AI context
      const currentInventory = activePlants.map((p) => ({
        id: p.id,
        name: p.name,
        variety: p.variety ?? undefined,
        growthStage: p.growthStage ?? undefined,
      }));

      // 4. Build system prompt
      const systemPrompt = `You are a garden plant identification expert. You are given a photo of a garden zone and the current plant inventory for that zone.

Compare what you see in the photo to the current inventory and return a JSON object with three arrays:

1. "newPlants" — plants visible in the photo that are NOT in the current inventory. Include name and variety if identifiable.
2. "missingPlants" — plants in the current inventory that you do NOT see in the photo. Include the plantId from the inventory and suggest a reason (harvested, died, removed).
3. "growthUpdates" — plants in the inventory whose growth stage appears different from what's recorded. Include plantId, current stage (from inventory), and the new stage you observe.

Valid growth stages: Seed, Seedling, Vegetative, Budding, Flowering, Fruiting, Harvest, Dormant.

Current inventory:
${JSON.stringify(currentInventory, null, 2)}

Return ONLY valid JSON matching this schema:
{
  "newPlants": [{ "name": "string", "variety": "string or null" }],
  "missingPlants": [{ "plantId": "uuid", "name": "string", "suggestedReason": "harvested|died|removed" }],
  "growthUpdates": [{ "plantId": "uuid", "name": "string", "currentStage": "string", "newStage": "string" }]
}

If there are no changes in a category, return an empty array. Be conservative — only flag plants as missing if you're reasonably confident they should be visible but aren't.`;

      // 5. Get API key (same pattern as plants.identify)
      const { getApiKey } = await import("../lib/getApiKey");
      let apiKey = await getApiKey(ctx.db, ctx.userId, "claude");
      let provider: "claude" | "kimi" = "claude";

      if (!apiKey) {
        apiKey = await getApiKey(ctx.db, ctx.userId, "kimi");
        provider = "kimi";
      }

      if (!apiKey) {
        throw new Error(
          "No AI API key configured. Add a Claude or Kimi key in Settings.",
        );
      }

      // 6. Define response schema
      const rescanSchema = z.object({
        newPlants: z.array(
          z.object({
            name: z.string(),
            variety: z.string().nullable().optional(),
          }),
        ),
        missingPlants: z.array(
          z.object({
            plantId: z.string().uuid(),
            name: z.string(),
            suggestedReason: z
              .enum(["harvested", "died", "removed"])
              .optional(),
          }),
        ),
        growthUpdates: z.array(
          z.object({
            plantId: z.string().uuid(),
            name: z.string(),
            currentStage: z.string(),
            newStage: z.string(),
          }),
        ),
      });

      // 7. Call AI provider and parse response
      if (provider === "claude") {
        const { ClaudeProvider } = await import("../ai/claude");
        const claude = new ClaudeProvider();
        const response = await claude.chat(
          [
            {
              role: "user",
              content:
                "Analyze this garden zone photo and compare to the current plant inventory.",
            },
          ],
          systemPrompt,
          apiKey,
          input.imageBase64,
          input.mediaType ?? undefined,
        );

        const jsonStr = response.content
          .replace(/```(?:json)?\s*([\s\S]*?)```/, "$1")
          .trim();
        const parsed = JSON.parse(jsonStr);
        return rescanSchema.parse(parsed);
      } else {
        const { KimiProvider } = await import("../ai/kimi");
        const kimi = new KimiProvider();
        const response = await kimi.chat(
          [
            {
              role: "user",
              content:
                "Analyze this garden zone photo and compare to the current plant inventory.",
            },
          ],
          systemPrompt,
          apiKey,
          input.imageBase64,
          input.mediaType ?? undefined,
        );

        const jsonStr = response.content
          .replace(/```(?:json)?\s*([\s\S]*?)```/, "$1")
          .trim();
        const parsed = JSON.parse(jsonStr);
        return rescanSchema.parse(parsed);
      }
    }),
});
