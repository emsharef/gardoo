import { and, eq, gte, desc, inArray } from "drizzle-orm";
import type { DB } from "../db/index.js";
import {
  gardens,
  zones,
  plants,
  careLogs,
  sensors,
  sensorReadings,
  tasks,
} from "../db/schema.js";
import type { AnalysisContext } from "../ai/provider.js";
import type { WeatherData } from "../lib/weather.js";
import { getReadUrl } from "../lib/storage.js";

/**
 * Builds an AnalysisContext for a single zone by loading all relevant data
 * from the database: garden metadata, zone + plants, recent care logs,
 * and sensor readings.
 */
export async function buildZoneContext(
  db: DB,
  gardenId: string,
  zoneId: string,
  weather?: WeatherData,
): Promise<AnalysisContext> {
  // 1. Load the garden
  const garden = await db.query.gardens.findFirst({
    where: eq(gardens.id, gardenId),
  });

  if (!garden) {
    throw new Error(`Garden ${gardenId} not found`);
  }

  // 2. Load the zone with its plants
  const zone = await db.query.zones.findFirst({
    where: eq(zones.id, zoneId),
    with: {
      plants: true,
    },
  });

  if (!zone) {
    throw new Error(`Zone ${zoneId} not found`);
  }

  // 3. Load recent care logs for this zone and its plants (last 14 days)
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const plantIds = zone.plants.map((p) => p.id);
  const careLogTargetIds = [zoneId, ...plantIds];

  const recentCareLogs = careLogTargetIds.length > 0
    ? await db
        .select()
        .from(careLogs)
        .where(
          and(
            inArray(careLogs.targetId, careLogTargetIds),
            gte(careLogs.loggedAt, fourteenDaysAgo),
          ),
        )
    : [];

  // 4. Load recent sensor readings for sensors in this zone (last 48 hours)
  const fortyEightHoursAgo = new Date();
  fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

  const zoneSensors = await db
    .select()
    .from(sensors)
    .where(eq(sensors.zoneId, zoneId));

  const sensorIds = zoneSensors.map((s) => s.id);

  const recentReadings = sensorIds.length > 0
    ? await db
        .select({
          sensorType: sensors.sensorType,
          value: sensorReadings.value,
          unit: sensorReadings.unit,
          recordedAt: sensorReadings.recordedAt,
        })
        .from(sensorReadings)
        .innerJoin(sensors, eq(sensorReadings.sensorId, sensors.id))
        .where(
          and(
            inArray(sensorReadings.sensorId, sensorIds),
            gte(sensorReadings.recordedAt, fortyEightHoursAgo),
          ),
        )
    : [];

  // 4.5. Load existing tasks for this zone
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const pendingTasks = await db
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.zoneId, zoneId), eq(tasks.status, "pending")),
    );

  const recentlyResolvedTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.zoneId, zoneId),
        inArray(tasks.status, ["completed", "cancelled"]),
        gte(tasks.completedAt, sevenDaysAgo),
      ),
    );

  const allTasks = [...pendingTasks, ...recentlyResolvedTasks];

  // 5. Format into AnalysisContext
  const context: AnalysisContext = {
    garden: {
      name: garden.name,
      ...(garden.hardinessZone ? { hardinessZone: garden.hardinessZone } : {}),
      ...(garden.locationLat != null && garden.locationLng != null
        ? { location: { lat: garden.locationLat, lng: garden.locationLng } }
        : {}),
    },
    zone: {
      id: zone.id,
      name: zone.name,
      ...(zone.zoneType ? { zoneType: zone.zoneType } : {}),
      ...(zone.dimensions ? { dimensions: zone.dimensions } : {}),
      ...(zone.soilType ? { soilType: zone.soilType } : {}),
      ...(zone.sunExposure ? { sunExposure: zone.sunExposure } : {}),
      plants: zone.plants.map((p) => ({
        id: p.id,
        name: p.name,
        ...(p.variety ? { variety: p.variety } : {}),
        ...(p.datePlanted
          ? { datePlanted: p.datePlanted.toISOString().split("T")[0] }
          : {}),
        ...(p.growthStage ? { growthStage: p.growthStage } : {}),
        ...(p.careProfile
          ? { careProfile: p.careProfile as Record<string, unknown> }
          : {}),
      })),
      recentCareLogs: recentCareLogs.map((log) => ({
        actionType: log.actionType,
        targetId: log.targetId,
        loggedAt: log.loggedAt.toISOString(),
        ...(log.notes ? { notes: log.notes } : {}),
      })),
      ...(recentReadings.length > 0
        ? {
            sensorReadings: recentReadings.map((r) => ({
              sensorType: r.sensorType,
              value: r.value,
              unit: r.unit,
              recordedAt: r.recordedAt.toISOString(),
            })),
          }
        : {}),
    },
    currentDate: new Date().toISOString().split("T")[0],
  };

  // Include existing tasks in context
  if (allTasks.length > 0) {
    context.existingTasks = allTasks.map((t) => ({
      id: t.id,
      targetType: t.targetType,
      targetId: t.targetId,
      actionType: t.actionType,
      priority: t.priority,
      status: t.status,
      label: t.label,
      suggestedDate: t.suggestedDate,
      ...(t.context ? { context: t.context } : {}),
      ...(t.recurrence ? { recurrence: t.recurrence } : {}),
      ...(t.photoRequested === "true" ? { photoRequested: true } : {}),
      ...(t.completedAt
        ? { completedAt: t.completedAt.toISOString() }
        : {}),
      ...(t.completedVia ? { completedVia: t.completedVia } : {}),
    }));
  }

  // 6. Include weather data if provided
  if (weather) {
    context.weather = {
      current: weather.current as unknown as Record<string, unknown>,
      forecast: weather.daily as unknown as Array<Record<string, unknown>>,
    };
  }

  return context;
}

