import { z } from "zod";
import { eq, and, desc, sql, inArray, gte } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import {
  gardens,
  analysisResults,
  weatherCache,
  tasks,
  zones,
  plants,
  users,
  type AnalysisResult,
  type UserSettings,
} from "../db/schema";
import { assertGardenOwnership, assertZoneOwnership } from "../lib/ownership";
import { buildZoneContext, gatherZonePhotos } from "../jobs/contextBuilder";
import { fetchWeather } from "../lib/weather";
import { getApiKey } from "../lib/getApiKey";
import { ClaudeProvider } from "../ai/claude";
import { KimiProvider } from "../ai/kimi";
import type { AIProvider } from "../ai/provider";
import { analysisResultSchema } from "../ai/schema";
import type { DB } from "../db/index";

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
    .input(z.object({
      gardenId: z.string().uuid(),
      zoneId: z.string().uuid().optional(),
      plantId: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const pendingTasks = await ctx.db.query.tasks.findMany({
        where: and(
          eq(tasks.gardenId, input.gardenId),
          eq(tasks.status, "pending"),
          ...(input.zoneId ? [eq(tasks.zoneId, input.zoneId)] : []),
          ...(input.plantId
            ? [eq(tasks.targetId, input.plantId), eq(tasks.targetType, "plant")]
            : []),
        ),
      });

      // Look up zone and plant names for display
      const zoneIds = [...new Set(pendingTasks.map((t) => t.zoneId))];
      const plantIds = pendingTasks
        .filter((t) => t.targetType === "plant")
        .map((t) => t.targetId);

      const zoneRows = zoneIds.length > 0
        ? await ctx.db.select({ id: zones.id, name: zones.name, photoUrl: zones.photoUrl }).from(zones).where(inArray(zones.id, zoneIds))
        : [];
      const plantRows = plantIds.length > 0
        ? await ctx.db.select({ id: plants.id, name: plants.name, photoUrl: plants.photoUrl }).from(plants).where(inArray(plants.id, plantIds))
        : [];

      const zoneMap = Object.fromEntries(zoneRows.map((z) => [z.id, z]));
      const plantMap = Object.fromEntries(plantRows.map((p) => [p.id, p]));

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

      return pendingTasks.map((t) => {
        const zone = zoneMap[t.zoneId];
        const plant = t.targetType === "plant" ? plantMap[t.targetId] : null;

        return {
          id: t.id,
          zoneId: t.zoneId,
          zoneName: zone?.name ?? null,
          targetType: t.targetType,
          targetId: t.targetId,
          targetName: plant?.name ?? zone?.name ?? null,
          targetPhotoUrl: plant?.photoUrl ?? zone?.photoUrl ?? null,
          actionType: t.actionType,
          priority: t.priority,
          label: t.label,
          suggestedDate: t.suggestedDate,
          context: t.context,
          recurrence: t.recurrence,
          photoRequested: t.photoRequested === "true",
        };
      });
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

      // Try Trigger.dev first, fall back to inline execution
      if (process.env.TRIGGER_SECRET_KEY) {
        const { tasks: triggerTasks } = await import("@trigger.dev/sdk/v3");
        await triggerTasks.trigger("analyze-garden", { gardenId: input.gardenId });
        return { queued: true as const };
      }

      // Inline execution — run analysis directly
      console.log(`[triggerAnalysis] Running inline analysis for garden ${input.gardenId}`);
      await runInlineAnalysis(ctx.db, input.gardenId, ctx.userId);
      return { queued: true as const };
    }),

  getAnalysisStatus: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      // Check for recent analysis results instead of pgboss.job table
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recent = await ctx.db.query.analysisResults.findFirst({
        where: and(
          eq(analysisResults.gardenId, input.gardenId),
          gte(analysisResults.generatedAt, fiveMinutesAgo),
        ),
        orderBy: [desc(analysisResults.generatedAt)],
      });

      return {
        running: false,
        pendingJobs: 0,
        lastResult: recent?.generatedAt?.toISOString() ?? null,
      };
    }),
});

/**
 * Inline analysis — runs garden + zone analysis directly without Trigger.dev.
 * Used for local development or when Trigger.dev isn't configured.
 */
