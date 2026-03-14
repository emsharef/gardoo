import { z } from "zod";
import { eq, and, desc, gte, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { sensors, sensorReadings, gardens } from "../db/schema";
import {
  assertZoneOwnership,
  assertGardenOwnership,
} from "../lib/ownership";

/**
 * Validate that a sensor belongs to the authenticated user.
 * Handles both assigned sensors (via zone->garden) and unassigned sensors (via gardenId).
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
  if (!sensor) throw new Error("Sensor not found");

  if (sensor.zone) {
    if (sensor.zone.garden.userId !== userId) throw new Error("Sensor not found");
  } else {
    const garden = await db.query.gardens.findFirst({
      where: eq(gardens.id, sensor.gardenId!),
    });
    if (!garden || garden.userId !== userId) throw new Error("Sensor not found");
  }
  return sensor;
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

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        zoneId: z.string().uuid().optional(),
        sensorType: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSensorOwnership(ctx.db, input.id, ctx.userId);

      const { id, ...updates } = input;
      const [updated] = await ctx.db
        .update(sensors)
        .set(updates)
        .where(eq(sensors.id, id))
        .returning();
      return updated;
    }),

  listUnassigned: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      return ctx.db.query.sensors.findMany({
        where: and(
          eq(sensors.gardenId, input.gardenId),
          isNull(sensors.zoneId),
        ),
      });
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
