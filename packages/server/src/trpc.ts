import { initTRPC } from "@trpc/server";
import { type DB } from "./db/index";
import { createClient } from "@supabase/supabase-js";

export interface Context {
  userId: string | null;
  db: DB;
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

/**
 * Extracts the Supabase user ID from a Bearer token.
 * Used by the Next.js tRPC adapter and the SSE endpoint.
 */
export async function getUserIdFromToken(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);

  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return null;
  return user.id;
}
