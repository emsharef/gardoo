# Vercel + Supabase + Trigger.dev Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate Gardoo from Render (Fastify + pg-boss + Postgres) to Vercel (Next.js API routes) + Supabase (Postgres + Auth + Storage) + Trigger.dev (background jobs).

**Architecture:** Merge the server into the web package as Next.js API routes. Replace custom auth with Supabase Auth. Replace pg-boss with Trigger.dev tasks. Replace R2 with Supabase Storage (S3-compatible). The `packages/server` package becomes a shared library.

**Tech Stack:** Next.js 16, Supabase (Postgres + Auth + Storage), Trigger.dev v3, Drizzle ORM, tRPC 11, @anthropic-ai/sdk, openai

**Design doc:** `docs/plans/2026-03-08-vercel-supabase-migration-design.md`

---

## Prerequisites (Manual — Do Before Starting)

These are one-time setup steps done in browser dashboards. Do these first.

### Supabase Project
1. Go to https://supabase.com → create new project (free tier)
2. Note down: Project URL, anon key, service role key, JWT secret
3. Go to Settings → Database → Connection String: note the **pooler** URI (port 6543, transaction mode) and **direct** URI (port 5432)
4. Go to Storage → create bucket named `gardoo-photos` (private, no public access)
5. Go to Storage → S3 Access Keys → create new key pair. Note access key ID and secret

### Trigger.dev Project
1. Go to https://trigger.dev → create account → create project
2. Note the project ref and secret key
3. In project settings → Environment Variables, add: `ENCRYPTION_KEY` (same value as current Render env var)

### Vercel Project
1. Go to https://vercel.com → import the GitHub repo
2. Set root directory to `packages/web`
3. Don't deploy yet — we'll set env vars and push code first

---

## Task 1: Database Layer — Supabase Connection

**Files:**
- Modify: `packages/server/src/db/index.ts`
- Modify: `packages/server/drizzle.config.ts`
- Modify: `packages/server/.env`

**Step 1: Update `db/index.ts` to support pooler vs direct connections**

Replace the entire file with:

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Use pooler (port 6543) for serverless API routes, direct (port 5432) for migrations/tasks
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
  const client = postgres(url, { ssl: "require" });
  return drizzle(client, { schema });
}
```

**Step 2: Update `.env` with Supabase credentials**

Add these lines (fill in actual values from Supabase dashboard):

```
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-us-west-1.pooler.supabase.com:6543/postgres
DIRECT_DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-us-west-1.pooler.supabase.com:5432/postgres

SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=...

# Supabase Storage S3 credentials
STORAGE_S3_ENDPOINT=https://[project-ref].supabase.co/storage/v1/s3
STORAGE_S3_ACCESS_KEY=...
STORAGE_S3_SECRET_KEY=...
STORAGE_S3_BUCKET=gardoo-photos
STORAGE_S3_REGION=us-west-1
```

**Step 3: Update `drizzle.config.ts` to use direct connection for migrations**

```typescript
import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
});
```

**Step 4: Run migrations against Supabase**

Run: `cd packages/server && pnpm db:migrate`

Expected: All migrations apply successfully against Supabase Postgres.

**Step 5: Commit**

```bash
git add packages/server/src/db/index.ts packages/server/drizzle.config.ts
git commit -m "feat: update DB layer for Supabase connection pooler support"
```

---

## Task 2: Storage — R2 → Supabase Storage (S3 compat)

**Files:**
- Modify: `packages/server/src/lib/storage.ts`

**Step 1: Update storage.ts to use Supabase Storage S3 endpoint**

Replace the entire file with:

```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.STORAGE_S3_REGION || "us-west-1",
  endpoint: process.env.STORAGE_S3_ENDPOINT || process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.STORAGE_S3_ACCESS_KEY || process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.STORAGE_S3_SECRET_KEY || process.env.R2_SECRET_KEY!,
  },
  forcePathStyle: true, // Required for Supabase Storage S3
});

const BUCKET = process.env.STORAGE_S3_BUCKET || process.env.R2_BUCKET || "gardoo-photos";

export async function getUploadUrl(key: string, contentType = "image/jpeg"): Promise<string> {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn: 600 }); // 10 min
}

