import type PgBoss from "pg-boss";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  gardens,
  users,
  weatherCache,
  analysisResults,
  tasks,
  type AnalysisResult,
  type UserSettings,
} from "../db/schema.js";
import { fetchWeather, type WeatherData } from "../lib/weather.js";
import { getApiKey } from "../lib/getApiKey.js";
import { ClaudeProvider } from "../ai/claude.js";
import { KimiProvider } from "../ai/kimi.js";
import type { AIProvider } from "../ai/provider.js";
import { analysisResultSchema } from "../ai/schema.js";
import { buildZoneContext, gatherZonePhotos } from "./contextBuilder.js";
import { getJobQueue } from "./index.js";

// ─── Job data shapes ────────────────────────────────────────────────────────

interface AnalyzeGardenData {
  gardenId: string;
}

interface AnalyzeZoneData {
  gardenId: string;
  zoneId: string;
  userId: string;
  weather?: WeatherData;
}

// ─── handleDailyTrigger ─────────────────────────────────────────────────────

/**
 * Called on the cron schedule. Queries all gardens and enqueues an
 * "analyze-garden" job for each one.
 */
export async function handleDailyTrigger(
  jobs: PgBoss.Job[],
): Promise<void> {
  for (const _job of jobs) {
    console.log("[daily-analysis-trigger] Starting daily analysis run");

    const allGardens = await db.select().from(gardens);

    console.log(
      `[daily-analysis-trigger] Found ${allGardens.length} gardens to analyze`,
    );

    const boss = getJobQueue();

    for (const garden of allGardens) {
      await boss.send("analyze-garden", { gardenId: garden.id });
    }

    console.log("[daily-analysis-trigger] All garden jobs enqueued");
  }
}

// ─── handleAnalyzeGarden ────────────────────────────────────────────────────

/**
 * Loads a garden with its zones, fetches weather (if location available),
 * caches it, and enqueues an "analyze-zone" job for each zone.
 */
export async function handleAnalyzeGarden(
  jobs: PgBoss.Job<AnalyzeGardenData>[],
): Promise<void> {
  for (const job of jobs) {
    const { gardenId } = job.data;

    console.log(`[analyze-garden] Processing garden ${gardenId}`);

    const garden = await db.query.gardens.findFirst({
      where: eq(gardens.id, gardenId),
      with: { zones: true },
    });

    if (!garden) {
      console.warn(`[analyze-garden] Garden ${gardenId} not found, skipping`);
      continue;
    }

    // Fetch and cache weather if the garden has a location
    let weather: WeatherData | undefined;

    if (garden.locationLat != null && garden.locationLng != null) {
      try {
        weather = await fetchWeather(garden.locationLat, garden.locationLng);

        await db.insert(weatherCache).values({
          gardenId: garden.id,
          forecast: weather,
          fetchedAt: new Date(),
        });

        console.log(`[analyze-garden] Weather cached for garden ${gardenId}`);
      } catch (err) {
        console.error(
          `[analyze-garden] Failed to fetch weather for garden ${gardenId}:`,
          err,
        );
        // Continue without weather data
      }
    }

    // Enqueue a zone analysis job for each zone (with retries so transient
    // failures — e.g. decrypt errors on a stale instance — get another chance)
    const boss = getJobQueue();

    for (const zone of garden.zones) {
      await boss.send("analyze-zone", {
        gardenId: garden.id,
        zoneId: zone.id,
        userId: garden.userId,
        ...(weather ? { weather } : {}),
      }, {
        retryLimit: 3,
        retryDelay: 10,
        expireInSeconds: 300,
      });
    }

    console.log(
      `[analyze-garden] Enqueued ${garden.zones.length} zone jobs for garden ${gardenId}`,
    );
  }
}

// ─── handleAnalyzeZone ──────────────────────────────────────────────────────

/**
 * Runs AI analysis for a single zone. Picks the user's preferred provider,
 * builds the context, calls the AI, validates the result, and stores it.
 */
