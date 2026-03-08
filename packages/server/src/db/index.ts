import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  // In serverless, limit connections to avoid pool exhaustion
  max: process.env.VERCEL ? 1 : 10,
  // Supabase requires SSL for external connections
  ssl: process.env.DATABASE_URL?.includes("supabase") ? "require" : undefined,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;

// Factory for creating a db instance with a custom connection string
// (used by Trigger.dev tasks with direct connection)
export function createDb(url: string) {
  const c = postgres(url, {
    ssl: url.includes("supabase") ? "require" : undefined,
  });
  return drizzle(c, { schema });
}