export async function getReadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour
}
```

**Step 2: Verify presigned URLs work**

Run: `cd packages/server && pnpm test` (existing photo-related tests should pass)

**Step 3: Commit**

```bash
git add packages/server/src/lib/storage.ts
git commit -m "feat: update storage to support Supabase Storage S3 endpoint"
```

---

## Task 3: Auth — Replace bcrypt/JWT with Supabase Auth

### Task 3a: Server-side auth context

**Files:**
- Modify: `packages/server/src/trpc.ts`
- Modify: `packages/server/src/router.ts`
- Delete: `packages/server/src/routers/auth.ts`
- Delete: `packages/server/src/lib/auth.ts`

**Step 1: Update `trpc.ts` to validate Supabase JWTs**

Replace the entire file with:

```typescript
import { initTRPC } from "@trpc/server";
import { type DB } from "./db/index.js";
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
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return null;
  return user.id;
}
```

**Step 2: Remove `authRouter` from `router.ts`**

Replace the file with:

```typescript
import { router, publicProcedure } from "./trpc.js";
import { gardensRouter } from "./routers/gardens.js";
import { zonesRouter } from "./routers/zones.js";
import { plantsRouter } from "./routers/plants.js";
import { careLogsRouter } from "./routers/careLogs.js";
import { apiKeysRouter } from "./routers/apiKeys.js";
import { photosRouter } from "./routers/photos.js";
import { chatRouter } from "./routers/chat.js";
import { usersRouter } from "./routers/users.js";
import { sensorsRouter } from "./routers/sensors.js";
import { tasksRouter } from "./routers/tasks.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" })),
  gardens: gardensRouter,
  zones: zonesRouter,
  plants: plantsRouter,
  careLogs: careLogsRouter,
  apiKeys: apiKeysRouter,
  photos: photosRouter,
  chat: chatRouter,
  users: usersRouter,
  sensors: sensorsRouter,
  tasks: tasksRouter,
});

export type AppRouter = typeof appRouter;
```

**Step 3: Delete `routers/auth.ts` and `lib/auth.ts`**

```bash
rm packages/server/src/routers/auth.ts packages/server/src/lib/auth.ts
```

**Step 4: Add `@supabase/supabase-js` to server dependencies**

```bash
cd packages/server && pnpm add @supabase/supabase-js
```

**Step 5: Remove `bcrypt` and `jsonwebtoken` from server dependencies**

```bash
cd packages/server && pnpm remove bcrypt jsonwebtoken @types/bcrypt @types/jsonwebtoken
```

**Step 6: Fix any imports of `verifyToken` elsewhere**

Search for other files importing from `lib/auth.js`. The only consumer outside `routers/auth.ts` is `index.ts` (the Fastify entry point) — which will be deleted in Task 5. The SSE endpoint will be rewritten in Task 6. No other files import `verifyToken`.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: replace custom auth with Supabase Auth on server"
```

### Task 3b: Web client auth

**Files:**
- Create: `packages/web/src/lib/supabase.ts`
- Modify: `packages/web/src/lib/auth-context.tsx`
- Modify: `packages/web/src/lib/trpc-provider.tsx`
- Modify: `packages/web/src/app/login/page.tsx`

**Step 1: Add Supabase to web dependencies**

```bash
cd packages/web && pnpm add @supabase/supabase-js @supabase/ssr
```

**Step 2: Create `supabase.ts` — browser client**

Create `packages/web/src/lib/supabase.ts`:

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

**Step 3: Rewrite `auth-context.tsx` to use Supabase**

