import { z } from "zod";
import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { careLogs, zones } from "../db/schema.js";
import {
  assertZoneOwnership,
  assertPlantOwnership,
  assertGardenOwnership,
} from "../lib/ownership.js";

const targetTypeSchema = z.enum(["zone", "plant"]);
const actionTypeSchema = z.enum([
  "water",
  "fertilize",
  "harvest",
  "prune",
  "plant",
  "monitor",
  "protect",
  "other",
]);

/**
 * Validate that the target (zone or plant) belongs to the authenticated user.
 */
async function assertTargetOwnership(
  db: Parameters<typeof assertZoneOwnership>[0],
  targetType: "zone" | "plant",
  targetId: string,
  userId: string,
) {
  if (targetType === "zone") {
    await assertZoneOwnership(db, targetId, userId);
  } else {
    await assertPlantOwnership(db, targetId, userId);
  }
}

export const careLogsRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        targetType: targetTypeSchema,
        targetId: z.string().uuid(),
        actionType: actionTypeSchema,
        notes: z.string().optional(),
        photoUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTargetOwnership(
        ctx.db,
        input.targetType,
        input.targetId,
        ctx.userId,
      );

      const [careLog] = await ctx.db
        .insert(careLogs)
        .values({
          targetType: input.targetType,
          targetId: input.targetId,
          actionType: input.actionType,
          notes: input.notes,
          photoUrl: input.photoUrl,
        })
        .returning();
      return careLog;
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          targetType: targetTypeSchema.optional(),
          targetId: z.string().uuid().optional(),
          gardenId: z.string().uuid().optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        })
        .refine((data) => !data.targetId || data.targetType, {
          message: "targetType is required when targetId is provided",
          path: ["targetType"],
        })
        .refine((data) => data.targetId || data.gardenId, {
          message: "Either targetId (with targetType) or gardenId is required",
          path: ["gardenId"],
        }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      if (input.targetId && input.targetType) {
        // Specific target: validate ownership and filter by it
        await assertTargetOwnership(
          ctx.db,
          input.targetType,
          input.targetId,
          ctx.userId,
        );
        conditions.push(eq(careLogs.targetType, input.targetType));
        conditions.push(eq(careLogs.targetId, input.targetId));
      } else if (input.gardenId) {
        // Garden-scoped: validate garden ownership, then scope to its targets
        await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

        const gardenZones = await ctx.db.query.zones.findMany({
          where: eq(zones.gardenId, input.gardenId),
          with: { plants: true },
        });

        const zoneIds = gardenZones.map((z) => z.id);
        const plantIds = gardenZones.flatMap((z) => z.plants.map((p) => p.id));
        const allTargetIds = [...zoneIds, ...plantIds];

        if (allTargetIds.length === 0) {
          return [];
        }

        conditions.push(inArray(careLogs.targetId, allTargetIds));

        if (input.targetType) {
          conditions.push(eq(careLogs.targetType, input.targetType));
        }
      }

      if (input.startDate) {
        conditions.push(gte(careLogs.loggedAt, new Date(input.startDate)));
      }
      if (input.endDate) {
        conditions.push(lte(careLogs.loggedAt, new Date(input.endDate)));
      }

      return ctx.db.query.careLogs.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(careLogs.loggedAt)],
      });
    }),
});
