import type PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  gardens,
  weatherCache,
  analysisResults,
  type AnalysisResult,
} from "../db/schema.js";
import { fetchWeather, type WeatherData } from "../lib/weather.js";
import { getApiKey } from "../lib/getApiKey.js";
import { ClaudeProvider } from "../ai/claude.js";
import { KimiProvider } from "../ai/kimi.js";
import type { AIProvider } from "../ai/provider.js";
import { analysisResultSchema } from "../ai/schema.js";
import { buildZoneContext } from "./contextBuilder.js";
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

    // Enqueue a zone analysis job for each zone
    const boss = getJobQueue();

    for (const zone of garden.zones) {
      await boss.send("analyze-zone", {
        gardenId: garden.id,
        zoneId: zone.id,
        userId: garden.userId,
        ...(weather ? { weather } : {}),
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

    console.log(
      `[analyze-zone] Processing zone ${zoneId} in garden ${gardenId}`,
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

      // Build the analysis context from DB data
      const context = await buildZoneContext(db, gardenId, zoneId, weather);

      // Call the AI provider
      const { result, tokensUsed } = await provider.analyzeZone(
        context,
        apiKey,
      );

      // Validate the result against the schema
      const validated = analysisResultSchema.parse(result);

      // Normalize optional fields to match the DB column type
      const dbResult: AnalysisResult = {
        actions: validated.actions,
        observations: validated.observations ?? [],
        alerts: validated.alerts ?? [],
      };

      // Store in the database
      await db.insert(analysisResults).values({
        gardenId,
        scope: "zone",
        targetId: zoneId,
        result: dbResult,
        modelUsed,
        tokensUsed,
        generatedAt: new Date(),
      });

      console.log(
        `[analyze-zone] Analysis stored for zone ${zoneId} (${modelUsed}, ${tokensUsed.input + tokensUsed.output} tokens)`,
      );
    } catch (err) {
      // Log but don't crash — let other zones continue
      console.error(
        `[analyze-zone] Failed to analyze zone ${zoneId} in garden ${gardenId}:`,
        err,
      );
    }
  }
}