```typescript
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { createSupabaseBrowserClient } from "./supabase";
import type { Session } from "@supabase/supabase-js";

interface AuthContextValue {
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  isAuthenticated: false,
  isLoading: true,
  logout: async () => {},
});

const supabase = createSupabaseBrowserClient();

export { supabase };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setIsLoading(false);
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isLoading && !session && pathname !== "/login") {
      router.replace("/login");
    }
  }, [isLoading, session, pathname, router]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        session,
        isAuthenticated: !!session,
        isLoading,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

**Step 4: Update `trpc-provider.tsx` to get token from Supabase session**

```typescript
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import { trpc } from "./trpc";
import { supabase } from "./auth-context";

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          async headers() {
            const { data: { session } } = await supabase.auth.getSession();
            return session?.access_token
              ? { authorization: `Bearer ${session.access_token}` }
              : {};
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

**Step 5: Rewrite `login/page.tsx` to use Supabase Auth**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const supabase = createSupabaseBrowserClient();

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-[#2D7D46]">Gardoo</h1>
          <p className="mt-1 text-sm text-gray-500">
            Garden management dashboard
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            {isRegister ? "Create Account" : "Sign In"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                placeholder="Min 8 characters"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
            >
              {isSubmitting
                ? "Loading..."
                : isRegister
                  ? "Create Account"
                  : "Sign In"}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => {
                setIsRegister(!isRegister);
                setError("");
              }}
              className="text-sm text-[#2D7D46] hover:underline"
            >
              {isRegister
                ? "Already have an account? Sign in"
                : "Need an account? Register"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 6: Update any other web files that use `useAuth().token` or `useAuth().login`**

Search for `useAuth` in the web app. The `AppShell` and other components reference `isAuthenticated` and `logout` — these still work. The `login` function is removed (Supabase handles redirect via `onAuthStateChange`). The `token` property is replaced with `session` — update any references.

The chat page uses `useAuth()` to get the token for the SSE fetch call. Update it to:
```typescript
const { session } = useAuth();
// In the fetch call:
headers: { authorization: `Bearer ${session?.access_token}` }
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: migrate web client auth to Supabase"
```

### Task 3c: Mobile client auth

**Files:**
- Create: `packages/mobile/src/lib/supabase.ts`
- Modify: `packages/mobile/src/lib/auth-store.ts`
- Modify: `packages/mobile/src/lib/trpc-provider.tsx`
- Modify: `packages/mobile/src/screens/LoginScreen.tsx`
- Modify: `packages/mobile/src/screens/RegisterScreen.tsx`

**Step 1: Add Supabase to mobile dependencies**

```bash
cd packages/mobile && pnpm add @supabase/supabase-js
```

**Step 2: Create `supabase.ts` — mobile client with SecureStore adapter**

Create `packages/mobile/src/lib/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // Not needed for React Native
    },
  },
);
```

**Step 3: Rewrite `auth-store.ts` to use Supabase session**

```typescript
import { create } from "zustand";
import { supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    // Get initial session
    const { data: { session } } = await supabase.auth.getSession();
    set({
      session,
      isAuthenticated: !!session,
      isLoading: false,
    });

    // Listen for changes
    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        isAuthenticated: !!session,
      });
    });
  },
}));
```

**Step 4: Update `trpc-provider.tsx` to get token from Supabase session**

```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import { trpc } from "./trpc";
import { supabase } from "./supabase";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000/api/trpc";

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: API_URL,
          headers: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            return session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : {};
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

**Step 5: Rewrite `LoginScreen.tsx` to use Supabase Auth**

```typescript
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    setError(null);
    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setIsLoading(false);
    if (error) {
      setError(error.message);
    }
    // Auth state change listener in auth-store handles navigation
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.form}>
        <Text style={styles.title}>Gardoo</Text>
        <Text style={styles.subtitle}>Sign in to your account</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.link}
          onPress={() => router.replace("/(auth)/register")}
        >
          <Text style={styles.linkText}>
            Don't have an account? <Text style={styles.linkBold}>Register</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// Keep existing styles unchanged
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  form: { flex: 1, justifyContent: "center", paddingHorizontal: 32 },
  title: { fontSize: 32, fontWeight: "bold", textAlign: "center", marginBottom: 4, color: "#2d6a4f" },
  subtitle: { fontSize: 16, textAlign: "center", marginBottom: 32, color: "#666" },
  error: { color: "#d32f2f", textAlign: "center", marginBottom: 16, fontSize: 14 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 12, backgroundColor: "#fafafa" },
  button: { backgroundColor: "#2d6a4f", borderRadius: 8, padding: 16, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { marginTop: 24, alignItems: "center" },
  linkText: { color: "#666", fontSize: 14 },
  linkBold: { color: "#2d6a4f", fontWeight: "600" },
});
```

**Step 6: Rewrite `RegisterScreen.tsx` similarly**

Same pattern — replace `trpc.auth.register.useMutation` with `supabase.auth.signUp({ email, password })`.

**Step 7: Update mobile root layout**

In `app/_layout.tsx`, change `loadToken()` call to `useAuthStore.getState().initialize()`. The auth state listener handles navigation.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: migrate mobile client auth to Supabase"
```

---

## Task 4: Users Table — Link to Supabase Auth

**Files:**
- Modify: `packages/server/src/db/schema.ts` (minor — the `users.id` stays as UUID, Supabase auth.users.id is also UUID)
- Modify: `packages/server/src/routers/users.ts` (add auto-create user row on first request)

