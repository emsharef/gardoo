# Gardoo MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full-stack AI-powered garden management app where users track plants, zones, and care activities, and receive AI-generated recommendations via Claude or Kimi APIs using their own API keys.

**Architecture:** Monorepo with three packages — a Fastify/tRPC backend with Postgres and pg-boss for scheduled jobs, a React Native (Expo) iOS app as the primary client, and a Next.js web dashboard for viewing garden state and analysis. All AI calls route through the server. Users bring their own API keys (stored encrypted). Background jobs run daily analysis per garden and deliver structured action recommendations rendered as inventory badges and calendar entries.

**Tech Stack:** TypeScript (monorepo via pnpm workspaces), Fastify + tRPC (API), Drizzle ORM + Postgres (data), pg-boss (jobs), Expo/React Native (iOS), Next.js (web), Cloudflare R2 (photos), Vercel AI SDK (multi-model), Render (hosting), Open-Meteo (weather fallback)

---

## Phase 1: Project Scaffolding & Database

### Task 1: Initialize Monorepo

**Files:**
- Create: `package.json` (root workspace config)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.nvmrc`

**Step 1: Initialize git repo**

```bash
cd /Users/esharef/Documents/Fun/Vibe/gardoo
git init
```

**Step 2: Create root package.json**

```json
{
  "name": "gardoo",
  "private": true,
  "scripts": {
    "dev:server": "pnpm --filter @gardoo/server dev",
    "dev:web": "pnpm --filter @gardoo/web dev",
    "dev:mobile": "pnpm --filter @gardoo/mobile start",
    "db:generate": "pnpm --filter @gardoo/server db:generate",
    "db:migrate": "pnpm --filter @gardoo/server db:migrate",
    "db:studio": "pnpm --filter @gardoo/server db:studio",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  },
  "engines": {
    "node": ">=20"
  }
}
```

**Step 3: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

**Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Step 5: Create .nvmrc**

```
20
```

**Step 6: Create .gitignore**

```
node_modules/
dist/
.env
.env.local
*.db
.expo/
ios/
android/
.next/
.turbo/
coverage/
```

**Step 7: Install pnpm and initialize**

```bash
pnpm install
```

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: initialize monorepo with pnpm workspaces"
```

---

### Task 2: Set Up Server Package with Fastify + tRPC

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/trpc.ts`
- Create: `packages/server/src/router.ts`

**Step 1: Create server package.json**

```json
{
  "name": "@gardoo/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@trpc/server": "^11",
    "fastify": "^5",
    "fastify-plugin": "^5",
    "@fastify/cors": "^10",
    "trpc-fastify-adapter": "^1",
    "drizzle-orm": "^0.39",
    "postgres": "^3",
    "pg-boss": "^10",
    "zod": "^3",
    "dotenv": "^16"
  },
  "devDependencies": {
    "typescript": "^5",
    "tsx": "^4",
    "vitest": "^3",
    "drizzle-kit": "^0.30",
    "@types/node": "^20"
  }
}
```

**Step 2: Create server tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create tRPC initialization (src/trpc.ts)**

```typescript
import { initTRPC } from "@trpc/server";
import { z } from "zod";

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
```

**Step 4: Create root router (src/router.ts)**

```typescript
import { router, publicProcedure } from "./trpc.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" })),
});

export type AppRouter = typeof appRouter;
```

**Step 5: Create Fastify server entry (src/index.ts)**

```typescript
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  fastifyTRPCPlugin,
  FastifyTRPCPluginOptions,
} from "trpc-fastify-adapter";
import { appRouter, type AppRouter } from "./router.js";
import { type Context } from "./trpc.js";
import "dotenv/config";

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });

await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext: (): Context => ({
      userId: null, // TODO: extract from auth header
    }),
  } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
});

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

