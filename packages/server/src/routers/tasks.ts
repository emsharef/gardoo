import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { tasks, careLogs } from "../db/schema.js";
import { assertZoneOwnership } from "../lib/ownership.js";

export const tasksRouter = router({
  complete: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        notes: z.string().optional(),
        photoUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.query.tasks.findFirst({
        where: eq(tasks.id, input.taskId),
      });
      if (!task) throw new Error("Task not found");

      await assertZoneOwnership(ctx.db, task.zoneId, ctx.userId);

      if (task.status !== "pending") {
        throw new Error("Task is not pending");
      }

      const [careLog] = await ctx.db
        .insert(careLogs)
        .values({
          targetType: task.targetType,
          targetId: task.targetId,
          actionType: task.actionType,
          notes: input.notes ?? `Completed: ${task.label}`,
          photoUrl: input.photoUrl,
        })
        .returning();

      const [updated] = await ctx.db
        .update(tasks)
        .set({
          status: "completed",
          completedAt: new Date(),
          completedVia: "user",
          careLogId: careLog.id,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId))
        .returning();

      return { task: updated, careLog };
    }),

  snooze: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        newDate: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.query.tasks.findFirst({
        where: eq(tasks.id, input.taskId),
      });
      if (!task) throw new Error("Task not found");

      await assertZoneOwnership(ctx.db, task.zoneId, ctx.userId);

      if (task.status !== "pending") {
        throw new Error("Task is not pending");
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set({
          suggestedDate: input.newDate,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId))
        .returning();

      return updated;
    }),

  dismiss: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.query.tasks.findFirst({
        where: eq(tasks.id, input.taskId),
      });
      if (!task) throw new Error("Task not found");

      await assertZoneOwnership(ctx.db, task.zoneId, ctx.userId);

      if (task.status !== "pending") {
        throw new Error("Task is not pending");
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set({
          status: "cancelled",
          completedAt: new Date(),
          completedVia: "user_dismissed",
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId))
        .returning();

      return updated;
    }),
});