**Step 1: Add ensure-user logic to the tRPC context or a shared helper**

Create a helper that auto-creates a `public.users` row if one doesn't exist for the Supabase user ID. Add this to `trpc.ts` or create `lib/ensureUser.ts`:

```typescript
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
      passwordHash: "supabase-managed", // Not used anymore, but column exists
    }).onConflictDoNothing();
  }
}
```

Call `ensureUser` in the tRPC context creation (after validating the token) so the user row always exists before any router runs.

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: auto-create users row on first Supabase auth request"
```

---

## Task 5: tRPC API Route — Mount in Next.js

**Files:**
- Create: `packages/web/src/app/api/trpc/[trpc]/route.ts`
- Modify: `packages/web/next.config.ts`
- Modify: `packages/web/package.json`

**Step 1: Add server dependencies to web package**

```bash
cd packages/web && pnpm add @trpc/server drizzle-orm postgres @anthropic-ai/sdk openai @aws-sdk/client-s3 @aws-sdk/s3-request-presigner zod @trigger.dev/sdk
```

**Step 2: Move `@gardoo/server` from devDependencies to dependencies in web `package.json`**

It now imports runtime code (the router), not just types.

**Step 3: Update `next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@gardoo/server"],
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
```

**Step 4: Create the tRPC route handler**

Create `packages/web/src/app/api/trpc/[trpc]/route.ts`:

```typescript
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@gardoo/server/src/router";
import { getUserIdFromToken } from "@gardoo/server/src/trpc";
import { db } from "@gardoo/server/src/db/index";
import { ensureUser } from "@gardoo/server/src/lib/ensureUser";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async ({ req }) => {
      const authHeader = req.headers.get("authorization");
      const userId = await getUserIdFromToken(authHeader);

      if (userId) {
        await ensureUser(db, userId);
      }

      return { userId, db };
    },
  });

export { handler as GET, handler as POST };
```

**Step 5: Verify build**

Run: `cd packages/web && pnpm build`

Expected: Build succeeds. The tRPC route handler compiles.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: mount tRPC router as Next.js API route"
```

---

## Task 6: SSE Chat Streaming — Next.js Route Handler

**Files:**
- Create: `packages/web/src/app/api/chat/stream/route.ts`
- Modify: `packages/web/src/app/chat/page.tsx` (change fetch URL)

**Step 1: Create the SSE streaming route handler**

Create `packages/web/src/app/api/chat/stream/route.ts`:

```typescript
import { getUserIdFromToken } from "@gardoo/server/src/trpc";
import { db } from "@gardoo/server/src/db/index";
import { conversations, type ChatMessage } from "@gardoo/server/src/db/schema";
import { eq, and } from "drizzle-orm";
import {
  buildGardenChatContext,
  buildChatSystemPrompt,
  resolveProvider,
} from "@gardoo/server/src/routers/chat";
import { parseActions, executeAction } from "@gardoo/server/src/ai/chatActions";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  // 1. Auth
  const authHeader = request.headers.get("authorization");
  const userId = await getUserIdFromToken(authHeader);

  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Parse body
  const body = await request.json();
  const { conversationId, content, imageBase64, imageKey } = body;

  if (!conversationId || !content) {
    return new Response(JSON.stringify({ error: "Missing conversationId or content" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Load conversation
  const conv = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.userId, userId),
    ),
  });

  if (!conv) {
    return new Response(JSON.stringify({ error: "Conversation not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 4. Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const existingMessages = conv.messages as ChatMessage[];

        // Append user message
        const userMessage: ChatMessage = {
          role: "user",
          content,
          timestamp: new Date().toISOString(),
          ...(imageKey ? { imageUrl: imageKey } : {}),
        };
        const updatedMessages = [...existingMessages, userMessage];

        // Auto-title
        let title = conv.title;
        if (existingMessages.length === 0) {
          title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
        }

        // Build context & resolve provider
        const chatContext = await buildGardenChatContext(
          db,
          conv.gardenId,
          userId,
          { includeAnalysis: true },
        );
        const { provider, apiKey } = await resolveProvider(db, userId);
        const systemPrompt = buildChatSystemPrompt(chatContext, true);

        const aiMessages = updatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // Stream
        const result = await provider.chatStream(
          aiMessages,
          systemPrompt,
          apiKey,
          (chunk) => {
            controller.enqueue(
              encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`),
            );
          },
          imageBase64,
        );

        // Parse and execute actions
        const { cleanText, parsedActions } = parseActions(result.content);

        const actionResults = [];
        for (const action of parsedActions) {
          const actionResult = await executeAction(
            db,
            conv.gardenId,
            userId,
            action,
          );
          actionResults.push(actionResult);
        }

        // Persist conversation
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: cleanText,
          timestamp: new Date().toISOString(),
          ...(actionResults.length > 0 ? { actions: actionResults } : {}),
        };
        updatedMessages.push(assistantMessage);

        await db
          .update(conversations)
          .set({
            title,
            messages: updatedMessages,
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, conversationId));

        // Done event
        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({
              actions: actionResults,
              tokensUsed: result.tokensUsed,
              cleanText,
            })}\n\n`,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[chat-stream] Error:", err);
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

**Step 2: Update chat page fetch URL**

In `packages/web/src/app/chat/page.tsx`, change the `getApiBaseUrl` function and fetch call:

Find:
```typescript
const getApiBaseUrl = () =>
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/trpc").replace(
    /\/trpc$/,
    "",