await server.listen({ port, host });
console.log(`Server listening on ${host}:${port}`);
```

**Step 6: Install dependencies and verify it compiles**

```bash
cd /Users/esharef/Documents/Fun/Vibe/gardoo
pnpm install
pnpm --filter @gardoo/server typecheck
```

**Step 7: Start server and test health endpoint**

```bash
pnpm dev:server &
curl http://localhost:3000/trpc/health
# Expected: {"result":{"data":{"status":"ok"}}}
```

**Step 8: Commit**

```bash
git add packages/server/
git commit -m "feat: add Fastify + tRPC server package with health endpoint"
```

---

### Task 3: Database Schema with Drizzle

**Files:**
- Create: `packages/server/src/db/index.ts`
- Create: `packages/server/src/db/schema.ts`
- Create: `packages/server/drizzle.config.ts`
- Create: `packages/server/.env.example`

**Step 1: Create .env.example and local .env**

```bash
# .env.example
DATABASE_URL=postgres://gardoo:gardoo@localhost:5432/gardoo
ENCRYPTION_KEY=generate-a-32-byte-hex-key-here
```

The developer should copy this to `.env` and start a local Postgres instance (e.g., `brew services start postgresql` or Docker).

**Step 2: Create database schema (src/db/schema.ts)**

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  real,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const aiProviderEnum = pgEnum("ai_provider", ["claude", "kimi"]);
export const targetTypeEnum = pgEnum("target_type", ["zone", "plant"]);
export const actionTypeEnum = pgEnum("action_type", [
  "water",
  "fertilize",
  "harvest",
  "prune",
  "plant",
  "monitor",
  "protect",
  "other",
]);
export const priorityEnum = pgEnum("priority", [
  "urgent",
  "today",
  "upcoming",
  "informational",
]);
export const analysisScopeEnum = pgEnum("analysis_scope", [
  "zone",
  "plant",
  "garden",
]);

// Tables
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  settings: jsonb("settings").$type<{
    timezone?: string;
    hardinessZone?: string;
    skillLevel?: "beginner" | "intermediate" | "advanced";
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: aiProviderEnum("provider").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const gardens = pgTable("gardens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  locationLat: real("location_lat"),
  locationLng: real("location_lng"),
  hardinessZone: text("hardiness_zone"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  gardenId: uuid("garden_id")
    .notNull()
    .references(() => gardens.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  photoUrl: text("photo_url"),
  soilType: text("soil_type"),
  sunExposure: text("sun_exposure"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const plants = pgTable("plants", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  variety: text("variety"),
  species: text("species"),
  datePlanted: timestamp("date_planted"),
  growthStage: text("growth_stage"),
  photoUrl: text("photo_url"),
  careProfile: jsonb("care_profile").$type<{
    waterFrequencyDays?: number;
    sunNeeds?: string;
    fertilizerNotes?: string;
    companionPlants?: string[];
    incompatiblePlants?: string[];
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const careLogs = pgTable("care_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetType: targetTypeEnum("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  actionType: actionTypeEnum("action_type").notNull(),
  notes: text("notes"),
  photoUrl: text("photo_url"),
  loggedAt: timestamp("logged_at").defaultNow().notNull(),
});

export const sensors = pgTable("sensors", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id, { onDelete: "cascade" }),
  haEntityId: text("ha_entity_id").notNull(),
  sensorType: text("sensor_type").notNull(),
  lastReading: jsonb("last_reading"),
  lastReadAt: timestamp("last_read_at"),
});

export const sensorReadings = pgTable("sensor_readings", {
  id: uuid("id").primaryKey().defaultRandom(),
  sensorId: uuid("sensor_id")
    .notNull()
    .references(() => sensors.id, { onDelete: "cascade" }),
  value: real("value").notNull(),
  unit: text("unit").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

export const analysisResults = pgTable("analysis_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  gardenId: uuid("garden_id")
    .notNull()
    .references(() => gardens.id, { onDelete: "cascade" }),
  scope: analysisScopeEnum("scope").notNull(),
  targetId: uuid("target_id"),
  result: jsonb("result")
    .notNull()
    .$type<{
      actions: Array<{
        targetType: "zone" | "plant";
        targetId: string;
        actionType: string;
        priority: "urgent" | "today" | "upcoming" | "informational";
        label: string;
        suggestedDate: string;
        context?: string;
        recurrence?: string;
      }>;
      observations?: string[];
      alerts?: string[];
    }>(),
  modelUsed: text("model_used"),
  tokensUsed: jsonb("tokens_used").$type<{
    input: number;
    output: number;
  }>(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export const weatherCache = pgTable("weather_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  gardenId: uuid("garden_id")
    .notNull()
    .references(() => gardens.id, { onDelete: "cascade" }),
  forecast: jsonb("forecast").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
  gardens: many(gardens),
}));

export const gardensRelations = relations(gardens, ({ one, many }) => ({
  user: one(users, { fields: [gardens.userId], references: [users.id] }),
  zones: many(zones),
  analysisResults: many(analysisResults),
  weatherCache: many(weatherCache),
}));

export const zonesRelations = relations(zones, ({ one, many }) => ({
  garden: one(gardens, { fields: [zones.gardenId], references: [gardens.id] }),
  plants: many(plants),
  sensors: many(sensors),
}));

export const plantsRelations = relations(plants, ({ one }) => ({
  zone: one(zones, { fields: [plants.zoneId], references: [zones.id] }),
}));

export const sensorsRelations = relations(sensors, ({ one, many }) => ({
  zone: one(zones, { fields: [sensors.zoneId], references: [zones.id] }),
  readings: many(sensorReadings),
}));

export const sensorReadingsRelations = relations(
  sensorReadings,
  ({ one }) => ({
    sensor: one(sensors, {
      fields: [sensorReadings.sensorId],
      references: [sensors.id],
    }),
  })
);
```

**Step 3: Create DB connection (src/db/index.ts)**

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);

export const db = drizzle(client, { schema });
export type DB = typeof db;
```

**Step 4: Create drizzle.config.ts**

```typescript
import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**Step 5: Generate and run initial migration**

```bash
pnpm --filter @gardoo/server db:generate
pnpm --filter @gardoo/server db:migrate
```

**Step 6: Verify with drizzle studio**

```bash
pnpm --filter @gardoo/server db:studio
# Open browser to verify tables were created
```

**Step 7: Commit**

