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

  validate: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["claude", "kimi"]),
        key: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        if (input.provider === "claude") {
          const Anthropic = (await import("@anthropic-ai/sdk")).default;
          const client = new Anthropic({ apiKey: input.key });
          await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 10,
            messages: [{ role: "user", content: "Say hi" }],
          });
        } else {
          const OpenAI = (await import("openai")).default;
          const client = new OpenAI({
            apiKey: input.key,
            baseURL: "https://api.moonshot.cn/v1",
          });
          await client.chat.completions.create({
            model: "moonshot-v1-8k",
            max_tokens: 10,
            messages: [{ role: "user", content: "Say hi" }],
          });
        }
        return { valid: true as const };
      } catch (err) {
        console.error(`[apiKeys.validate] ${input.provider} failed:`, err);
        return { valid: false as const };
      }
    }),
});