```

Replace with:
```typescript
const getApiBaseUrl = () => "";
```

This makes the fetch URL `/api/chat/stream` (relative, same origin).

Also update the auth header to use the Supabase session token:
```typescript
const { session } = useAuth();
// ...
headers: {
  "Content-Type": "application/json",
  ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
},
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: SSE chat streaming as Next.js route handler"
```

---

## Task 7: Gardens Router — Replace pg-boss with Trigger.dev

**Files:**
- Modify: `packages/server/src/routers/gardens.ts`

**Step 1: Update `triggerAnalysis` to use Trigger.dev SDK**

Replace the import of `getJobQueue` and the two procedures:

```typescript
// Remove this import:
// import { getJobQueue } from "../jobs/index.js";

// Add this import:
import { tasks } from "@trigger.dev/sdk/v3";

// Replace triggerAnalysis:
triggerAnalysis: protectedProcedure
  .input(z.object({ gardenId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

    await tasks.trigger("analyze-garden", { gardenId: input.gardenId });

    return { queued: true as const };
  }),

// Replace getAnalysisStatus:
getAnalysisStatus: protectedProcedure
  .input(z.object({ gardenId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

    // Check for recent analysis results instead of pgboss.job table
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recent = await ctx.db.query.analysisResults.findFirst({
      where: and(
        eq(analysisResults.gardenId, input.gardenId),
        gte(analysisResults.generatedAt, fiveMinutesAgo),
      ),
      orderBy: [desc(analysisResults.generatedAt)],
    });

    // If there's a result from the last 5 minutes, analysis is done or in progress
    // This is an approximation — for real-time status, use Trigger.dev runs API
    return { running: false, pendingJobs: 0, lastResult: recent?.generatedAt?.toISOString() ?? null };
  }),
```

Add the missing `gte` import at the top of the file:
```typescript
import { eq, and, desc, sql, inArray, gte } from "drizzle-orm";
```

**Step 2: Commit**

```bash
git add packages/server/src/routers/gardens.ts
git commit -m "feat: replace pg-boss with Trigger.dev SDK in gardens router"
```

---

## Task 8: Trigger.dev Tasks — Daily Analysis Pipeline

**Files:**
- Create: `trigger.config.ts` (repo root)
- Create: `trigger/daily-analysis.ts`
- Create: `trigger/analyze-garden.ts`
- Create: `trigger/analyze-zone.ts`

**Step 1: Create `trigger.config.ts` at repo root**

```typescript
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "<your-trigger-dev-project-ref>", // e.g. "proj_abc123"
  dirs: ["trigger"],
  build: {
    external: ["postgres"],
  },
});
```

**Step 2: Install Trigger.dev SDK at the repo root**

```bash
pnpm add -w @trigger.dev/sdk
```

**Step 3: Create `trigger/daily-analysis.ts`**

```typescript
import { schedules, task } from "@trigger.dev/sdk/v3";
import { createDb } from "@gardoo/server/src/db/index";
import { gardens } from "@gardoo/server/src/db/schema";

// Import the child task for triggering
import { analyzeGarden } from "./analyze-garden";

const db = createDb(process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!);

