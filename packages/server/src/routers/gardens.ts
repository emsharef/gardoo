import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { gardens, analysisResults, weatherCache, tasks } from "../db/schema.js";
import { assertGardenOwnership, assertZoneOwnership } from "../lib/ownership.js";
import { buildZoneContext, gatherZonePhotos } from "../jobs/contextBuilder.js";
import { fetchWeather } from "../lib/weather.js";
import { getJobQueue } from "../jobs/index.js";

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

      const pendingTasks = await ctx.db.query.tasks.findMany({
        where: and(
          eq(tasks.gardenId, input.gardenId),
          eq(tasks.status, "pending"),
        ),
      });

      const priorityOrder: Record<string, number> = {
        urgent: 0,
        today: 1,
        upcoming: 2,
        informational: 3,
      };

      pendingTasks.sort(
        (a, b) =>
          (priorityOrder[a.priority] ?? 99) -
          (priorityOrder[b.priority] ?? 99),
      );

      return pendingTasks.map((t) => ({
        id: t.id,
        targetType: t.targetType,
        targetId: t.targetId,
        actionType: t.actionType,
        priority: t.priority,
        label: t.label,
        suggestedDate: t.suggestedDate,
        context: t.context,
        recurrence: t.recurrence,
        photoRequested: t.photoRequested === "true",
      }));
    }),

  getWeather: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const cached = await ctx.db.query.weatherCache.findFirst({
        where: eq(weatherCache.gardenId, input.gardenId),
        orderBy: [desc(weatherCache.fetchedAt)],
      });

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const isStale = !cached || cached.fetchedAt < oneHourAgo;

      if (isStale) {
        const garden = await ctx.db.query.gardens.findFirst({
          where: eq(gardens.id, input.gardenId),
        });

        if (garden?.locationLat != null && garden?.locationLng != null) {
          try {
            const weather = await fetchWeather(garden.locationLat, garden.locationLng);
            const [fresh] = await ctx.db
              .insert(weatherCache)
              .values({
                gardenId: input.gardenId,
                forecast: weather,
                fetchedAt: new Date(),
              })
              .returning();
            return fresh;
          } catch (err) {
            console.error(`[getWeather] Failed to fetch weather:`, err);
            // Fall through to return stale cache if available
          }
        }
      }

      return cached ?? null;
    }),

  getAnalysisResults: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const results = await ctx.db.query.analysisResults.findMany({
        where: eq(analysisResults.gardenId, input.gardenId),
        orderBy: [desc(analysisResults.generatedAt)],
        limit: 10,
      });

      return results.map((r) => ({
        id: r.id,
        scope: r.scope,
        targetId: r.targetId,
        result: r.result,
        modelUsed: r.modelUsed,
        tokensUsed: r.tokensUsed,
        generatedAt: r.generatedAt.toISOString(),
      }));
    }),

  getAnalysisContext: protectedProcedure
    .input(
      z.object({
        gardenId: z.string().uuid(),
        zoneId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);
      await assertZoneOwnership(ctx.db, input.zoneId, ctx.userId);

      const garden = await ctx.db.query.gardens.findFirst({
        where: eq(gardens.id, input.gardenId),
      });

      let weather;
      if (garden?.locationLat != null && garden?.locationLng != null) {
        try {
          weather = await fetchWeather(garden.locationLat, garden.locationLng);
        } catch {
          // Continue without weather
        }
      }

      const context = await buildZoneContext(
        ctx.db,
        input.gardenId,
        input.zoneId,
        weather,
      );

      // Include photos so the context viewer shows what the AI would see
      const plantIds = context.zone.plants.map((p) => p.id);
      try {
        const photos = await gatherZonePhotos(ctx.db, input.zoneId, plantIds);
        if (photos.length > 0) {
          // Return metadata only (not full base64 data URLs) to keep response small
          context.photos = photos.map((p) => ({
            dataUrl: "(base64 image data omitted)",
            description: p.description,
          }));
        }
      } catch {
        // Continue without photos
      }

      return context;
    }),

  triggerAnalysis: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const boss = getJobQueue();
      await boss.send("analyze-garden", { gardenId: input.gardenId });

      return { queued: true as const };
    }),

  getAnalysisStatus: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const result = await ctx.db.execute(sql`
        SELECT count(*)::int as count
        FROM pgboss.job
        WHERE name IN ('analyze-garden', 'analyze-zone')
          AND data->>'gardenId' = ${input.gardenId}
          AND state IN ('created', 'retry', 'active')
      `);

      const count = (result as unknown as Array<{ count: number }>)[0]?.count ?? 0;

      return { running: count > 0, pendingJobs: count };
    }),
});
