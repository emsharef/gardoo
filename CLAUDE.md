# Gardoo - AI-Powered Garden Management

## What This Is

A full-stack garden management app that uses Claude or Kimi AI to track plant health and generate care recommendations. Users set up their garden inventory (zones, plants, sensors), and the app runs daily AI analysis to produce prioritized action lists. Supports photo-based diagnosis, weather-aware recommendations, and Home Assistant sensor integration.

BYOK (Bring Your Own Key) model -- users provide their own Claude or Kimi API keys, stored encrypted at rest via AES-256-GCM.

## Architecture

**Monorepo** (pnpm workspaces) with three packages + a Trigger.dev tasks directory:

```
packages/
  server/    # Shared library (tRPC routers, DB schema, AI providers)
  mobile/    # Expo/React Native iOS app
  web/       # Next.js app -- single Vercel deployment target
trigger/     # Trigger.dev background job tasks
```

**Deployment stack:** Vercel (web app) + Supabase (Postgres + Auth) + Cloudflare R2 (photo storage) + Trigger.dev (background jobs).

### Server (`packages/server`) -- Shared Library

The server package is **not** a standalone process. It is a shared TypeScript library imported by the web package (Next.js API routes) and by Trigger.dev tasks. It contains:

- **Database:** Postgres via Drizzle ORM (connects to Supabase Postgres)
- **AI:** Anthropic SDK (Claude) + OpenAI SDK (Kimi, OpenAI-compatible)
- **Photo Storage:** Cloudflare R2 via S3-compatible presigned URLs
- **Weather:** Open-Meteo API (free, no key required) -- expanded with gardening metrics (UV, soil temp/moisture, ET0, dew point, wind gusts, sunrise/sunset)
- **Auth:** Supabase Auth (email/password, SDK handles tokens). Server-side JWT validation via `getUserIdFromToken()` in `src/trpc.ts`.
- **API Key Encryption:** AES-256-GCM
- **User provisioning:** `ensureUser()` in `src/lib/ensureUser.ts` auto-creates a `users` row on first authenticated request (Supabase Auth manages the actual identity; the `users` table stores app-specific settings).

**tRPC Routers:**
- `users` -- getSettings, updateSettings
- `gardens` -- CRUD + getActions, getWeather, triggerAnalysis, getAnalysisResults, getAnalysisStatus
- `zones` -- CRUD with garden ownership validation
- `plants` -- CRUD with zone->garden ownership chain
- `careLogs` -- create, list (scoped by targetId+targetType or gardenId)
- `tasks` -- complete (creates care log + marks done), snooze (reschedule), dismiss (cancel)
- `apiKeys` -- store (encrypted), list (no key values exposed), delete
- `photos` -- presigned upload URL generation
- `chat` -- AI conversations with garden context (streaming handled by a separate Next.js route)
- `sensors` -- CRUD, manual HA reads, reading history

**AI Provider Pattern:**
- `src/ai/provider.ts` -- interface, context types, system prompt builder (includes existing tasks section)
- `src/ai/claude.ts` -- ClaudeProvider (claude-sonnet-4-20250514)
- `src/ai/kimi.ts` -- KimiProvider (moonshot-v1-8k)
- `src/ai/schema.ts` -- Zod schema with discriminated union for operations (create/update/complete/cancel)
- Provider selection: tries Claude first, falls back to Kimi

### Background Jobs (Trigger.dev)