export const dailyAnalysis = schedules.task({
  id: "daily-analysis",
  cron: "0 6 * * *", // Daily at 06:00 UTC
  run: async () => {
    console.log("[daily-analysis] Starting daily analysis run");

    const allGardens = await db.select({ id: gardens.id }).from(gardens);

    console.log(`[daily-analysis] Found ${allGardens.length} gardens to analyze`);

    if (allGardens.length > 0) {
      await analyzeGarden.batchTrigger(
        allGardens.map((g) => ({ payload: { gardenId: g.id } })),
      );
    }

    console.log("[daily-analysis] All garden jobs enqueued");
  },
});
```

**Step 4: Create `trigger/analyze-garden.ts`**

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { eq } from "drizzle-orm";
import { createDb } from "@gardoo/server/src/db/index";
import { gardens, weatherCache } from "@gardoo/server/src/db/schema";
import { fetchWeather, type WeatherData } from "@gardoo/server/src/lib/weather";
import { analyzeZone } from "./analyze-zone";

const db = createDb(process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!);

export const analyzeGarden = task({
  id: "analyze-garden",
  retry: { maxAttempts: 2 },
  run: async (payload: { gardenId: string }) => {
    const { gardenId } = payload;
    console.log(`[analyze-garden] Processing garden ${gardenId}`);

    const garden = await db.query.gardens.findFirst({
      where: eq(gardens.id, gardenId),
      with: { zones: true },
    });

    if (!garden) {
      console.warn(`[analyze-garden] Garden ${gardenId} not found, skipping`);
      return;
    }

    // Fetch and cache weather
    let weather: WeatherData | undefined;
    if (garden.locationLat != null && garden.locationLng != null) {
      try {
        weather = await fetchWeather(garden.locationLat, garden.locationLng);
        await db.insert(weatherCache).values({
          gardenId: garden.id,
          forecast: weather,
          fetchedAt: new Date(),
        });
        console.log(`[analyze-garden] Weather cached for garden ${gardenId}`);
      } catch (err) {
        console.error(`[analyze-garden] Failed to fetch weather:`, err);
      }
    }

    // Fan out to per-zone analysis
    if (garden.zones.length > 0) {
      await analyzeZone.batchTriggerAndWait(
        garden.zones.map((zone) => ({
          payload: {
            gardenId: garden.id,
            zoneId: zone.id,
            userId: garden.userId,
            ...(weather ? { weather } : {}),
          },
        })),
      );
    }

    console.log(`[analyze-garden] Completed analysis for garden ${gardenId}`);
  },
});
```

**Step 5: Create `trigger/analyze-zone.ts`**

This reuses the existing business logic from `contextBuilder.ts` and the AI providers:

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { and, eq } from "drizzle-orm";
import { createDb } from "@gardoo/server/src/db/index";
import {
  users,
  analysisResults,
  tasks as tasksTable,
  type AnalysisResult,
  type UserSettings,
} from "@gardoo/server/src/db/schema";
import { getApiKey } from "@gardoo/server/src/lib/getApiKey";
import { ClaudeProvider } from "@gardoo/server/src/ai/claude";
import { KimiProvider } from "@gardoo/server/src/ai/kimi";
import type { AIProvider } from "@gardoo/server/src/ai/provider";
import { analysisResultSchema } from "@gardoo/server/src/ai/schema";
import { buildZoneContext, gatherZonePhotos } from "@gardoo/server/src/jobs/contextBuilder";
import type { WeatherData } from "@gardoo/server/src/lib/weather";

const db = createDb(process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!);