```bash
git add packages/server/
git commit -m "feat: add Drizzle schema with full garden data model"
```

---

### Task 4: Simple Auth (Email/Password + JWT)

**Files:**
- Create: `packages/server/src/lib/auth.ts`
- Create: `packages/server/src/lib/crypto.ts`
- Create: `packages/server/src/routers/auth.ts`
- Modify: `packages/server/src/router.ts`
- Modify: `packages/server/src/trpc.ts`
- Test: `packages/server/src/routers/__tests__/auth.test.ts`

Since this is personal use for now, keep auth simple: bcrypt password hashing, JWT tokens, no email verification.

**Step 1: Write auth test**

```typescript
// packages/server/src/routers/__tests__/auth.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller } from "../../test-utils.js";

describe("auth router", () => {
  it("should register a new user", async () => {
    const caller = await createTestCaller();
    const result = await caller.auth.register({
      email: "test@gardoo.app",
      password: "testpass123",
    });
    expect(result.token).toBeDefined();
    expect(result.user.email).toBe("test@gardoo.app");
  });

  it("should login with correct credentials", async () => {
    const caller = await createTestCaller();
    await caller.auth.register({
      email: "login@gardoo.app",
      password: "testpass123",
    });
    const result = await caller.auth.login({
      email: "login@gardoo.app",
      password: "testpass123",
    });
    expect(result.token).toBeDefined();
  });

  it("should reject wrong password", async () => {
    const caller = await createTestCaller();
    await caller.auth.register({
      email: "wrong@gardoo.app",
      password: "testpass123",
    });
    await expect(
      caller.auth.login({
        email: "wrong@gardoo.app",
        password: "wrongpass",
      })
    ).rejects.toThrow("Invalid credentials");
  });
});
```

**Step 2: Create test utilities (src/test-utils.ts)**

```typescript
import { appRouter } from "./router.js";
import { db } from "./db/index.js";

export async function createTestCaller(userId?: string) {
  return appRouter.createCaller({ userId: userId ?? null, db });
}
```

Note: The `Context` type and router will need `db` added — update `trpc.ts` context to include `db: DB`.

**Step 3: Implement crypto helpers (src/lib/crypto.ts)**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY not set");
  return Buffer.from(key, "hex");
}

