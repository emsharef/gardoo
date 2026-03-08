# Gardoo: Render → Vercel + Supabase + Trigger.dev Migration

## Summary

Migrate from Render (Fastify + pg-boss + Postgres) to Vercel (Next.js API routes) + Supabase (Postgres + Auth + Storage) + Trigger.dev (background jobs). The server package becomes a shared library; the web package becomes the single deployment target. Big-bang cutover — no incremental migration.

## Architecture

**Before:**
```
Mobile App ──► Render: Fastify (tRPC + SSE + pg-boss) ──► Render: Postgres
Web App    ──►                                             Cloudflare R2
```

**After:**
```
Mobile App ──► Vercel: Next.js (tRPC API routes + SSE route handler) ──► Supabase: Postgres
Web App    ──►                                                           Supabase: Auth
               Trigger.dev: cron + analysis tasks ──────────────────────► Supabase: Storage
```

- `packages/server` stays in the monorepo as a shared library (exports router, schema, AI logic, helpers)
- `packages/web` is the single Vercel deployment — imports the server's router and mounts it as API routes
- `trigger/` directory contains Trigger.dev task definitions, deployed separately via CLI/CI

## Database: Render Postgres → Supabase Postgres

Drizzle ORM works identically. All 11 tables and queries stay the same.

**Changes:**
- `DATABASE_URL` → Supabase connection pooler (PgBouncer, port 6543, transaction mode) for serverless API routes
- `DIRECT_DATABASE_URL` → Supabase direct connection (port 5432) for migrations and Trigger.dev tasks
- Migrations run as a CI step (`drizzle-kit migrate`) instead of on server startup
- `pgboss` schema tables get dropped

**`db/index.ts` changes:**
- Accept a connection string parameter (pooler vs direct depending on caller)
- Or export two clients: one for API routes (pooler), one for tasks (direct)

**Data migration:** `pg_dump` from Render → `psql` import to Supabase, or start fresh.

## Auth: Custom bcrypt/JWT → Supabase Auth

Supabase Auth handles registration, login, token issuance, and refresh. Both clients use `@supabase/supabase-js` for auth operations.

### Server side (tRPC context)

The `trpc.ts` context factory changes from:
```
Extract Bearer token → verifyToken(jwt) → { userId }
```
To:
```
Extract Bearer token → supabase.auth.getUser(token) → { userId: user.id }
```

Or validate the JWT locally using Supabase's JWT secret for lower latency.

### `public.users` table

Kept for app-specific settings (timezone, skillLevel, units, haUrl, haToken). The `id` column becomes the Supabase `auth.users.id` UUID. Row created on first authenticated request or via a Supabase DB trigger on `auth.users` insert.

### Web client

- `auth-context.tsx` → initialize Supabase client, use `supabase.auth.onAuthStateChange()` for session state
- `login/page.tsx` → `supabase.auth.signInWithPassword()` / `supabase.auth.signUp()`
- `trpc-provider.tsx` → get token via `supabase.auth.getSession()` for the Authorization header

### Mobile client

- Add `@supabase/supabase-js` dependency
- Configure Supabase client with `ExpoSecureStoreAdapter` for secure token persistence
- `auth-store.ts` → Zustand store tracks `isAuthenticated` from Supabase auth state, no longer stores raw JWT
- Login/register screens → Supabase SDK calls instead of tRPC mutations
- `trpc-provider.tsx` → get fresh token from `supabase.auth.getSession()` per request

### Deleted

- `lib/auth.ts` (bcrypt + jsonwebtoken)
- `routers/auth.ts` (register + login)
- `bcrypt`, `jsonwebtoken` dependencies

## API: Fastify tRPC → Next.js API Route

### New file: `packages/web/src/app/api/trpc/[trpc]/route.ts`

~30-line adapter using `fetchRequestHandler` from `@trpc/server/adapters/fetch`. Imports `appRouter` from the server package. Context factory extracts the Supabase JWT from request headers.

All existing tRPC routers work unchanged except:

**`gardens.triggerAnalysis`:** Replace `getJobQueue().send('analyze-garden', ...)` with `tasks.trigger("analyze-garden", { gardenId })` via Trigger.dev SDK.

**`gardens.getAnalysisStatus`:** Replace `pgboss.job` table query with a query against `analysis_results` table (already written on job completion).

### `router.ts`

Remove `authRouter` from the merged router.

### Dependencies added to `packages/web`

