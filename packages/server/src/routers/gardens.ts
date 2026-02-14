import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { gardens, analysisResults, weatherCache } from "../db/schema.js";
import { assertGardenOwnership } from "../lib/ownership.js";

export const gardensRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.gardens.findMany({
      where: eq(gardens.userId, ctx.userId),
      with: {
        zones: {
          with: {
            plants: true,
          },
        },
      },
    });
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const garden = await ctx.db.query.gardens.findFirst({
        where: and(eq(gardens.id, input.id), eq(gardens.userId, ctx.userId)),
        with: {
          zones: {
            with: {
              plants: true,
              sensors: true,
            },
          },
        },
      });
      if (!garden) throw new Error("Garden not found");
      return garden;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        locationLat: z.number().optional(),
        locationLng: z.number().optional(),
        hardinessZone: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [garden] = await ctx.db
        .insert(gardens)
        .values({
          userId: ctx.userId,
          name: input.name,
          locationLat: input.locationLat,
          locationLng: input.locationLng,
          hardinessZone: input.hardinessZone,
        })
        .returning();
      return garden;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        locationLat: z.number().optional(),
        locationLng: z.number().optional(),
        hardinessZone: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.id, ctx.userId);

      const { id, ...updates } = input;
      const [updated] = await ctx.db
        .update(gardens)
        .set(updates)
        .where(and(eq(gardens.id, id), eq(gardens.userId, ctx.userId)))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.id, ctx.userId);

      await ctx.db
        .delete(gardens)
        .where(and(eq(gardens.id, input.id), eq(gardens.userId, ctx.userId)));
      return { success: true as const };
    }),

  getActions: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const results = await ctx.db.query.analysisResults.findMany({
        where: eq(analysisResults.gardenId, input.gardenId),
        orderBy: [desc(analysisResults.generatedAt)],
        limit: 10,
      });

      // Merge all actions from recent analysis results, deduplicate by targetId+actionType
      const seen = new Set<string>();
      const actions: Array<{
        targetType: string;
        targetId: string;
        actionType: string;
        priority: string;
        label: string;
        suggestedDate?: string;
        context?: string;
        recurrence?: string;
      }> = [];

      const priorityOrder: Record<string, number> = {
        urgent: 0,
        today: 1,
        upcoming: 2,
        informational: 3,
      };

      for (const result of results) {
        const analysisResult = result.result;
        if (analysisResult?.actions) {
          for (const action of analysisResult.actions) {
            const key = `${action.targetId}:${action.actionType}`;
            if (!seen.has(key)) {
              seen.add(key);
              actions.push(action);
            }
          }
        }
      }

      // Sort by priority
      actions.sort(
        (a, b) =>
          (priorityOrder[a.priority] ?? 99) -
          (priorityOrder[b.priority] ?? 99),
      );

      return actions;
    }),

  getWeather: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const cached = await ctx.db.query.weatherCache.findFirst({
        where: eq(weatherCache.gardenId, input.gardenId),
        orderBy: [desc(weatherCache.fetchedAt)],
      });

      return cached ?? null;
    }),
});
