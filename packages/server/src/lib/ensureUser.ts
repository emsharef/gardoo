import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import type { DB } from "../db/index.js";

export async function ensureUser(db: DB, userId: string, email?: string): Promise<void> {
  const existing = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true },
  });

  if (!existing) {
    await db.insert(users).values({
      id: userId,
      email: email ?? "unknown@gardoo.app",
      passwordHash: "supabase-managed",
    }).onConflictDoNothing();
  }
}
