import { z } from "zod";
import { randomUUID } from "node:crypto";
import { router, protectedProcedure } from "../trpc.js";
import { getUploadUrl, getReadUrl } from "../lib/storage.js";

const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export const photosRouter = router({
  getUploadUrl: protectedProcedure
    .input(
      z.object({
        targetType: z.enum(["zone", "plant", "careLog"]),
        targetId: z.string().uuid(),
        contentType: z.string().default("image/jpeg"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ext = CONTENT_TYPE_EXT[input.contentType] ?? "jpg";
      const key = `${ctx.userId}/${input.targetType}/${input.targetId}/${randomUUID()}.${ext}`;

      const uploadUrl = await getUploadUrl(key);

      return { uploadUrl, key };
    }),

  getReadUrl: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      return { url: await getReadUrl(input.key) };
    }),
});