export async function handleAnalyzeZone(
  jobs: PgBoss.Job<AnalyzeZoneData>[],
): Promise<void> {
  for (const job of jobs) {
    const { gardenId, zoneId, userId, weather } = job.data;

    const instance = process.env.HOSTNAME ?? "unknown";

    console.log(
      `[analyze-zone] Processing zone ${zoneId} in garden ${gardenId} (instance: ${instance})`,
    );

    try {
      // Determine AI provider — try Claude first, fall back to Kimi
      let apiKey = await getApiKey(db, userId, "claude");
      let provider: AIProvider = new ClaudeProvider();
      let modelUsed = "claude";

      if (!apiKey) {
        apiKey = await getApiKey(db, userId, "kimi");
        provider = new KimiProvider();
        modelUsed = "kimi";
      }

      if (!apiKey) {
        console.warn(
          `[analyze-zone] No API key found for user ${userId}, skipping zone ${zoneId}`,
        );
        continue;
      }

      // Load user settings for analysis preferences
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { settings: true },
      });
      const userSettings = (user?.settings ?? {}) as UserSettings;

      // Build the analysis context from DB data
      const context = await buildZoneContext(db, gardenId, zoneId, weather, userSettings);

      // Gather photos for the zone
      const plantIds = context.zone.plants.map((p) => p.id);
      try {
        const photos = await gatherZonePhotos(db, zoneId, plantIds);
        if (photos.length > 0) {
          context.photos = photos;
          console.log(
            `[analyze-zone] Attached ${photos.length} photo(s) for zone ${zoneId}`,
          );
        }
      } catch (err) {
        console.error(
          `[analyze-zone] Failed to gather photos for zone ${zoneId}:`,
          err,
        );
      }

      // Call the AI provider
      const { result, tokensUsed } = await provider.analyzeZone(
        context,
        apiKey,
      );

      // Validate the result against the schema
      const validated = analysisResultSchema.parse(result);

      // Normalize optional fields for DB storage
      const dbResult: AnalysisResult = {
        operations: validated.operations,
        observations: validated.observations ?? [],
        alerts: validated.alerts ?? [],
      };

      // Store raw AI response as audit log
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

      // Apply operations to the tasks table
      for (const op of validated.operations) {
        try {
          switch (op.op) {
            case "create": {
              await db.insert(tasks).values({
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
                  eq(tasks.id, op.taskId!),
                  eq(tasks.zoneId, zoneId),
                  eq(tasks.status, "pending"),
                ),
              });
              if (!existing) {
                console.warn(
                  `[analyze-zone] Update op references unknown/non-pending task ${op.taskId}, skipping`,
                );
                break;
              }
              const updates: Record<string, unknown> = {
                updatedAt: new Date(),
                sourceAnalysisId: analysisRow.id,
              };
              if (op.suggestedDate !== undefined)
                updates.suggestedDate = op.suggestedDate;
              if (op.priority !== undefined) updates.priority = op.priority;
              if (op.label !== undefined) updates.label = op.label;
              if (op.context !== undefined) updates.context = op.context;
              if (op.recurrence !== undefined)
                updates.recurrence = op.recurrence;
              if (op.photoRequested !== undefined)
                updates.photoRequested = op.photoRequested ? "true" : "false";
              await db
                .update(tasks)
                .set(updates)
                .where(eq(tasks.id, op.taskId!));
              break;
            }
            case "complete": {
              const existing = await db.query.tasks.findFirst({
                where: and(
                  eq(tasks.id, op.taskId!),
                  eq(tasks.zoneId, zoneId),
                  eq(tasks.status, "pending"),
                ),
              });
              if (!existing) {
                console.warn(
                  `[analyze-zone] Complete op references unknown/non-pending task ${op.taskId}, skipping`,
                );
                break;
              }
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
                  eq(tasks.zoneId, zoneId),
                  eq(tasks.status, "pending"),
                ),
              });
              if (!existing) {
                console.warn(
                  `[analyze-zone] Cancel op references unknown/non-pending task ${op.taskId}, skipping`,
                );
                break;
              }
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
          console.error(
            `[analyze-zone] Failed to apply ${op.op} operation:`,
            opErr,
          );
          // Continue with remaining operations
        }
      }

      console.log(
        `[analyze-zone] Analysis stored for zone ${zoneId} (${modelUsed}, ${tokensUsed.input + tokensUsed.output} tokens, ${validated.operations.length} operations applied)`,
      );
    } catch (err) {
      console.error(
        `[analyze-zone] Failed to analyze zone ${zoneId} in garden ${gardenId} (instance: ${instance}):`,
        err,
      );
      // Rethrow so pg-boss marks the job as "failed" and retries it.
      // Previously errors were silently swallowed, marking the job
      // "completed" even though analysis never ran — with retry_limit
      // configured on the job, pg-boss will retry on another worker.
      throw err;
    }
  }
}
