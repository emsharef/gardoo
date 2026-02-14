import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { users } from "../db/schema.js";
import { hashPassword, verifyPassword, createToken } from "../lib/auth.js";

export const authRouter = router({
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const passwordHash = await hashPassword(input.password);

      const [user] = await ctx.db
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
        })
        .returning({ id: users.id, email: users.email });

      const token = createToken(user.id);

      return { token, user: { id: user.id, email: user.email } };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string(),
        password: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.email, input.email),
      });

      if (!user) {
        throw new Error("Invalid credentials");
      }

      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) {
        throw new Error("Invalid credentials");
      }

      const token = createToken(user.id);

      return { token, user: { id: user.id, email: user.email } };
    }),
});