async function runInlineAnalysis(db: DB, gardenId: string, userId: string) {
  const garden = await db.query.gardens.findFirst({
    where: eq(gardens.id, gardenId),
    with: { zones: true },
  });

  if (!garden) {
    console.warn(`[inline-analysis] Garden ${gardenId} not found`);
    return;
  }

  // Fetch and cache weather
  let weather;
  if (garden.locationLat != null && garden.locationLng != null) {
    try {
      weather = await fetchWeather(garden.locationLat, garden.locationLng);
      await db.insert(weatherCache).values({
        gardenId: garden.id,
        forecast: weather,
        fetchedAt: new Date(),
      });
      console.log(`[inline-analysis] Weather cached for garden ${gardenId}`);
    } catch (err) {
      console.error(`[inline-analysis] Failed to fetch weather:`, err);
    }
  }

  // Determine AI provider
  let apiKey = await getApiKey(db, userId, "claude");
  let provider: AIProvider = new ClaudeProvider();
  let modelUsed = "claude";

  if (!apiKey) {
    apiKey = await getApiKey(db, userId, "kimi");
    provider = new KimiProvider();
    modelUsed = "kimi";
  }

  if (!apiKey) {
    throw new Error("No API key configured. Add a Claude or Kimi API key in Settings.");
  }

  // Load user settings
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { settings: true },
  });
  const userSettings = (user?.settings ?? {}) as UserSettings;

  // Analyze each zone sequentially
  for (const zone of garden.zones) {
    console.log(`[inline-analysis] Analyzing zone ${zone.id} (${zone.name})`);

    const context = await buildZoneContext(db, gardenId, zone.id, weather, userSettings);

    // Gather photos
    const plantIds = context.zone.plants.map((p) => p.id);
    try {
      const photos = await gatherZonePhotos(db, zone.id, plantIds);
      if (photos.length > 0) {
        context.photos = photos;
      }
    } catch (err) {
      console.error(`[inline-analysis] Failed to gather photos:`, err);
    }

    // Call AI
    const { result, tokensUsed } = await provider.analyzeZone(context, apiKey);

    // Validate
    const validated = analysisResultSchema.parse(result);

    const dbResult: AnalysisResult = {
      operations: validated.operations,
      observations: validated.observations ?? [],
      alerts: validated.alerts ?? [],
    };

    // Store audit log
    const [analysisRow] = await db
      .insert(analysisResults)
      .values({
        gardenId,
        scope: "zone",
        targetId: zone.id,
        result: dbResult,
        modelUsed,
        tokensUsed,
        generatedAt: new Date(),
      })
      .returning();

    // Apply operations
    for (const op of validated.operations) {
      try {
        switch (op.op) {
          case "create": {
            await db.insert(tasks).values({
              gardenId,
              zoneId: zone.id,
              targetType: op.targetType,
              targetId: op.targetId,
              actionType: op.actionType,
              priority: op.priority,
              status: "pending",
              label: op.label,
              suggestedDate: op.suggestedDate,
              context: op.context ?? null,
              recurrence: op.recurrence ?? null,
              photoRequested: op.photoRequested ? "true" : "false",
              sourceAnalysisId: analysisRow.id,
            });
            break;
          }
          case "update": {
            const existing = await db.query.tasks.findFirst({
              where: and(
                eq(tasks.id, op.taskId!),
                eq(tasks.zoneId, zone.id),
                eq(tasks.status, "pending"),
              ),
            });
            if (!existing) break;
            const updates: Record<string, unknown> = {
              updatedAt: new Date(),
              sourceAnalysisId: analysisRow.id,
            };
            if (op.suggestedDate !== undefined) updates.suggestedDate = op.suggestedDate;
            if (op.priority !== undefined) updates.priority = op.priority;
            if (op.label !== undefined) updates.label = op.label;
            if (op.context !== undefined) updates.context = op.context;
            if (op.recurrence !== undefined) updates.recurrence = op.recurrence;
            if (op.photoRequested !== undefined)
              updates.photoRequested = op.photoRequested ? "true" : "false";
            await db.update(tasks).set(updates).where(eq(tasks.id, op.taskId!));
            break;
          }
          case "complete": {
            const existing = await db.query.tasks.findFirst({
              where: and(
                eq(tasks.id, op.taskId!),
                eq(tasks.zoneId, zone.id),
                eq(tasks.status, "pending"),
              ),
            });
            if (!existing) break;
            await db
              .update(tasks)
              .set({
                status: "completed",
                completedAt: new Date(),
                completedVia: "ai",
                context: op.reason ?? existing.context,
                updatedAt: new Date(),
                sourceAnalysisId: analysisRow.id,
              })
              .where(eq(tasks.id, op.taskId!));
            break;
          }
          case "cancel": {
            const existing = await db.query.tasks.findFirst({
              where: and(
                eq(tasks.id, op.taskId!),
                eq(tasks.zoneId, zone.id),
                eq(tasks.status, "pending"),
              ),
            });
            if (!existing) break;
            await db
              .update(tasks)
              .set({
                status: "cancelled",
                completedAt: new Date(),
                completedVia: "ai",
                context: op.reason ?? existing.context,
                updatedAt: new Date(),
                sourceAnalysisId: analysisRow.id,
              })
              .where(eq(tasks.id, op.taskId!));
            break;
          }
        }
      } catch (opErr) {
        console.error(`[inline-analysis] Failed to apply ${op.op} operation:`, opErr);
      }
    }

    console.log(
      `[inline-analysis] Done: zone ${zone.id} (${modelUsed}, ${tokensUsed.input + tokensUsed.output} tokens, ${validated.operations.length} ops)`,
    );
  }

  console.log(`[inline-analysis] Completed all zones for garden ${gardenId}`);
}