export const analyzeZone = task({
  id: "analyze-zone",
  retry: { maxAttempts: 3, minTimeoutInMs: 10_000 },
  run: async (payload: {
    gardenId: string;
    zoneId: string;
    userId: string;
    weather?: WeatherData;
  }) => {
    const { gardenId, zoneId, userId, weather } = payload;
    console.log(`[analyze-zone] Processing zone ${zoneId} in garden ${gardenId}`);

    // Determine AI provider
    let apiKey = await getApiKey(db, userId, "claude");
    let provider: AIProvider = new ClaudeProvider();
    let modelUsed = "claude";

    if (!apiKey) {
      apiKey = await getApiKey(db, userId, "kimi");
      provider = new KimiProvider();
      modelUsed = "kimi";
    }

    if (!apiKey) {
      console.warn(`[analyze-zone] No API key found for user ${userId}, skipping`);
      return;
    }

    // Load user settings
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { settings: true },
    });
    const userSettings = (user?.settings ?? {}) as UserSettings;

    // Build context
    const context = await buildZoneContext(db, gardenId, zoneId, weather, userSettings);

    // Gather photos
    const plantIds = context.zone.plants.map((p) => p.id);
    try {
      const photos = await gatherZonePhotos(db, zoneId, plantIds);
      if (photos.length > 0) {
        context.photos = photos;
        console.log(`[analyze-zone] Attached ${photos.length} photo(s)`);
      }
    } catch (err) {
      console.error(`[analyze-zone] Failed to gather photos:`, err);
    }

    // Call AI
    const { result, tokensUsed } = await provider.analyzeZone(context, apiKey);

    // Validate
    const validated = analysisResultSchema.parse(result);

    const dbResult: AnalysisResult = {
      operations: validated.operations,
      observations: validated.observations ?? [],
      alerts: validated.alerts ?? [],
    };

    // Store audit log
    const [analysisRow] = await db
      .insert(analysisResults)
      .values({
        gardenId,
        scope: "zone",
        targetId: zoneId,
        result: dbResult,
        modelUsed,
        tokensUsed,
        generatedAt: new Date(),
      })
      .returning();

    // Apply operations (same logic as original handleAnalyzeZone)
    for (const op of validated.operations) {
      try {
        switch (op.op) {
          case "create": {
            await db.insert(tasksTable).values({
              gardenId,
              zoneId,
              targetType: op.targetType,
              targetId: op.targetId,
              actionType: op.actionType,
              priority: op.priority,
              status: "pending",
              label: op.label,
              suggestedDate: op.suggestedDate,
              context: op.context ?? null,
              recurrence: op.recurrence ?? null,
              photoRequested: op.photoRequested ? "true" : "false",
              sourceAnalysisId: analysisRow.id,
            });
            break;
          }
          case "update": {
            const existing = await db.query.tasks.findFirst({
              where: and(
                eq(tasksTable.id, op.taskId!),
                eq(tasksTable.zoneId, zoneId),
                eq(tasksTable.status, "pending"),
              ),
            });
            if (!existing) break;
            const updates: Record<string, unknown> = {
              updatedAt: new Date(),
              sourceAnalysisId: analysisRow.id,
            };
            if (op.suggestedDate !== undefined) updates.suggestedDate = op.suggestedDate;
            if (op.priority !== undefined) updates.priority = op.priority;
            if (op.label !== undefined) updates.label = op.label;
            if (op.context !== undefined) updates.context = op.context;
            if (op.recurrence !== undefined) updates.recurrence = op.recurrence;
            if (op.photoRequested !== undefined)
              updates.photoRequested = op.photoRequested ? "true" : "false";
            await db.update(tasksTable).set(updates).where(eq(tasksTable.id, op.taskId!));
            break;
          }
          case "complete": {
            const existing = await db.query.tasks.findFirst({
              where: and(
                eq(tasksTable.id, op.taskId!),
                eq(tasksTable.zoneId, zoneId),
                eq(tasksTable.status, "pending"),
              ),
            });
            if (!existing) break;
            await db
              .update(tasksTable)
              .set({
                status: "completed",
                completedAt: new Date(),
                completedVia: "ai",
                context: op.reason ?? existing.context,
                updatedAt: new Date(),
                sourceAnalysisId: analysisRow.id,
              })
              .where(eq(tasksTable.id, op.taskId!));
            break;
          }
          case "cancel": {
            const existing = await db.query.tasks.findFirst({
              where: and(
                eq(tasksTable.id, op.taskId!),
                eq(tasksTable.zoneId, zoneId),
                eq(tasksTable.status, "pending"),
              ),
            });
            if (!existing) break;
            await db
              .update(tasksTable)
              .set({
                status: "cancelled",
                completedAt: new Date(),
                completedVia: "ai",
                context: op.reason ?? existing.context,
                updatedAt: new Date(),
                sourceAnalysisId: analysisRow.id,
              })
              .where(eq(tasksTable.id, op.taskId!));
            break;
          }
        }
      } catch (opErr) {
        console.error(`[analyze-zone] Failed to apply ${op.op} operation:`, opErr);
      }
    }

    console.log(
      `[analyze-zone] Done: zone ${zoneId} (${modelUsed}, ${tokensUsed.input + tokensUsed.output} tokens, ${validated.operations.length} ops)`,
    );
  },
});
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Trigger.dev tasks for daily analysis pipeline"
```

---

## Task 9: Delete Old Server Infrastructure

**Files:**
- Delete: `packages/server/src/index.ts`
- Delete: `packages/server/src/jobs/index.ts`
- Delete: `packages/server/src/jobs/dailyAnalysis.ts`

**Step 1: Delete the files**

```bash
rm packages/server/src/index.ts
rm packages/server/src/jobs/index.ts
rm packages/server/src/jobs/dailyAnalysis.ts
```

**Step 2: Remove unused dependencies from server `package.json`**

```bash
cd packages/server && pnpm remove fastify @fastify/cors fastify-plugin pg-boss dotenv
```

**Step 3: Update server `package.json` scripts**

Remove `dev`, `start` scripts (no longer a standalone server). Keep `build`, `test`, `typecheck`, `db:*` scripts.

**Step 4: Fix any broken imports**

Search for imports of deleted files. The `gardens.ts` router previously imported `getJobQueue` from `jobs/index.js` — this was already replaced in Task 7. The `contextBuilder.ts` is kept (it's imported by Trigger.dev tasks).

**Step 5: Run typecheck**

Run: `cd packages/server && pnpm typecheck`

Expected: No errors (auth.ts, index.ts, jobs/index.ts, jobs/dailyAnalysis.ts are all deleted; remaining files should compile).

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: delete Fastify server, pg-boss, and old job handlers"
```