- `drizzle-orm`, `postgres` — DB
- `@anthropic-ai/sdk`, `openai` — AI
- `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` — storage (or Supabase Storage SDK)
- `@supabase/supabase-js` — auth + storage
- `@trigger.dev/sdk` — trigger background jobs
- `zod` — validation

### `next.config.ts`

Add `serverExternalPackages: ["postgres"]` so the native Postgres driver isn't webpack-bundled.

### Client URL changes

- Web: `NEXT_PUBLIC_API_URL` default changes to `/api/trpc` (relative, same origin)
- Mobile: `EXPO_PUBLIC_API_URL` changes to `https://<vercel-url>/api/trpc`

## Chat Streaming: Fastify SSE → Next.js Route Handler

### New file: `packages/web/src/app/api/chat/stream/route.ts`

A `POST` route handler with `export const runtime = 'nodejs'` (needed for Anthropic SDK + node:crypto).

Logic:
1. Validate auth token from request header
2. Parse JSON body (conversationId, content, imageBase64, imageKey)
3. Load conversation, resolve AI provider, build context
4. Return `new Response(readableStream, { headers: { 'Content-Type': 'text/event-stream' } })`
5. Inside the stream: call `provider.chatStream()`, write `delta` events via `controller.enqueue()`
6. After stream completes: parse actions, execute them, persist message, write `done` event

### Web client change

`chat/page.tsx`: Change fetch URL from `${apiBase}/api/chat/stream` to `/api/chat/stream`. The `parseSSEEvents` helper and `ReadableStream` consumption loop stay unchanged.

### Mobile

No change — mobile uses non-streaming `chat.send` tRPC mutation.

## Background Jobs: pg-boss → Trigger.dev v3

### New files

**`trigger/daily-analysis.ts`**
- `schedules.task({ id: "daily-analysis", cron: "0 6 * * *" })`
- Queries all gardens, calls `analyzeGarden.batchTrigger(gardens.map(...))`

**`trigger/analyze-garden.ts`**
- `task({ id: "analyze-garden" })`
- Loads garden + zones, fetches weather, caches it
- Calls `analyzeZone.batchTriggerAndWait(zones.map(...))`

**`trigger/analyze-zone.ts`**
- `task({ id: "analyze-zone" })`
- Reuses `buildZoneContext()` and `gatherZonePhotos()` from `jobs/contextBuilder.ts`
- Reuses AI providers from `ai/`
- Decrypts API key, calls AI, parses response, applies task operations, stores audit log
- 10-60 second execution — no timeout concern on Trigger.dev

**`trigger.config.ts` (repo root)**
- Project ref pointing to Trigger.dev project
- `build.externals: ["postgres"]`
- `dirs: ["trigger"]` (or wherever the task files live)

### Connecting the API

- `gardens.triggerAnalysis` → `tasks.trigger("analyze-garden", { gardenId })`
- `gardens.getAnalysisStatus` → query `analysis_results` table for recent results by gardenId

### What stays

`jobs/contextBuilder.ts` — pure business logic (DB queries + photo fetching), imported by Trigger.dev tasks unchanged.

### What gets deleted

- `jobs/index.ts` (pg-boss init, worker registration)
- `jobs/dailyAnalysis.ts` (three handlers → replaced by Trigger.dev task files)
- `pg-boss` dependency
- `SIGTERM` shutdown handler in `index.ts`

### Deployment

`npx trigger.dev@latest deploy` via GitHub Actions on push to master, after Vercel deploy.

### Cost

~5 zones daily, ~30s each on Small 1x machine → well under $1/month, within the $5 free credit.

## Photo Storage: Cloudflare R2 → Supabase Storage (S3 compat)

Supabase Storage exposes an S3-compatible endpoint. The migration is a credentials/endpoint swap.

**`lib/storage.ts` changes:**
- S3 client endpoint → Supabase Storage S3 endpoint
- Credentials → Supabase Storage access key/secret
- Region → Supabase project region
- Bucket name → new Supabase Storage bucket

**No changes needed in:**
- `routers/photos.ts` — still calls `getUploadUrl()` / `getReadUrl()`
- `jobs/contextBuilder.ts` — `gatherZonePhotos()` still fetches via presigned URLs

Supabase Storage free tier: 1GB storage, 2GB bandwidth — sufficient for a personal garden app.

## File Changes Summary

