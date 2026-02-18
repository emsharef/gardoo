# Gardoo - AI-Powered Garden Management

## What This Is

A full-stack garden management app that uses Claude or Kimi AI to track plant health and generate care recommendations. Users set up their garden inventory (zones, plants, sensors), and the app runs daily AI analysis to produce prioritized action lists. Supports photo-based diagnosis, weather-aware recommendations, and Home Assistant sensor integration.

BYOK (Bring Your Own Key) model — users provide their own Claude or Kimi API keys, stored encrypted on the server.

## Architecture

**Monorepo** (pnpm workspaces) with three packages:

```
packages/
  server/    # Fastify + tRPC backend (Node.js)
  mobile/    # Expo/React Native iOS app
  web/       # Next.js web dashboard
```

### Server (`packages/server`)

- **Framework:** Fastify 5 + tRPC 11
- **Database:** Postgres via Drizzle ORM
- **Job Queue:** pg-boss (runs on Postgres, no Redis)
- **AI:** Anthropic SDK (Claude) + OpenAI SDK (Kimi, OpenAI-compatible)
- **Photo Storage:** Cloudflare R2 via presigned URLs
- **Weather:** Open-Meteo API (free, no key required)
- **Auth:** Email/password + JWT (bcrypt, 30-day tokens)
- **API Key Encryption:** AES-256-GCM

**tRPC Routers:**
- `auth` — register, login
- `users` — getSettings, updateSettings
- `gardens` — CRUD + getActions, getWeather
- `zones` — CRUD with garden ownership validation
- `plants` — CRUD with zone→garden ownership chain
- `careLogs` — create, list (scoped by targetId+targetType or gardenId)
- `apiKeys` — store (encrypted), list (no key values exposed), delete
- `photos` — presigned upload URL generation
- `chat` — server-routed AI conversations with garden context
- `sensors` — CRUD, manual HA reads, reading history

**Background Jobs:**
- `daily-analysis-trigger` — cron at 06:00 UTC, fans out to per-garden jobs
- `analyze-garden` — fetches weather, fans out to per-zone jobs
- `analyze-zone` — builds context, calls AI provider, stores structured results

**AI Provider Pattern:**
- `src/ai/provider.ts` — interface + context types
- `src/ai/claude.ts` — ClaudeProvider (claude-sonnet-4-20250514)
- `src/ai/kimi.ts` — KimiProvider (moonshot-v1-8k)
- `src/ai/schema.ts` — Zod schema for structured analysis output
- Provider selection: tries Claude first, falls back to Kimi

### Mobile (`packages/mobile`)

- **Framework:** Expo SDK 54 / React Native 0.81
- **Navigation:** Expo Router 6 (file-based, tabs + stack)
- **State:** Zustand (auth), React Query (server state)
- **API:** tRPC React Query client with type-safe hooks

**Tabs:** Home | Garden | Calendar | Settings

**Key screens:**
- HomeScreen — daily action cards + weather header
- GardenScreen — zone inventory with FAB for adding
- ZoneDetailScreen — plants, care logs, sensors, analysis
- PlantDetailScreen — photo, care profile, log timeline, chat button
- CalendarScreen — monthly view with action/log dot indicators
- ChatScreen — AI chat with garden/zone/plant context + photo attach
- SettingsScreen — API keys, garden config, HA connection, skill level

**Auth flow:** Expo Router layout groups — `(auth)/` for login/register, `(tabs)/` for main app. Token stored in expo-secure-store.

### Web (`packages/web`)

- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS
- **API:** Same tRPC client as mobile

**Pages:** `/` (home), `/garden`, `/garden/[zoneId]`, `/calendar`, `/settings`, `/login`

Companion dashboard — same data as mobile, read-heavy, Tailwind-styled.

## Database Schema

10 tables in Postgres:

| Table | Purpose |
|-------|---------|
| `users` | Accounts with JSONB settings (timezone, skillLevel, preferredProvider, haUrl, haToken) |
| `api_keys` | Encrypted Claude/Kimi keys (AES-256-GCM) |
| `gardens` | Top-level container, one per user typically |
| `zones` | Named areas within a garden (beds, planters, etc.) — includes `zone_type`, `dimensions` as dedicated columns |
| `plants` | Individual plants within zones |
| `care_logs` | Logged actions (polymorphic target: zone or plant) |
| `sensors` | HA entity assignments to zones |
| `sensor_readings` | Time-series sensor data |
| `analysis_results` | Structured AI analysis output (actions, observations, alerts) |
| `weather_cache` | Cached Open-Meteo forecasts per garden |

Ownership chain: user → garden → zone → plant. All CRUD validates ownership through this chain.

## Key Design Decisions

