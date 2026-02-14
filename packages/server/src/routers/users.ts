import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { users, type UserSettings } from "../db/schema.js";

export const usersRouter = router({
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: {
        settings: true,
      },
    });

    return (user?.settings ?? {}) as UserSettings;
  }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        skillLevel: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        preferredProvider: z.enum(["claude", "kimi"]).optional(),
        haUrl: z.string().optional(),
        haToken: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Merge with existing settings
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.userId),
        columns: {
          settings: true,
        },
      });

      const currentSettings = (user?.settings ?? {}) as UserSettings;
      const newSettings: UserSettings = { ...currentSettings };

      if (input.skillLevel !== undefined) {
        newSettings.skillLevel = input.skillLevel;
      }
      if (input.preferredProvider !== undefined) {
        newSettings.preferredProvider = input.preferredProvider;
      }
      if (input.haUrl !== undefined) {
        newSettings.haUrl = input.haUrl;
      }
      if (input.haToken !== undefined) {
        newSettings.haToken = input.haToken;
      }

      const [updated] = await ctx.db
        .update(users)
        .set({ settings: newSettings })
        .where(eq(users.id, ctx.userId))
        .returning({ settings: users.settings });

      return updated.settings as UserSettings;
    }),
});