Background analysis jobs run on [Trigger.dev](https://trigger.dev) (not in-process). Three task files in `trigger/`:

- **`daily-analysis.ts`** -- scheduled cron task at 06:00 UTC, queries all gardens and fans out to per-garden tasks
- **`analyze-garden.ts`** -- fetches weather for a garden, fans out to per-zone tasks
- **`analyze-zone.ts`** -- builds context (including existing tasks), calls AI provider, applies task operations (create/update/complete/cancel) to the tasks table, stores raw result as audit log

Tasks use `createDb()` from the server package to create their own DB connections (with `DIRECT_DATABASE_URL` for non-pooled Supabase connections).

**Trigger.dev config:** `trigger.config.ts` at repo root. The `project` field must be set to your actual Trigger.dev project ref. Deploy tasks with `npx trigger.dev@latest deploy`.

### Mobile (`packages/mobile`)

- **Framework:** Expo SDK 54 / React Native 0.81
- **Navigation:** Expo Router 6 (file-based, tabs + stack)
- **State:** Zustand (auth), React Query (server state)
- **API:** tRPC React Query client with type-safe hooks
- **Auth:** Supabase Auth via `@supabase/supabase-js`. Token stored in expo-secure-store.

**Tabs:** Home | Garden | Calendar | Settings

**Key screens:**
- HomeScreen -- daily action cards + weather header
- GardenScreen -- zone inventory with FAB for adding
- ZoneDetailScreen -- plants, care logs, sensors, analysis
- PlantDetailScreen -- photo, care profile, log timeline, chat button
- CalendarScreen -- monthly view with action/log dot indicators
- ChatScreen -- AI chat with garden/zone/plant context + photo attach
- SettingsScreen -- API keys, garden config, HA connection, skill level

**Auth flow:** Expo Router layout groups -- `(auth)/` for login/register, `(tabs)/` for main app.

### Web (`packages/web`)

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Styling:** Tailwind CSS
- **API:** tRPC client (same router type as mobile), served via Next.js API routes
- **Auth:** Supabase Auth via `@supabase/ssr` (browser client) + server-side JWT validation

**API Routes:**
- `/api/trpc/[trpc]` -- tRPC adapter (GET + POST), creates context with Supabase JWT validation + `ensureUser()`
- `/api/chat/stream` -- SSE streaming endpoint for AI chat conversations

**Pages:** `/` (home), `/garden`, `/garden/[zoneId]`, `/weather`, `/analysis`, `/calendar`, `/settings`, `/login`, `/chat`, `/onboarding`

## Database Schema

11 tables in Supabase Postgres:

| Table | Purpose |
|-------|---------|
| `users` | App settings (timezone, skillLevel, preferredProvider, units, haUrl, haToken) as JSONB. Row auto-created on first auth via `ensureUser()`. |
| `api_keys` | Encrypted Claude/Kimi keys (AES-256-GCM) |
| `gardens` | Top-level container, one per user typically |
| `zones` | Named areas within a garden (beds, planters, etc.) -- includes `zone_type`, `dimensions` as dedicated columns |
| `plants` | Individual plants within zones |
| `care_logs` | Logged actions (polymorphic target: zone or plant) |
| `tasks` | Persistent AI-managed tasks with lifecycle (pending/completed/cancelled/snoozed) |
| `sensors` | HA entity assignments to zones |
| `sensor_readings` | Time-series sensor data |
| `analysis_results` | Audit log of raw AI analysis responses (JSONB with operations, observations, alerts) |
| `weather_cache` | Cached Open-Meteo forecasts per garden (current conditions + 7-day daily forecast with gardening metrics) |

Ownership chain: user -> garden -> zone -> plant. All CRUD validates ownership through this chain.

## Key Design Decisions

- **Zone metadata as columns:** Zone properties (type, dimensions) are stored as dedicated DB columns, not embedded in the notes field. This makes them queryable, editable, and visible to AI analysis. Zone types: `raised_bed`, `in_ground`, `container`, `indoor`, `greenhouse`, `orchard`, `herb_garden`, `lawn`. Soil types include "Potting Soil".
- **Inventory over map:** No spatial mapping. Zones are named containers with photos, not coordinates. AI reasons over structured metadata, not positions.
- **Persistent tasks with AI operations:** The AI doesn't just produce a list of actions -- it manages a persistent task list. Each analysis run receives existing tasks (pending + recently resolved) as context, and returns operations: `create` new tasks, `update` existing ones (reschedule, reprioritize), `complete` tasks it sees evidence for (via care logs/photos), or `cancel` tasks no longer relevant. Tasks are stored in their own table with full lifecycle (pending -> completed/cancelled/snoozed). The `analysis_results` table is an audit log of raw AI responses. Completing a task via the UI atomically creates a care log and marks the task done. The AI handles recurrence -- when a recurring task is completed, it sees the completion + recurrence hint in context and creates the next occurrence.
- **Task operations schema:** AI output uses a Zod discriminated union on `op` field. `create` requires targetType/targetId/actionType/priority/label/suggestedDate. `update` requires taskId + any fields to change. `complete`/`cancel` require taskId + optional reason. Invalid ops are logged and skipped (don't crash the analysis run).
- **Photo requests:** Monitor tasks can include `photoRequested: true` -- the AI sets this when it hasn't seen a zone/plant recently and wants visual evidence. The UI shows a camera icon on these tasks.
- **Hybrid analysis cadence:** Daily per-zone analysis (detailed, actionable) + planned weekly garden-level synthesis (cross-zone reasoning).
- **BYOK:** Users provide their own API keys. Keys are encrypted at rest with AES-256-GCM. AI calls are made server-side (via Next.js API routes or Trigger.dev tasks) on behalf of users.
- **Server-side AI:** All AI calls route through server-side code (Next.js API routes or Trigger.dev) for consistent logging and token tracking. No client-side AI calls.
- **Supabase Auth with app-level user rows:** Supabase handles identity (email/password sign-up, JWT tokens). The app's `users` table stores garden-specific settings. `ensureUser()` auto-creates the row on first authenticated request so there's no separate registration step.
- **Care logs are polymorphic:** `targetType` (zone|plant) + `targetId` instead of separate FK columns. Requires targetType+targetId or gardenId for list queries. When a task is completed via the UI, a care log is created automatically and linked back to the task via `careLogId`.
- **Weather as read-through cache:** The `getWeather` endpoint auto-fetches from Open-Meteo when the cache is missing or older than 1 hour, so weather data is always fresh without requiring a manual trigger. Data is stored in metric internally; unit conversion happens at display time.
- **Metric/Imperial units:** User setting stored in JSONB `settings.units` (`"metric"` | `"imperial"`, defaults to metric). Conversion functions (`fmtTemp`, `fmtWind`, `fmtPrecip`) in `packages/web/src/lib/weather.ts` handle display formatting.

## Running Locally

```bash
# Prerequisites: Node 20+, pnpm, Supabase project (free tier)

# Install dependencies
pnpm install

# Configure environment
# Copy the template and fill in your Supabase credentials:
cp packages/web/.env.local.example packages/web/.env.local
# Edit packages/web/.env.local with your Supabase URL, keys, DATABASE_URL, etc.

# Run database migrations (requires DATABASE_URL in env)
pnpm db:migrate

# Start web (includes API routes -- no separate server needed)
pnpm dev:web       # Next.js on http://localhost:3000

# Start mobile (separate terminal, points to local API)
pnpm dev:mobile    # Expo dev server on :8081

# (Optional) Start Trigger.dev dev worker for background jobs
# Requires root .env with DATABASE_URL, DIRECT_DATABASE_URL, ENCRYPTION_KEY, STORAGE_S3_* vars
npx trigger.dev dev
```

The server package is not started separately -- it is imported by the web package at build/runtime.

## Deployment

### Vercel (Web App)

The `packages/web` Next.js app deploys to **Vercel**. Auto-deploy is enabled on push to `master`.

**Live URL:** https://gardoo.vercel.app

**Vercel project settings:**
- Framework: Next.js
- Root directory: `packages/web`

**Vercel environment variables (10 total):**
- `NEXT_PUBLIC_SUPABASE_URL` -- Supabase project URL (client-side, inlined at build time)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` -- Supabase anon key (client-side, inlined at build time)
- `DATABASE_URL` -- Supabase Postgres pooler connection string (port 6543)
- `ENCRYPTION_KEY` -- AES-256-GCM key for API key encryption
- `TRIGGER_SECRET_KEY` -- Trigger.dev production secret key (enables dispatching to Trigger.dev; without it, analysis runs inline)
- `STORAGE_S3_ENDPOINT` -- Cloudflare R2 S3 endpoint
- `STORAGE_S3_ACCESS_KEY` -- R2 access key
- `STORAGE_S3_SECRET_KEY` -- R2 secret key
- `STORAGE_S3_BUCKET` -- R2 bucket name (`gardoo`)
- `STORAGE_S3_REGION` -- `auto` for R2

**Note:** Server-side auth (`trpc.ts`) falls back to `NEXT_PUBLIC_` Supabase vars, so separate `SUPABASE_URL`/`SUPABASE_ANON_KEY` vars are not required.

**Important:** If the Supabase password contains special characters (e.g. `*`), URL-encode them in `DATABASE_URL` (e.g. `*` -> `%2A`).

### Supabase (Database + Auth + Storage)

- **Postgres:** Hosts the database. Migrations run via `pnpm db:migrate` (Drizzle Kit).
- **Auth:** Email/password authentication. SDK manages tokens, sessions, and user creation.
- **Storage:** Photo storage uses **Cloudflare R2** (S3-compatible, separate from Supabase).

### Trigger.dev (Background Jobs)

Trigger.dev runs the daily analysis pipeline. Project ref: `proj_ggoftbzyccrsmhuznwwq`.

**Deploy tasks to production:**
```bash
TRIGGER_SECRET_KEY=tr_prod_... npx trigger.dev@latest deploy
```

**Run dev worker locally:**
```bash
npx trigger.dev dev
```
The dev worker reads env vars from the root `.env` file (not `packages/web/.env.local`).

**Trigger.dev environment variables** (set in Trigger.dev dashboard for Production):
- `DATABASE_URL` -- Supabase Postgres pooler connection string (port 6543)
- `DIRECT_DATABASE_URL` -- Supabase Postgres direct connection string (port 5432, non-pooled)
- `ENCRYPTION_KEY` -- Same key as Vercel (for decrypting user API keys)
- `STORAGE_S3_ENDPOINT` -- Cloudflare R2 S3 endpoint
- `STORAGE_S3_ACCESS_KEY` -- R2 access key
- `STORAGE_S3_SECRET_KEY` -- R2 secret key
- `STORAGE_S3_BUCKET` -- R2 bucket name (`gardoo`)
- `STORAGE_S3_REGION` -- `auto` for R2

**Inline analysis fallback:** If `TRIGGER_SECRET_KEY` is not set on Vercel, the `triggerAnalysis` mutation runs analysis directly in the API route instead of dispatching to Trigger.dev. This is useful for development or if Trigger.dev is not configured.

**Scheduled tasks:** The `daily-analysis` cron runs at 06:00 UTC in production. Dev scheduled tasks only fire when the dev worker is actively running -- no risk of duplicate runs.

**pnpm monorepo note:** Trigger.dev's bundler can't resolve workspace packages because pnpm doesn't hoist. The root `package.json` includes `@gardoo/server: "workspace:*"` and key npm deps (drizzle-orm, postgres, zod, etc.) so the bundler can find them.

### Database

**Supabase Postgres.** Migrations run via `pnpm db:migrate` (Drizzle Kit). Data-only backfill migrations can be added as SQL files in `drizzle/` with a corresponding journal entry and snapshot.

**Connection modes:**
- **Port 6543** (pooler, transaction mode): Used by Vercel API routes and Trigger.dev tasks via `DATABASE_URL`. Requires `prepare: false` in postgres.js client options (no prepared statements in transaction mode).
- **Port 5432** (direct): Used by Trigger.dev tasks via `DIRECT_DATABASE_URL` when available. Supports prepared statements.

GitHub repo: https://github.com/emsharef/gardoo.git

## File Structure

```
gardoo/
├── trigger.config.ts              # Trigger.dev configuration
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/plans/
│   └── 2026-02-14-gardoo-mvp.md   # Full implementation plan
├── trigger/                        # Trigger.dev task files
│   ├── daily-analysis.ts           # Cron: fans out to per-garden analysis
│   ├── analyze-garden.ts           # Fetches weather, fans out to per-zone
│   └── analyze-zone.ts             # AI analysis for a single zone
├── packages/
│   ├── server/                     # Shared library (NOT a standalone server)
│   │   ├── drizzle.config.ts
│   │   ├── drizzle/                # Drizzle migration SQL files + meta snapshots
│   │   ├── src/
│   │   │   ├── trpc.ts             # tRPC init, context, Supabase JWT validation
│   │   │   ├── router.ts           # Root router (all sub-routers)
│   │   │   ├── db/
│   │   │   │   ├── schema.ts       # Drizzle schema (11 tables)
│   │   │   │   └── index.ts        # DB connection (+ createDb factory)
│   │   │   ├── routers/            # tRPC routers
│   │   │   ├── ai/                 # AI provider abstraction
│   │   │   ├── jobs/               # Context builder for analysis
│   │   │   └── lib/                # Helpers (crypto, weather, storage, ownership, ensureUser, HA)
│   ├── mobile/
│   │   ├── app/                    # Expo Router routes
│   │   │   ├── (auth)/             # Login/register
│   │   │   └── (tabs)/             # Main app tabs
│   │   └── src/
│   │       ├── screens/            # Screen components
│   │       ├── components/         # Shared components
│   │       └── lib/                # tRPC client, auth store
│   └── web/
│       ├── .env.local.example      # Environment variable template
│       └── src/
│           ├── app/                # Next.js App Router pages
│           │   ├── api/
│           │   │   ├── trpc/[trpc]/route.ts  # tRPC API route handler
│           │   │   └── chat/stream/route.ts  # SSE chat streaming endpoint
│           │   ├── weather/        # Weather & forecast page
│           │   └── ...
│           ├── components/         # Navigation, AppShell
│           └── lib/
│               ├── trpc.ts         # tRPC client
│               ├── trpc-provider.tsx # tRPC + React Query provider
│               ├── auth-context.tsx # Supabase Auth provider
│               ├── supabase.ts     # Supabase browser client factory
│               └── weather.ts      # Weather utilities (WMO codes, alerts, unit conversion)

```

## Testing

```bash
# Run all tests
pnpm test

# Server tests only
pnpm --filter @gardoo/server test

# Server typecheck
pnpm --filter @gardoo/server typecheck

# Web build check
pnpm --filter @gardoo/web build
```

Tests exist for: gardens, zones, plants, tasks, apiKeys, AI providers (mocked), AI schema (operations validation), weather (mocked). Integration tests require a running Postgres instance (Supabase or local).

## What's Not Built Yet (V2 Candidates)

- Photo-first onboarding (AI identifies plants from garden photos)
- Camera monitoring / progress photo comparison
- Weekly whole-garden synthesis (cross-zone reasoning)
- Growth timelapse generation
- Push notifications (morning briefing, freeze alerts)
- Offline mode with local caching
- Voice input for care logging
- Social features / garden sharing
- Sensor threshold alerts (auto-triggered analysis)
- Succession planting / crop rotation suggestions
