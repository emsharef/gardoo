import { task } from "@trigger.dev/sdk/v3";
import { and, eq } from "drizzle-orm";
import { createDb } from "@gardoo/server/src/db/index";
import {
  users,
  analysisResults,
  tasks as tasksTable,
  type AnalysisResult,
  type UserSettings,
} from "@gardoo/server/src/db/schema";
import { getApiKey } from "@gardoo/server/src/lib/getApiKey";
import { ClaudeProvider } from "@gardoo/server/src/ai/claude";
import { KimiProvider } from "@gardoo/server/src/ai/kimi";
import type { AIProvider } from "@gardoo/server/src/ai/provider";
import { analysisResultSchema } from "@gardoo/server/src/ai/schema";
import { buildZoneContext, gatherZonePhotos } from "@gardoo/server/src/jobs/contextBuilder";
import type { WeatherData } from "@gardoo/server/src/lib/weather";

export const analyzeZone = task({
  id: "analyze-zone",
  retry: { maxAttempts: 3, minTimeoutInMs: 10_000 },
  run: async (payload: {
    gardenId: string;
    zoneId: string;
    userId: string;
    weather?: WeatherData;
  }) => {
    const db = createDb(process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!);
    const { gardenId, zoneId, userId, weather } = payload;
    console.log(`[analyze-zone] Processing zone ${zoneId} in garden ${gardenId}`);

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
      console.warn(`[analyze-zone] No API key found for user ${userId}, skipping`);
      return;
    }

    // Load user settings
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { settings: true },
    });
    const userSettings = (user?.settings ?? {}) as UserSettings;

    // Build context
    const context = await buildZoneContext(db, gardenId, zoneId, weather, userSettings);

    // Gather photos
    const plantIds = context.zone.plants.map((p) => p.id);
    try {
      const photos = await gatherZonePhotos(db, zoneId, plantIds, context.zone.name);
      if (photos.length > 0) {
        context.photos = photos;
        console.log(`[analyze-zone] Attached ${photos.length} photo(s)`);
      }
    } catch (err) {
      console.error(`[analyze-zone] Failed to gather photos:`, err);
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
        targetId: zoneId,
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
            await db.insert(tasksTable).values({
              gardenId,
              zoneId,
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
                eq(tasksTable.id, op.taskId!),
                eq(tasksTable.zoneId, zoneId),
                eq(tasksTable.status, "pending"),
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
            await db.update(tasksTable).set(updates).where(eq(tasksTable.id, op.taskId!));
            break;
          }
          case "complete": {
            const existing = await db.query.tasks.findFirst({
              where: and(
                eq(tasksTable.id, op.taskId!),
                eq(tasksTable.zoneId, zoneId),
                eq(tasksTable.status, "pending"),
              ),
            });
            if (!existing) break;
            await db
              .update(tasksTable)
              .set({
                status: "completed",
                completedAt: new Date(),
                completedVia: "ai",
                context: op.reason ?? existing.context,
                updatedAt: new Date(),
                sourceAnalysisId: analysisRow.id,
              })
              .where(eq(tasksTable.id, op.taskId!));
            break;
          }
          case "cancel": {
            const existing = await db.query.tasks.findFirst({
              where: and(
                eq(tasksTable.id, op.taskId!),
                eq(tasksTable.zoneId, zoneId),
                eq(tasksTable.status, "pending"),
              ),
            });
            if (!existing) break;
            await db
              .update(tasksTable)
              .set({
                status: "cancelled",
                completedAt: new Date(),
                completedVia: "ai",
                context: op.reason ?? existing.context,
                updatedAt: new Date(),
                sourceAnalysisId: analysisRow.id,
              })
              .where(eq(tasksTable.id, op.taskId!));
            break;
          }
        }
      } catch (opErr) {
        console.error(`[analyze-zone] Failed to apply ${op.op} operation:`, opErr);
      }
    }

    console.log(
      `[analyze-zone] Done: zone ${zoneId} (${modelUsed}, ${tokensUsed.input + tokensUsed.output} tokens, ${validated.operations.length} ops)`,
    );
  },
});
