import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { apiKeys } from "../db/schema.js";
import { encrypt } from "../lib/crypto.js";

export const apiKeysRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const keys = await ctx.db
      .select({
        id: apiKeys.id,
        provider: apiKeys.provider,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, ctx.userId));

    return keys;
  }),

  store: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["claude", "kimi"]),
        key: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Delete any existing key for this provider
      await ctx.db
        .delete(apiKeys)
        .where(
          and(
            eq(apiKeys.userId, ctx.userId),
            eq(apiKeys.provider, input.provider),
          ),
        );

      // Encrypt the key
      const { encrypted, iv, authTag } = encrypt(input.key);

      // Insert the new key
      const [inserted] = await ctx.db
        .insert(apiKeys)
        .values({
          userId: ctx.userId,
          provider: input.provider,
          encryptedKey: encrypted,
          iv,
          authTag,
        })
        .returning({
          id: apiKeys.id,
          provider: apiKeys.provider,
          createdAt: apiKeys.createdAt,
        });

      return inserted;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(apiKeys)
        .where(
          and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.userId)),
        );

      return { success: true as const };
    }),
});
