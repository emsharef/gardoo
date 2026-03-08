import { task } from "@trigger.dev/sdk/v3";
import { eq } from "drizzle-orm";
import { createDb } from "@gardoo/server/src/db/index";
import { gardens, weatherCache } from "@gardoo/server/src/db/schema";
import { fetchWeather, type WeatherData } from "@gardoo/server/src/lib/weather";
import { analyzeZone } from "./analyze-zone";

export const analyzeGarden = task({
  id: "analyze-garden",
  retry: { maxAttempts: 2 },
  run: async (payload: { gardenId: string }) => {
    const db = createDb(process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!);
    const { gardenId } = payload;
    console.log(`[analyze-garden] Processing garden ${gardenId}`);

    const garden = await db.query.gardens.findFirst({
      where: eq(gardens.id, gardenId),
      with: { zones: true },
    });

    if (!garden) {
      console.warn(`[analyze-garden] Garden ${gardenId} not found, skipping`);
      return;
    }

    // Fetch and cache weather
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
        console.error(`[analyze-garden] Failed to fetch weather:`, err);
      }
    }

    // Fan out to per-zone analysis
    if (garden.zones.length > 0) {
      await analyzeZone.batchTriggerAndWait(
        garden.zones.map((zone) => ({
          payload: {
            gardenId: garden.id,
            zoneId: zone.id,
            userId: garden.userId,
            ...(weather ? { weather } : {}),
          },
        })),
      );
    }

    console.log(`[analyze-garden] Completed analysis for garden ${gardenId}`);
  },
});