/**
 * Gathers recent care log photos for a zone and its plants.
 * Returns photo data URLs with descriptions for AI analysis.
 *
 * Selection logic:
 * - Top 10 most recent photos from the past 7 days
 * - All photos from the last 24 hours (that weren't already in the top 10)
 * - Deduplicated by care log id
 */
export async function gatherZonePhotos(
  db: DB,
  zoneId: string,
  plantIds: string[],
): Promise<Array<{ dataUrl: string; description: string }>> {
  const targetIds = [zoneId, ...plantIds];
  if (targetIds.length === 0) return [];

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

  // Get top 10 most recent photos from last 7 days
  const recentPhotos = await db
    .select()
    .from(careLogs)
    .where(
      and(
        inArray(careLogs.targetId, targetIds),
        gte(careLogs.loggedAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(careLogs.loggedAt))
    .limit(100); // Fetch more than needed for dedup

  const withPhotos = recentPhotos.filter((log) => log.photoUrl);

  // Top 10 from 7 days
  const top10 = withPhotos.slice(0, 10);
  const top10Ids = new Set(top10.map((log) => log.id));

  // All from last 24 hours not already in top 10
  const last24h = withPhotos.filter(
    (log) => log.loggedAt >= twentyFourHoursAgo && !top10Ids.has(log.id),
  );

  const allLogs = [...top10, ...last24h];
  if (allLogs.length === 0) return [];

  // Load plant names for description building
  const plantMap = new Map<string, string>();
  if (plantIds.length > 0) {
    const plantRows = await db
      .select({ id: plants.id, name: plants.name })
      .from(plants)
      .where(inArray(plants.id, plantIds));
    for (const p of plantRows) {
      plantMap.set(p.id, p.name);
    }
  }

  // Resolve each photo to a data URL
  const results: Array<{ dataUrl: string; description: string }> = [];

  for (const log of allLogs) {
    try {
      let dataUrl: string;

      if (log.photoUrl!.startsWith("data:")) {
        // Already a data URL (base64 inline)
        dataUrl = log.photoUrl!;
      } else {
        // R2 key — fetch via signed URL
        const signedUrl = await getReadUrl(log.photoUrl!);
        const response = await fetch(signedUrl);
        if (!response.ok) continue;

        const buffer = await response.arrayBuffer();
        const contentType =
          response.headers.get("content-type") || "image/jpeg";
        const base64 = Buffer.from(buffer).toString("base64");
        dataUrl = `data:${contentType};base64,${base64}`;
      }

      const targetName =
        log.targetType === "plant"
          ? plantMap.get(log.targetId) ?? "unknown plant"
          : "zone";
      const dateStr = log.loggedAt.toISOString().split("T")[0];
      const description = `Care log photo: ${log.actionType} action on ${log.targetType} '${targetName}' (${dateStr})${log.notes ? ` — '${log.notes}'` : ""}`;

      results.push({ dataUrl, description });
    } catch (err) {
      console.error(
        `[gatherZonePhotos] Failed to fetch photo for care log ${log.id}:`,
        err,
      );
    }
  }

  return results;
}