export function encrypt(plaintext: string): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return {
    encrypted,
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

export function decrypt(encrypted: string, iv: string, authTag: string): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

**Step 4: Implement auth helpers (src/lib/auth.ts)**

```typescript
import { hash, compare } from "bcrypt";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hashed: string
): Promise<boolean> {
  return compare(password, hashed);
}

export function createToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: string } {
  return jwt.verify(token, JWT_SECRET) as { userId: string };
}
```

**Step 5: Implement auth router (src/routers/auth.ts)**

```typescript
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, createToken } from "../lib/auth.js";

export const authRouter = router({
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8),
      })
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
      return { token, user };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (!user) throw new Error("Invalid credentials");
      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) throw new Error("Invalid credentials");
      const token = createToken(user.id);
      return { token, user: { id: user.id, email: user.email } };
    }),
});
```

**Step 6: Update trpc.ts context to include db, update router.ts to include authRouter**

Update `src/trpc.ts` — add `db` to Context:

```typescript
import type { DB } from "./db/index.js";

export interface Context {
  userId: string | null;
  db: DB;
}
```

Update `src/router.ts`:

```typescript
import { router, publicProcedure } from "./trpc.js";
import { authRouter } from "./routers/auth.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" })),
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
```

Update `src/index.ts` to pass `db` in context:

```typescript
import { db } from "./db/index.js";

// In createContext:
createContext: (): Context => ({
  userId: null, // TODO: extract from JWT
  db,
}),
```

**Step 7: Add bcrypt and jsonwebtoken dependencies**

```bash
pnpm --filter @gardoo/server add bcrypt jsonwebtoken
pnpm --filter @gardoo/server add -D @types/bcrypt @types/jsonwebtoken
```

**Step 8: Run tests**

```bash
pnpm --filter @gardoo/server test
```

Expected: All 3 auth tests pass.

**Step 9: Commit**

```bash
git add packages/server/
git commit -m "feat: add auth with email/password registration and JWT login"
```

---

## Phase 2: Core Garden CRUD API

### Task 5: Garden, Zone, Plant CRUD Routers

**Files:**
- Create: `packages/server/src/routers/gardens.ts`
- Create: `packages/server/src/routers/zones.ts`
- Create: `packages/server/src/routers/plants.ts`
- Create: `packages/server/src/routers/careLogs.ts`
- Modify: `packages/server/src/router.ts`
- Test: `packages/server/src/routers/__tests__/gardens.test.ts`
- Test: `packages/server/src/routers/__tests__/zones.test.ts`
- Test: `packages/server/src/routers/__tests__/plants.test.ts`

Each router follows the same pattern — list, get, create, update, delete — using `protectedProcedure` and scoped to the authenticated user's data.

**Step 1: Write garden CRUD tests**

Test that a user can create a garden, list their gardens, update a garden, and delete one. Test that a user cannot see another user's garden. Focus on the happy path and the ownership boundary.

**Step 2: Implement gardens router**

```typescript
// packages/server/src/routers/gardens.ts
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { gardens } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export const gardensRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.gardens.findMany({
      where: eq(gardens.userId, ctx.userId),
      with: { zones: { with: { plants: true } } },
    });
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const garden = await ctx.db.query.gardens.findFirst({
        where: and(
          eq(gardens.id, input.id),
          eq(gardens.userId, ctx.userId)
        ),
        with: { zones: { with: { plants: true, sensors: true } } },
      });
      if (!garden) throw new Error("Garden not found");
      return garden;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        locationLat: z.number().optional(),
        locationLng: z.number().optional(),
        hardinessZone: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [garden] = await ctx.db
        .insert(gardens)
        .values({ ...input, userId: ctx.userId })
        .returning();
      return garden;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        locationLat: z.number().optional(),
        locationLng: z.number().optional(),
        hardinessZone: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const [garden] = await ctx.db
        .update(gardens)
        .set(updates)
        .where(and(eq(gardens.id, id), eq(gardens.userId, ctx.userId)))
        .returning();
      if (!garden) throw new Error("Garden not found");
      return garden;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(gardens)
        .where(
          and(eq(gardens.id, input.id), eq(gardens.userId, ctx.userId))
        );
      return { success: true };
    }),
});
```

**Step 3: Implement zones router** — same CRUD pattern, scoped to a garden the user owns. Validate that the parent garden belongs to the user.

**Step 4: Implement plants router** — same pattern, scoped to a zone within a user's garden.

**Step 5: Implement careLogs router** — create (log an action), list (by target or by date range). Validate target ownership.

**Step 6: Wire all routers into src/router.ts**

```typescript
import { gardensRouter } from "./routers/gardens.js";
import { zonesRouter } from "./routers/zones.js";
import { plantsRouter } from "./routers/plants.js";
import { careLogsRouter } from "./routers/careLogs.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" })),
  auth: authRouter,
  gardens: gardensRouter,
  zones: zonesRouter,
  plants: plantsRouter,
  careLogs: careLogsRouter,
});
```

**Step 7: Run all tests**

```bash
pnpm --filter @gardoo/server test
```

**Step 8: Commit**

```bash
git add packages/server/
git commit -m "feat: add CRUD routers for gardens, zones, plants, and care logs"
```

---

### Task 6: API Key Management Router

**Files:**
- Create: `packages/server/src/routers/apiKeys.ts`
- Test: `packages/server/src/routers/__tests__/apiKeys.test.ts`
- Modify: `packages/server/src/router.ts`

**Step 1: Write tests** — test storing a key, listing keys (should show provider and created date but NOT the key itself), deleting a key.

**Step 2: Implement apiKeys router**

```typescript
// packages/server/src/routers/apiKeys.ts
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { apiKeys } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "../lib/crypto.js";

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
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Delete existing key for this provider
      await ctx.db
        .delete(apiKeys)
        .where(
          and(
            eq(apiKeys.userId, ctx.userId),
            eq(apiKeys.provider, input.provider)
          )
        );
      const { encrypted, iv, authTag } = encrypt(input.key);
      const [stored] = await ctx.db
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
      return stored;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(apiKeys)
        .where(
          and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.userId))
        );
      return { success: true };
    }),
});
```

**Step 3: Add internal helper to retrieve decrypted key for server-side use**

```typescript
// packages/server/src/lib/getApiKey.ts
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { decrypt } from "./crypto.js";

export async function getApiKey(
  userId: string,
  provider: "claude" | "kimi"
): Promise<string | null> {
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))
    .limit(1);
  if (!key) return null;
  return decrypt(key.encryptedKey, key.iv, key.authTag);
}
```

**Step 4: Run tests, commit**

```bash
pnpm --filter @gardoo/server test
git add packages/server/
git commit -m "feat: add encrypted API key storage and management"
```

---

## Phase 3: Photo Upload

### Task 7: Photo Upload via Presigned URLs

**Files:**
- Create: `packages/server/src/lib/storage.ts`
- Create: `packages/server/src/routers/photos.ts`
- Modify: `packages/server/src/router.ts`

**Step 1: Add S3 client dependency**

```bash
pnpm --filter @gardoo/server add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**Step 2: Create storage helper (src/lib/storage.ts)**

```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET || "gardoo-photos";

export async function getUploadUrl(key: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 600 }); // 10 min
}

export async function getReadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour
}
```

**Step 3: Create photos router**

```typescript
// packages/server/src/routers/photos.ts
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { router, protectedProcedure } from "../trpc.js";
import { getUploadUrl } from "../lib/storage.js";