---

## Task 10: Environment Variables & Vercel Config

**Files:**
- Modify: `packages/web/.env.local` (create for local dev)

**Step 1: Create `.env.local` for the web package**

```
# Supabase (client-side)
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Supabase (server-side only)
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-us-west-1.pooler.supabase.com:6543/postgres

# API key encryption
ENCRYPTION_KEY=...

# Supabase Storage S3
STORAGE_S3_ENDPOINT=https://[project-ref].supabase.co/storage/v1/s3
STORAGE_S3_ACCESS_KEY=...
STORAGE_S3_SECRET_KEY=...
STORAGE_S3_BUCKET=gardoo-photos
STORAGE_S3_REGION=us-west-1
```

**Step 2: Set the same env vars in Vercel dashboard**

Go to Vercel project → Settings → Environment Variables. Add all the above (without `NEXT_PUBLIC_` prefix for server-only vars, with prefix for client vars).

**Step 3: Set Trigger.dev env vars**

In Trigger.dev dashboard → Environment Variables:
- `DATABASE_URL` (direct connection, port 5432)
- `ENCRYPTION_KEY`
- `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY`, `STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`

**Step 4: Add `.env.local` to `.gitignore` if not already**

**Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore: add .env.local to gitignore for Vercel env vars"
```

---

## Task 11: Build, Test & Deploy

**Step 1: Run full build**

```bash
cd packages/web && pnpm build
```

Expected: Build succeeds.

**Step 2: Run server tests**

```bash
cd packages/server && pnpm test
```

Expected: Tests that don't depend on deleted files pass. Tests for auth router will need to be removed or updated.

**Step 3: Run typecheck across all packages**

```bash
pnpm typecheck
```

Expected: No type errors.

**Step 4: Deploy Trigger.dev tasks**

```bash
npx trigger.dev@latest deploy
```

Expected: Tasks deploy to Trigger.dev cloud.

**Step 5: Push to master and let Vercel auto-deploy**

```bash
git push origin master
```

Expected: Vercel builds and deploys the web app. The API routes are live at `https://<vercel-url>/api/trpc`.

**Step 6: Test the live deployment**

- Visit `https://<vercel-url>` — web app loads
- Register a new account — Supabase Auth handles it
- Create a garden, zones, plants
- Trigger analysis — Trigger.dev task runs
- Test chat streaming — SSE works through the Next.js route handler

**Step 7: Update mobile env vars and test**

Update `EXPO_PUBLIC_API_URL` to `https://<vercel-url>/api/trpc`.
Add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

**Step 8: Shut down Render services**

Once everything is confirmed working:
- Suspend or delete `gardoo-server` on Render
- Suspend or delete `gardoo-web` on Render
- Keep `gardoo-db` until you've confirmed all data is in Supabase (or delete if starting fresh)

---

## Task 12: Cleanup

**Step 1: Remove `render.yaml` or mark it as deprecated**

**Step 2: Update `CLAUDE.md`**

Update the deployment section to reference Vercel + Supabase + Trigger.dev instead of Render.

**Step 3: Update `.env` documentation**

Update any env var references to reflect the new Supabase/Vercel setup.

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: update docs for Vercel + Supabase + Trigger.dev deployment"
```
