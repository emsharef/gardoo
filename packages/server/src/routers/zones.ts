import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { zones } from "../db/schema.js";
import {
  assertGardenOwnership,
  assertZoneOwnership,
} from "../lib/ownership.js";

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
});
