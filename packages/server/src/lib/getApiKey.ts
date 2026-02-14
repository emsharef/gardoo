import { eq, and } from "drizzle-orm";
import { type DB } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { decrypt } from "./crypto.js";

export async function getApiKey(
  db: DB,
  userId: string,
  provider: "claude" | "kimi",
): Promise<string | null> {
  const row = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)),
  });

  if (!row) {
    return null;
  }

  return decrypt(row.encryptedKey, row.iv, row.authTag);
}