export const photosRouter = router({
  getUploadUrl: protectedProcedure
    .input(
      z.object({
        targetType: z.enum(["zone", "plant", "careLog"]),
        targetId: z.string().uuid(),
        contentType: z.string().default("image/jpeg"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ext = input.contentType === "image/png" ? "png" : "jpg";
      const key = `${ctx.userId}/${input.targetType}/${input.targetId}/${randomUUID()}.${ext}`;
      const uploadUrl = await getUploadUrl(key);
      return { uploadUrl, key };
    }),
});
```

The mobile/web client will:
1. Call `photos.getUploadUrl` to get a presigned URL and storage key
2. PUT the image directly to R2 using the presigned URL
3. Save the `key` on the zone/plant/careLog record via the update mutation

**Step 4: Wire into router, commit**

```bash
git add packages/server/
git commit -m "feat: add photo upload via R2 presigned URLs"
```

---

## Phase 4: AI Analysis Pipeline

### Task 8: AI Provider Abstraction

**Files:**
- Create: `packages/server/src/ai/provider.ts`
- Create: `packages/server/src/ai/claude.ts`
- Create: `packages/server/src/ai/kimi.ts`
- Create: `packages/server/src/ai/schema.ts`
- Test: `packages/server/src/ai/__tests__/provider.test.ts`

**Step 1: Define the analysis output schema (src/ai/schema.ts)**

```typescript
import { z } from "zod";

export const analysisActionSchema = z.object({
  targetType: z.enum(["zone", "plant"]),
  targetId: z.string().uuid(),
  actionType: z.enum([
    "water",
    "fertilize",
    "harvest",
    "prune",
    "plant",
    "monitor",
    "protect",
    "other",
  ]),
  priority: z.enum(["urgent", "today", "upcoming", "informational"]),
  label: z.string().max(60),
  suggestedDate: z.string(),
  context: z.string().max(200).optional(),
  recurrence: z.string().optional(),
});

export const analysisResultSchema = z.object({
  actions: z.array(analysisActionSchema),
  observations: z.array(z.string()).optional(),
  alerts: z.array(z.string()).optional(),
});

export type AnalysisAction = z.infer<typeof analysisActionSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
```

**Step 2: Define provider interface (src/ai/provider.ts)**

```typescript
import type { AnalysisResult } from "./schema.js";

export interface AnalysisContext {
  garden: {
    name: string;
    hardinessZone?: string;
    location?: { lat: number; lng: number };
  };
  zone: {
    id: string;
    name: string;
    soilType?: string;
    sunExposure?: string;
    plants: Array<{
      id: string;
      name: string;
      variety?: string;
      datePlanted?: string;
      growthStage?: string;
      careProfile?: Record<string, unknown>;
    }>;
    recentCareLogs: Array<{
      actionType: string;
      targetId: string;
      loggedAt: string;
      notes?: string;
    }>;
    sensorReadings?: Array<{
      sensorType: string;
      value: number;
      unit: string;
      recordedAt: string;
    }>;
  };
  weather?: {
    current: Record<string, unknown>;
    forecast: Array<Record<string, unknown>>;
  };
  currentDate: string;
  userSkillLevel?: string;
}

export interface AIProvider {
  analyzeZone(
    context: AnalysisContext,
    apiKey: string,
    photoUrls?: string[]
  ): Promise<{
    result: AnalysisResult;
    tokensUsed: { input: number; output: number };
  }>;

  chat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    systemPrompt: string,
    apiKey: string,
    imageBase64?: string
  ): Promise<{ content: string; tokensUsed: { input: number; output: number } }>;
}
```

**Step 3: Implement Claude provider (src/ai/claude.ts)**

Uses the Anthropic SDK. Build the system prompt with garden/zone context, request structured JSON output matching the schema. For vision, include photos as base64 image content blocks.

**Step 4: Implement Kimi provider (src/ai/kimi.ts)**

Uses the OpenAI-compatible API. Same logic adapted for the OpenAI message format and image_url content type.

**Step 5: Write tests** — mock API responses and verify the provider correctly parses structured output and validates against the schema. Test error handling for invalid API keys, malformed responses.

**Step 6: Run tests, commit**

```bash
pnpm --filter @gardoo/server test
git add packages/server/
git commit -m "feat: add AI provider abstraction for Claude and Kimi"
```

---

### Task 9: Weather Integration

**Files:**
- Create: `packages/server/src/lib/weather.ts`
- Test: `packages/server/src/lib/__tests__/weather.test.ts`

**Step 1: Implement Open-Meteo client**

```typescript
// packages/server/src/lib/weather.ts

interface WeatherData {
  current: {
    temperature: number;
    humidity: number;
    windSpeed: number;
    weatherCode: number;
  };
  daily: Array<{
    date: string;
    tempMax: number;
    tempMin: number;
    precipitationProbability: number;
    weatherCode: number;
  }>;
}

export async function fetchWeather(
  lat: number,
  lng: number
): Promise<WeatherData> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lng.toString());
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code"
  );
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code"
  );
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
  const data = await res.json();

  return {
    current: {
      temperature: data.current.temperature_2m,
      humidity: data.current.relative_humidity_2m,
      windSpeed: data.current.wind_speed_10m,
      weatherCode: data.current.weather_code,
    },
    daily: data.daily.time.map((date: string, i: number) => ({
      date,
      tempMax: data.daily.temperature_2m_max[i],
      tempMin: data.daily.temperature_2m_min[i],
      precipitationProbability:
        data.daily.precipitation_probability_max[i],
      weatherCode: data.daily.weather_code[i],
    })),
  };
}
```

**Step 2: Write test with mocked fetch, commit**

---

### Task 10: Background Analysis Job with pg-boss

**Files:**
- Create: `packages/server/src/jobs/index.ts`
- Create: `packages/server/src/jobs/dailyAnalysis.ts`
- Create: `packages/server/src/jobs/contextBuilder.ts`
- Modify: `packages/server/src/index.ts`

**Step 1: Create pg-boss initialization (src/jobs/index.ts)**

```typescript
import PgBoss from "pg-boss";

