import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { plants, type CareProfile } from "../db/schema.js";
import {
  assertZoneOwnership,
  assertPlantOwnership,
} from "../lib/ownership.js";

export const plantsRouter = router({
  list: protectedProcedure
    .input(z.object({ zoneId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertZoneOwnership(ctx.db, input.zoneId, ctx.userId);

      return ctx.db.query.plants.findMany({
        where: eq(plants.zoneId, input.zoneId),
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const plant = await ctx.db.query.plants.findFirst({
        where: eq(plants.id, input.id),
        with: {
          zone: { with: { garden: true } },
        },
      });
      if (!plant || plant.zone.garden.userId !== ctx.userId) {
        throw new Error("Plant not found");
      }
      return plant;
    }),

  create: protectedProcedure
    .input(
      z.object({
        zoneId: z.string().uuid(),
        name: z.string().min(1),
        variety: z.string().optional(),
        species: z.string().optional(),
        datePlanted: z.string().optional(),
        growthStage: z.string().optional(),
        photoUrl: z.string().optional(),
        careProfile: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertZoneOwnership(ctx.db, input.zoneId, ctx.userId);

      const [plant] = await ctx.db
        .insert(plants)
        .values({
          zoneId: input.zoneId,
          name: input.name,
          variety: input.variety,
          species: input.species,
          datePlanted: input.datePlanted
            ? new Date(input.datePlanted)
            : undefined,
          growthStage: input.growthStage,
          photoUrl: input.photoUrl,
          careProfile: input.careProfile as CareProfile | undefined,
        })
        .returning();
      return plant;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        variety: z.string().optional(),
        species: z.string().optional(),
        datePlanted: z.string().optional(),
        growthStage: z.string().optional(),
        photoUrl: z.string().optional(),
        careProfile: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPlantOwnership(ctx.db, input.id, ctx.userId);

      const { id, datePlanted, careProfile, ...rest } = input;
      const updates: Record<string, unknown> = { ...rest };
      if (datePlanted !== undefined) {
        updates.datePlanted = new Date(datePlanted);
      }
      if (careProfile !== undefined) {
        updates.careProfile = careProfile;
      }

      const [updated] = await ctx.db
        .update(plants)
        .set(updates)
        .where(eq(plants.id, id))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertPlantOwnership(ctx.db, input.id, ctx.userId);

      await ctx.db.delete(plants).where(eq(plants.id, input.id));
      return { success: true as const };
    }),

  identify: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string(),
        zoneType: z.string().optional(),
        zoneName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { getApiKey } = await import("../lib/getApiKey.js");
      let apiKey = await getApiKey(ctx.db, ctx.userId, "claude");
      let provider: "claude" | "kimi" = "claude";

      if (!apiKey) {
        apiKey = await getApiKey(ctx.db, ctx.userId, "kimi");
        provider = "kimi";
      }

      if (!apiKey) {
        throw new Error("No AI API key configured");
      }

      const systemPrompt = [
        "You are a plant identification expert.",
        "Analyze the photo and identify all visible plants.",
        "Return ONLY a JSON array of objects with these fields:",
        '  - "name": common plant name (string, required)',
        '  - "variety": specific variety if identifiable (string, optional)',
        "If no plants are visible, return an empty array: []",
        "Do not include any text outside the JSON array.",
        input.zoneType
          ? `Context: this is a ${input.zoneType} zone called "${input.zoneName ?? "unnamed"}".`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      const identifiedPlantsSchema = z.array(
        z.object({
          name: z.string(),
          variety: z.string().optional(),
        }),
      );

      if (provider === "claude") {
        const { ClaudeProvider } = await import("../ai/claude.js");
        const claude = new ClaudeProvider();
        const response = await claude.chat(
          [{ role: "user", content: "Identify the plants in this photo." }],
          systemPrompt,
          apiKey,
          input.imageBase64,
        );

        const jsonStr = response.content
          .replace(/```(?:json)?\s*([\s\S]*?)```/, "$1")
          .trim();
        const parsed = JSON.parse(jsonStr);
        const plants = identifiedPlantsSchema.parse(parsed);

        return { plants };
      } else {
        const { KimiProvider } = await import("../ai/kimi.js");
        const kimi = new KimiProvider();
        const response = await kimi.chat(
          [{ role: "user", content: "Identify the plants in this photo." }],
          systemPrompt,
          apiKey,
          input.imageBase64,
        );

        const jsonStr = response.content
          .replace(/```(?:json)?\s*([\s\S]*?)```/, "$1")
          .trim();
        const parsed = JSON.parse(jsonStr);
        const plants = identifiedPlantsSchema.parse(parsed);

        return { plants };
      }
    }),
});