- **Zone metadata as columns:** Zone properties (type, dimensions) are stored as dedicated DB columns, not embedded in the notes field. This makes them queryable, editable, and visible to AI analysis. Zone types: `raised_bed`, `in_ground`, `container`, `indoor`, `greenhouse`, `orchard`, `herb_garden`, `lawn`. Soil types include "Potting Soil".
- **Inventory over map:** No spatial mapping. Zones are named containers with photos, not coordinates. AI reasons over structured metadata, not positions.
- **Structured AI output:** Claude/Kimi return JSON arrays of typed actions (not prose). The app renders these as inventory badges and calendar entries — the AI is invisible to the user.
- **Hybrid analysis cadence:** Daily per-zone analysis (detailed, actionable) + planned weekly garden-level synthesis (cross-zone reasoning).
- **BYOK:** Users provide their own API keys. Keys are encrypted at rest with AES-256-GCM. The server makes AI calls on behalf of users.
- **Server-first:** All AI calls route through the server for consistent logging and token tracking. No client-side AI calls.
- **Care logs are polymorphic:** `targetType` (zone|plant) + `targetId` instead of separate FK columns. Requires targetType+targetId or gardenId for list queries (security fix applied during development).

## Running Locally

```bash
# Prerequisites: Node 20+, pnpm, Postgres

# Install dependencies
pnpm install

# Set up Postgres
createdb gardoo

# Configure environment
# Edit packages/server/.env (secrets already generated, R2 keys filled in)

# Run database migrations
pnpm db:migrate

# Start server
pnpm dev:server    # http://localhost:3000

# Start mobile (separate terminal)
pnpm dev:mobile    # Expo dev server on :8081

# Start web (separate terminal)
pnpm dev:web       # Next.js on :3000 (change port to avoid conflict)
```

## Deployment

Hosted on **Render** via Blueprint (`render.yaml`):
- `gardoo-server` (`srv-d68lak49c44c73ftjc80`) — Docker web service (free plan, Oregon)
- `gardoo-web` (`srv-d690mvjnv86c73emid8g`) — Node web service (free plan, Oregon)
- `gardoo-db` (`dpg-d68l9s49c44c73ftj250-a`) — Postgres free plan

Live URLs:
- Server: https://gardoo-server.onrender.com
- Web: https://gardoo-web.onrender.com

Auto-deploy is enabled on both services — pushing to `master` triggers builds automatically.

**Environment variables (server):**
- Auto-configured by Render: `DATABASE_URL`, `ENCRYPTION_KEY`, `JWT_SECRET`
- Manual in Render dashboard: `R2_ENDPOINT`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`

**R2 bucket name:** `gardoo` (must be set via `R2_BUCKET` env var; default in code is `gardoo-photos` which is wrong)

**Migrations:** Drizzle migrations run automatically on server startup (`src/index.ts`). Data-only backfill migrations can be added as SQL files in `drizzle/` with a corresponding journal entry and snapshot.

**Free tier notes:** Docker builds take ~2 min, zero-downtime deploys can take 5-10 min on free tier. The Render MCP Postgres tool is read-only — write operations (backfills) must go through Drizzle migrations.

GitHub repo: https://github.com/emsharef/gardoo.git

## File Structure

```
gardoo/
├── render.yaml                    # Render Blueprint
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/plans/
│   └── 2026-02-14-gardoo-mvp.md   # Full implementation plan
├── packages/
│   ├── server/
│   │   ├── Dockerfile
│   │   ├── drizzle.config.ts
│   │   ├── drizzle/               # Drizzle migration SQL files + meta snapshots
│   │   ├── src/
│   │   │   ├── index.ts            # Fastify entry point
│   │   │   ├── trpc.ts             # tRPC init, context, procedures
│   │   │   ├── router.ts           # Root router (all sub-routers)
│   │   │   ├── db/
│   │   │   │   ├── schema.ts       # Drizzle schema (10 tables)
│   │   │   │   └── index.ts        # DB connection
│   │   │   ├── routers/            # tRPC routers
│   │   │   ├── ai/                 # AI provider abstraction
│   │   │   ├── jobs/               # pg-boss background jobs
│   │   │   └── lib/                # Helpers (auth, crypto, weather, storage, HA)
│   ├── mobile/
│   │   ├── app/                    # Expo Router routes
│   │   │   ├── (auth)/             # Login/register
│   │   │   └── (tabs)/             # Main app tabs
│   │   └── src/
│   │       ├── screens/            # Screen components
│   │       ├── components/         # Shared components
│   │       └── lib/                # tRPC client, auth store
│   └── web/
│       └── src/
│           ├── app/                # Next.js App Router pages
│           ├── components/         # Navigation, AppShell
│           └── lib/                # tRPC client, auth context

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

Tests exist for: auth, gardens, zones, plants, apiKeys, AI providers (mocked), weather (mocked). Integration tests require a running Postgres instance.

## Test Accounts

Credentials are in `packages/server/.env` (`TEST_EMAIL`, `TEST_PASSWORD`, etc.).

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