let boss: PgBoss;

export async function initJobQueue(): Promise<PgBoss> {
  boss = new PgBoss(process.env.DATABASE_URL!);
  await boss.start();

  // Schedule daily analysis for all gardens — runs every day at 06:00 UTC
  await boss.schedule("daily-analysis-trigger", "0 6 * * *");
  boss.work("daily-analysis-trigger", handleDailyTrigger);
  boss.work("analyze-garden", handleAnalyzeGarden);
  boss.work("analyze-zone", handleAnalyzeZone);

  return boss;
}

export function getJobQueue(): PgBoss {
  return boss;
}
```

**Step 2: Create context builder (src/jobs/contextBuilder.ts)**

This module queries Postgres for a zone's full context — the parent garden, all plants in the zone, recent care logs (last 14 days), recent sensor readings (last 48 hours) — and formats it into the `AnalysisContext` shape the AI provider expects. Also fetches weather (from cache or fresh from Open-Meteo).

**Step 3: Create daily analysis job handler (src/jobs/dailyAnalysis.ts)**

```typescript
// Pseudocode for the flow:

async function handleDailyTrigger() {
  // 1. List all gardens
  // 2. For each garden, enqueue an "analyze-garden" job
}

async function handleAnalyzeGarden(job) {
  const gardenId = job.data.gardenId;
  // 1. Load garden with zones
  // 2. Fetch and cache weather
  // 3. For each zone, enqueue an "analyze-zone" job
}

async function handleAnalyzeZone(job) {
  const { gardenId, zoneId, userId } = job.data;
  // 1. Get user's preferred AI provider and API key
  // 2. Build context via contextBuilder
  // 3. Call AI provider's analyzeZone
  // 4. Validate result against schema
  // 5. Store in analysis_results table
}
```

**Step 4: Wire pg-boss into server startup**

```typescript
// In src/index.ts, after server.listen:
import { initJobQueue } from "./jobs/index.js";
await initJobQueue();
```

**Step 5: Test the context builder with unit tests. Test the job handler with mocked AI provider.**

**Step 6: Commit**

```bash
git add packages/server/
git commit -m "feat: add pg-boss background analysis pipeline with daily scheduling"
```

---

### Task 11: Chat Router (Server-Routed AI Conversations)

**Files:**
- Create: `packages/server/src/routers/chat.ts`
- Modify: `packages/server/src/router.ts`

**Step 1: Implement chat router**

The chat endpoint takes a message (and optionally a photo), injects garden/zone context as a system prompt, calls the user's AI provider, and returns the response. Messages are not persisted server-side for v1 — the client manages conversation history and sends the full message array each time.

```typescript
export const chatRouter = router({
  send: protectedProcedure
    .input(
      z.object({
        gardenId: z.string().uuid(),
        zoneId: z.string().uuid().optional(),
        plantId: z.string().uuid().optional(),
        messages: z.array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          })
        ),
        imageBase64: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Build system prompt from garden/zone/plant context
      // 2. Get user's API key and provider preference
      // 3. Call provider.chat()
      // 4. Return response
    }),
});
```

**Step 2: Test, commit**

---

## Phase 5: Mobile App (Expo/React Native)

### Task 12: Initialize Expo App

**Files:**
- Create: `packages/mobile/` (Expo scaffolding)

**Step 1: Create Expo app**

```bash
cd /Users/esharef/Documents/Fun/Vibe/gardoo/packages
npx create-expo-app@latest mobile --template tabs
```

**Step 2: Configure for monorepo** — update `packages/mobile/package.json` name to `@gardoo/mobile`, configure Metro bundler to resolve packages from the monorepo root.

**Step 3: Add tRPC client dependencies**

```bash
cd /Users/esharef/Documents/Fun/Vibe/gardoo
pnpm --filter @gardoo/mobile add @trpc/client @trpc/react-query @tanstack/react-query
```

**Step 4: Create tRPC client hook**

```typescript
// packages/mobile/src/lib/trpc.ts
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@gardoo/server/src/router";

