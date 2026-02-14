import { z } from "zod";
import { eq, desc, gte } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import {
  sensors,
  sensorReadings,
  users,
  type UserSettings,
} from "../db/schema.js";
import { assertZoneOwnership } from "../lib/ownership.js";
import { fetchSensorState } from "../lib/homeassistant.js";

/**
 * Get the user's Home Assistant config from their settings.
 * Throws if haUrl or haToken are not configured.
 */
async function getHAConfig(
  db: Parameters<typeof assertZoneOwnership>[0],
  userId: string,
) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { settings: true },
  });
  const settings = (user?.settings ?? {}) as UserSettings;
  if (!settings.haUrl || !settings.haToken) {
    throw new Error(
      "Home Assistant not configured. Set haUrl and haToken in user settings.",
    );
  }
  return { haUrl: settings.haUrl, haToken: settings.haToken };
}

/**
 * Validate that a sensor belongs to the authenticated user (via zone -> garden).
 * Returns the sensor row.
 */
async function assertSensorOwnership(
  db: Parameters<typeof assertZoneOwnership>[0],
  sensorId: string,
  userId: string,
) {
  const sensor = await db.query.sensors.findFirst({
    where: eq(sensors.id, sensorId),
    with: { zone: { with: { garden: true } } },
  });
  if (!sensor || sensor.zone.garden.userId !== userId) {
    throw new Error("Sensor not found");
  }
  return sensor;
}

/**
 * Core logic to read a single sensor from HA and persist the reading.
 */
async function readSensor(
  db: Parameters<typeof assertZoneOwnership>[0],
  sensorId: string,
  userId: string,
) {
  const sensor = await assertSensorOwnership(db, sensorId, userId);
  const { haUrl, haToken } = await getHAConfig(db, userId);

  const haState = await fetchSensorState(
    haUrl,
    haToken,
    sensor.haEntityId,
  );

  const numericValue = parseFloat(haState.state);
  if (isNaN(numericValue)) {
    throw new Error(
      `Sensor state "${haState.state}" is not a valid number`,
    );
  }

  const unit =
    typeof haState.attributes.unit_of_measurement === "string"
      ? haState.attributes.unit_of_measurement
      : "";

  const [reading] = await db
    .insert(sensorReadings)
    .values({
      sensorId: sensor.id,
      value: numericValue,
      unit,
    })
    .returning();

  await db
    .update(sensors)
    .set({
      lastReading: { value: numericValue, unit },
      lastReadAt: new Date(),
    })
    .where(eq(sensors.id, sensor.id));

  return reading;
}

export const sensorsRouter = router({
  list: protectedProcedure
    .input(z.object({ zoneId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertZoneOwnership(ctx.db, input.zoneId, ctx.userId);

      return ctx.db.query.sensors.findMany({
        where: eq(sensors.zoneId, input.zoneId),
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        zoneId: z.string().uuid(),
        haEntityId: z.string().min(1),
        sensorType: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertZoneOwnership(ctx.db, input.zoneId, ctx.userId);

      const [sensor] = await ctx.db
        .insert(sensors)
        .values({
          zoneId: input.zoneId,
          haEntityId: input.haEntityId,
          sensorType: input.sensorType,
        })
        .returning();
      return sensor;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertSensorOwnership(ctx.db, input.id, ctx.userId);

      await ctx.db.delete(sensors).where(eq(sensors.id, input.id));
      return { success: true as const };
    }),

  read: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return readSensor(ctx.db, input.id, ctx.userId);
    }),

  readAll: protectedProcedure
    .input(z.object({ zoneId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertZoneOwnership(ctx.db, input.zoneId, ctx.userId);

      const zoneSensors = await ctx.db.query.sensors.findMany({
        where: eq(sensors.zoneId, input.zoneId),
      });

      const results = await Promise.all(
        zoneSensors.map((s) => readSensor(ctx.db, s.id, ctx.userId)),
      );
      return results;
    }),

  getReadings: protectedProcedure
    .input(
      z.object({
        sensorId: z.string().uuid(),
        hours: z.number().positive().default(48),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertSensorOwnership(ctx.db, input.sensorId, ctx.userId);

      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);
      return ctx.db.query.sensorReadings.findMany({
        where: (sr, { and: andFn }) =>
          andFn(
            eq(sr.sensorId, input.sensorId),
            gte(sr.recordedAt, since),
          ),
        orderBy: [desc(sensorReadings.recordedAt)],
      });
    }),
});
