import { initTRPC } from "@trpc/server";

export interface Context {
  userId: string | null;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new Error("Unauthorized");
  }
  return next({ ctx: { userId: ctx.userId } });
});