### Deleted
| File | Reason |
|------|--------|
| `server/src/index.ts` | Fastify server + SSE + pg-boss init |
| `server/src/jobs/index.ts` | pg-boss setup |
| `server/src/jobs/dailyAnalysis.ts` | Replaced by Trigger.dev tasks |
| `server/src/routers/auth.ts` | Replaced by Supabase Auth |
| `server/src/lib/auth.ts` | bcrypt/JWT replaced by Supabase |

### Unchanged
| File | Reason |
|------|--------|
| `server/src/db/schema.ts` | Same Drizzle schema |
| `server/src/routers/zones.ts` | Pure tRPC |
| `server/src/routers/plants.ts` | Pure tRPC |
| `server/src/routers/careLogs.ts` | Pure tRPC |
| `server/src/routers/tasks.ts` | Pure tRPC |
| `server/src/routers/users.ts` | Pure tRPC |
| `server/src/routers/sensors.ts` | Pure tRPC |
| `server/src/routers/chat.ts` | Pure tRPC (procedures, not SSE) |
| `server/src/ai/*` | Stateless AI providers + schemas |
| `server/src/jobs/contextBuilder.ts` | Pure business logic |
| `server/src/lib/weather.ts` | Pure fetch |
| `server/src/lib/homeassistant.ts` | Pure fetch |
| `server/src/lib/ownership.ts` | Pure DB queries |
| `server/src/lib/getApiKey.ts` | DB query + decrypt |

### Modified
| File | Change |
|------|--------|
| `server/src/db/index.ts` | Supabase connection string, pooler support |
| `server/src/router.ts` | Remove authRouter |
| `server/src/trpc.ts` | Context uses Supabase JWT validation |
| `server/src/routers/gardens.ts` | triggerAnalysis → Trigger.dev; getAnalysisStatus → query analysis_results |
| `server/src/routers/photos.ts` | Credential changes only (via storage.ts) |
| `server/src/lib/storage.ts` | Endpoint + credentials → Supabase Storage S3 |
| `server/src/lib/crypto.ts` | Stays, only used for API key encryption |
| `web/src/lib/auth-context.tsx` | Supabase auth state |
| `web/src/lib/trpc-provider.tsx` | Token from Supabase, URL to /api/trpc |
| `web/src/app/login/page.tsx` | Supabase auth calls |
| `web/src/app/chat/page.tsx` | Fetch URL to /api/chat/stream |
| `web/next.config.ts` | serverExternalPackages |
| `web/package.json` | Add server dependencies |
| `mobile/src/lib/auth-store.ts` | Supabase client + ExpoSecureStoreAdapter |
| `mobile/src/lib/trpc-provider.tsx` | Token from Supabase session |
| `mobile/app/(auth)/login.tsx` | Supabase auth calls |
| `mobile/app/(auth)/register.tsx` | Supabase auth calls |
| `mobile/package.json` | Add @supabase/supabase-js |

### New
| File | Purpose |
|------|--------|
| `web/src/app/api/trpc/[trpc]/route.ts` | tRPC Next.js adapter |
| `web/src/app/api/chat/stream/route.ts` | SSE streaming route handler |
| `web/src/lib/supabase.ts` | Supabase client init (server + browser) |
| `trigger/daily-analysis.ts` | Trigger.dev cron task |
| `trigger/analyze-garden.ts` | Trigger.dev per-garden task |
| `trigger/analyze-zone.ts` | Trigger.dev per-zone task |
| `trigger.config.ts` | Trigger.dev project config |

## Deployment

### Vercel
- Single project deploying `packages/web`
- Root directory: `packages/web`
- Server env vars: `DATABASE_URL` (pooler), `DIRECT_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, Supabase Storage S3 credentials
- Client env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Auto-deploy on push to master

### Supabase
- One project (free tier): Postgres + Auth + Storage
- Run `drizzle-kit migrate` against direct connection for schema setup
- Create a Storage bucket for photos
- Import data from Render Postgres if desired

### Trigger.dev
- One project (free tier)
- Env vars: `DATABASE_URL` (direct), `ENCRYPTION_KEY`, Supabase Storage S3 credentials
- Deploy: `npx trigger.dev@latest deploy` in GitHub Actions on push to master

### Removed from Render
- `gardoo-server` web service
- `gardoo-web` web service
- `gardoo-db` Postgres instance
- `render.yaml` can be deleted or kept for reference

### Mobile
- Update `EXPO_PUBLIC_API_URL` to Vercel URL
- Add `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Rebuild via EAS
