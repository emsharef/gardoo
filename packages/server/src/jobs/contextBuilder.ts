import { and, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "../db/index.js";
import {
  gardens,
  zones,
  plants,
  careLogs,
  sensors,
  sensorReadings,
} from "../db/schema.js";
import type { AnalysisContext } from "../ai/provider.js";
import type { WeatherData } from "../lib/weather.js";

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

  // 6. Include weather data if provided
  if (weather) {
    context.weather = {
      current: weather.current as unknown as Record<string, unknown>,
      forecast: weather.daily as unknown as Array<Record<string, unknown>>,
    };
  }

  return context;
}
