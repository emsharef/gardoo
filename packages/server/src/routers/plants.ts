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
});