export const trpc = createTRPCReact<AppRouter>();
```

**Step 5: Verify it builds for iOS**

```bash
pnpm --filter @gardoo/mobile ios
```

**Step 6: Commit**

```bash
git add packages/mobile/
git commit -m "feat: initialize Expo app with tRPC client"
```

---

### Task 13: Auth Screens

**Files:**
- Create: `packages/mobile/src/screens/LoginScreen.tsx`
- Create: `packages/mobile/src/screens/RegisterScreen.tsx`
- Create: `packages/mobile/src/lib/authStore.ts`

Simple email/password forms. Store JWT in expo-secure-store. Redirect to home on success.

**Step 1: Implement secure token storage using expo-secure-store**

**Step 2: Build login screen** — email input, password input, submit button, link to register.

**Step 3: Build register screen** — email input, password input, confirm password, submit.

**Step 4: Add auth state management** — store token, provide `isAuthenticated` check, wrap app in auth guard.

**Step 5: Test on iOS simulator, commit**

---

### Task 14: Home Screen — Today's Actions

**Files:**
- Create: `packages/mobile/src/screens/HomeScreen.tsx`
- Create: `packages/mobile/src/components/ActionCard.tsx`
- Create: `packages/mobile/src/components/WeatherHeader.tsx`

The home screen fetches cached analysis results from the server and renders them as a prioritized action list.

**Step 1: Build WeatherHeader** — shows current temp, conditions, and today's forecast summary.

**Step 2: Build ActionCard** — displays one recommended action with priority badge, label, target name, and a "done" button. Tapping "done" creates a care log entry.

**Step 3: Build HomeScreen** — fetches analysis actions for today, groups by priority (urgent first, then today, then upcoming), renders as a flat list. Pull-to-refresh triggers a new analysis.

**Step 4: Test on simulator, commit**

---

### Task 15: Inventory Screens — Zones and Plants

**Files:**
- Create: `packages/mobile/src/screens/GardenScreen.tsx`
- Create: `packages/mobile/src/screens/ZoneDetailScreen.tsx`
- Create: `packages/mobile/src/screens/PlantDetailScreen.tsx`
- Create: `packages/mobile/src/components/ZoneCard.tsx`
- Create: `packages/mobile/src/components/PlantCard.tsx`
- Create: `packages/mobile/src/components/StatusBadge.tsx`

**Step 1: Build ZoneCard** — hero photo, zone name, plant count, status badge (derived from latest analysis), pending action count.

**Step 2: Build GardenScreen** — lists all zones as cards. FAB to add a new zone (name, photo, soil type, sun exposure).

**Step 3: Build PlantCard** — photo, plant name, variety, status badge, next action tag.

**Step 4: Build ZoneDetailScreen** — zone header with photo and metadata, list of plants, recent care logs, sensor readings (if any), and zone-level analysis observations. Expandable context for each observation.

**Step 5: Build PlantDetailScreen** — plant photo gallery (latest + history), care profile, care log timeline, current analysis actions with expandable context.

**Step 6: Add/edit flows** — forms for creating and editing zones and plants. Include photo capture via expo-image-picker, upload to R2 via presigned URL.

**Step 7: Test on simulator, commit**

---

### Task 16: Care Logging

**Files:**
- Create: `packages/mobile/src/screens/LogActionScreen.tsx`
- Create: `packages/mobile/src/components/ActionTypeSelector.tsx`

**Step 1: Build ActionTypeSelector** — grid of action type buttons (water, fertilize, harvest, prune, etc.) with icons.

**Step 2: Build LogActionScreen** — select action type, optional notes, optional photo. Pre-populated with target zone/plant from navigation context. Quick log from action cards on home screen bypasses this and logs directly.

**Step 3: Commit**

---

### Task 17: Chat Screen

**Files:**
- Create: `packages/mobile/src/screens/ChatScreen.tsx`
- Create: `packages/mobile/src/components/ChatBubble.tsx`
- Create: `packages/mobile/src/components/PhotoAttachButton.tsx`

**Step 1: Build ChatBubble** — user and assistant message rendering with markdown support.

**Step 2: Build ChatScreen** — message list, text input, send button, photo attach button. Routes through server chat endpoint. Maintains conversation history in local state. Context (garden/zone/plant) injected from navigation params — shown as a header chip so the user knows what Claude is reasoning about.

**Step 3: Navigable from any detail screen** — tap a chat icon on a zone or plant detail page to open chat with that context pre-loaded.

**Step 4: Commit**

---

### Task 18: Calendar View

**Files:**
- Create: `packages/mobile/src/screens/CalendarScreen.tsx`
- Create: `packages/mobile/src/components/CalendarDay.tsx`

**Step 1: Build CalendarScreen** — monthly calendar view. Days with actions show dot indicators. Tap a day to see that day's actions (from analysis) and logged care activities. Weather forecast icons on upcoming days.

**Step 2: Commit**

---

### Task 19: Settings Screen

**Files:**
- Create: `packages/mobile/src/screens/SettingsScreen.tsx`

**Step 1: Build SettingsScreen** — API key management (add/remove Claude and Kimi keys), preferred AI provider selection, garden metadata (location, hardiness zone), Home Assistant connection (URL + token), and skill level selector.

**Step 2: Commit**

---

## Phase 6: Web Dashboard (Next.js)

### Task 20: Initialize Next.js Web App

**Files:**
- Create: `packages/web/` (Next.js scaffolding)

**Step 1: Create Next.js app**

```bash
cd /Users/esharef/Documents/Fun/Vibe/gardoo/packages
npx create-next-app@latest web --typescript --tailwind --app --src-dir
```

**Step 2: Configure for monorepo** — name `@gardoo/web`, set up tRPC client pointing to the same server.

**Step 3: Commit**

---

### Task 21: Web Dashboard Pages

**Files:**
- Create: `packages/web/src/app/page.tsx` (home — today's actions)
- Create: `packages/web/src/app/garden/page.tsx` (inventory)
- Create: `packages/web/src/app/garden/[zoneId]/page.tsx` (zone detail)
- Create: `packages/web/src/app/calendar/page.tsx`
- Create: `packages/web/src/app/settings/page.tsx`

The web dashboard is a read-heavy companion to the mobile app. It shares the same tRPC API.

**Step 1: Build home page** — today's actions list + weather. Same data as mobile home screen.

**Step 2: Build inventory page** — zone cards in a grid layout. Click through to zone detail with plant list.

**Step 3: Build calendar page** — monthly view with actions and logs.

**Step 4: Build settings page** — API key management, garden config.

**Step 5: Style with Tailwind, keep it functional (personal use — polish later).**

**Step 6: Commit**

---

## Phase 7: Home Assistant Integration

### Task 22: Home Assistant Sensor Bridge

**Files:**
- Create: `packages/server/src/lib/homeassistant.ts`
- Create: `packages/server/src/routers/sensors.ts`
- Modify: `packages/server/src/router.ts`

**Step 1: Create HA client (src/lib/homeassistant.ts)**

```typescript
export async function fetchSensorState(
  haUrl: string,
  haToken: string,
  entityId: string
): Promise<{ state: string; attributes: Record<string, unknown>; lastChanged: string }> {
  const res = await fetch(`${haUrl}/api/states/${entityId}`, {
    headers: { Authorization: `Bearer ${haToken}` },
  });
  if (!res.ok) throw new Error(`HA API error: ${res.status}`);
  return res.json();
}

export async function fetchWeatherFromHA(
  haUrl: string,
  haToken: string,
  entityId: string
): Promise<Record<string, unknown>> {
  return fetchSensorState(haUrl, haToken, entityId);
}
```

**Step 2: Create sensors router** — CRUD for sensor config (assign HA entity ID to a zone), endpoint to trigger a manual sensor read, endpoint for the mobile app to push readings it pulled from local HA.

**Step 3: Add a job to poll sensors for users with Nabu Casa (remote-accessible HA)** — runs hourly, reads sensor states, stores in `sensor_readings`.

**Step 4: Test, commit**

---

## Phase 8: Deployment

### Task 23: Render Deployment Configuration

**Files:**
- Create: `render.yaml` (Blueprint / Infrastructure as Code)
- Create: `packages/server/Dockerfile`

**Step 1: Create Dockerfile for server**

```dockerfile
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --filter @gardoo/server

COPY packages/server packages/server
RUN pnpm --filter @gardoo/server build

EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
```

**Step 2: Create render.yaml**

```yaml
services:
  - type: web
    name: gardoo-server
    runtime: docker
    dockerfilePath: packages/server/Dockerfile
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: gardoo-db
          property: connectionString
      - key: ENCRYPTION_KEY
        generateValue: true
      - key: JWT_SECRET
        generateValue: true
      - key: R2_ENDPOINT
        sync: false
      - key: R2_ACCESS_KEY
        sync: false
      - key: R2_SECRET_KEY
        sync: false
      - key: R2_BUCKET
        value: gardoo-photos

  - type: web
    name: gardoo-web
    buildCommand: pnpm --filter @gardoo/web build
    startCommand: pnpm --filter @gardoo/web start
    envVars:
      - key: NEXT_PUBLIC_API_URL
        value: https://gardoo-server.onrender.com

databases:
  - name: gardoo-db
    plan: starter
```

**Step 3: Commit**

```bash
git add render.yaml packages/server/Dockerfile
git commit -m "chore: add Render deployment config"
```

---

## Task Dependency Summary

```
Phase 1: [T1] → [T2] → [T3] → [T4]
Phase 2: [T4] → [T5] → [T6]
Phase 3: [T5] → [T7]
Phase 4: [T6] → [T8] → [T9] → [T10] → [T11]
Phase 5: [T2,T5] → [T12] → [T13] → [T14,T15,T16,T17,T18,T19] (parallel)
Phase 6: [T2,T5] → [T20] → [T21]
Phase 7: [T5,T8] → [T22]
Phase 8: [all] → [T23]

Phases 2-4 (server) and Phase 5-6 (clients) can proceed in parallel
once Phase 1 and Task 5 are complete.
```

---

## Open Decisions (flag during implementation)

- **Prompt template wording** — the exact system prompts for zone analysis and chat need iteration based on real output quality. Start simple, refine.
- **Sensor reading frequency** — hourly polling may be too much or too little. Make it configurable per sensor.
- **Photo resize dimensions** — 1024px long edge is a starting point. May need adjustment based on vision model performance vs. token cost.
- **Calendar library** — choose during Task 18. `react-native-calendars` is the standard choice.
- **Markdown rendering in chat** — choose during Task 17. `react-native-markdown-display` or similar.
