# HA Webhook Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken pull-based HA integration with webhook-push from HA, auto-discover sensors, and let users assign them to zones.

**Architecture:** HA pushes sensor data to a Next.js API route via a per-garden webhook token. New entity IDs auto-create unassigned sensors. Users assign sensors to zones in settings. The existing context builder and AI prompt already consume sensor readings.

**Tech Stack:** Next.js API routes, Drizzle ORM, tRPC, Tailwind CSS

---

### Task 1: Schema — Add webhook_token to gardens, make sensors.zoneId nullable

**Files:**
- Modify: `packages/server/src/db/schema.ts:139-149` (gardens table)
- Modify: `packages/server/src/db/schema.ts:222-231` (sensors table)
- Generate: `packages/server/drizzle/0009_*.sql`

**Step 1: Add `webhookToken` column to gardens table**

In `packages/server/src/db/schema.ts`, modify the `gardens` table (line 139) to add `webhookToken` after `createdAt`:

```typescript
export const gardens = pgTable("gardens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  locationLat: real("location_lat"),
  locationLng: real("location_lng"),
  hardinessZone: text("hardiness_zone"),
  createdAt: timestamp("created_at").defaultNow(),
  webhookToken: text("webhook_token"),
});
```

**Step 2: Make `sensors.zoneId` nullable**

In the sensors table (line 222), remove `.notNull()` from `zoneId` and also add a `gardenId` column so unassigned sensors (no zone) can still be linked to a garden:

```typescript
export const sensors = pgTable("sensors", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: uuid("zone_id")
    .references(() => zones.id, { onDelete: "cascade" }),
  gardenId: uuid("garden_id")
    .references(() => gardens.id, { onDelete: "cascade" }),
  haEntityId: text("ha_entity_id").notNull(),
  sensorType: text("sensor_type").notNull(),
  lastReading: jsonb("last_reading"),
  lastReadAt: timestamp("last_read_at"),
});
```

Note: Removed `.notNull()` from `zoneId`. Added `gardenId` so the webhook handler can link sensors to the garden before a zone is assigned.

**Step 3: Generate and run the migration**

```bash
cd packages/server && pnpm db:generate && pnpm db:migrate
```

Expected: new migration SQL in `drizzle/` adding `webhook_token` to gardens, `garden_id` to sensors, and making `zone_id` nullable.

**Step 4: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/drizzle/
git commit -m "feat: add webhook_token to gardens, make sensors.zoneId nullable"
```

---

### Task 2: Server — generateWebhookToken mutation in gardens router

**Files:**
- Modify: `packages/server/src/routers/gardens.ts`

**Step 1: Add the mutation**

Add after the `delete` mutation (line 111) in the gardens router:

```typescript
  generateWebhookToken: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const token = crypto.randomUUID();
      await ctx.db
        .update(gardens)
        .set({ webhookToken: token })
        .where(eq(gardens.id, input.gardenId));

      return { token };
    }),
```

Add `import crypto from "crypto";` at the top if not already available (Node.js global `crypto` should work — test it).

**Step 2: Typecheck**

```bash
pnpm --filter @gardoo/server typecheck
```

**Step 3: Commit**

```bash
git add packages/server/src/routers/gardens.ts
git commit -m "feat: add generateWebhookToken mutation to gardens router"
```

---

### Task 3: Server — Webhook API route

**Files:**
- Create: `packages/web/src/app/api/webhook/ha/[token]/route.ts`

**Step 1: Create the webhook route**

This is a Next.js API route (NOT tRPC) that HA posts sensor data to. No auth header needed — the token in the URL is the auth.

```typescript
import { db } from "@gardoo/server/src/db/index";
import { gardens, sensors, sensorReadings } from "@gardoo/server/src/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";

const payloadSchema = z.array(
  z.object({
    entity_id: z.string(),
    state: z.string(),
    attributes: z.object({
      unit_of_measurement: z.string().optional(),
    }).passthrough().optional(),
  }),
);

const SENSOR_TYPE_PATTERNS: [RegExp, string][] = [
  [/soil_moisture|moisture/, "Soil Moisture"],
  [/soil_temp|soil_temperature/, "Soil Temperature"],
  [/temperature|temp/, "Temperature"],
  [/light|lux|illuminance/, "Light"],
];

function inferSensorType(entityId: string): string {
  for (const [pattern, type] of SENSOR_TYPE_PATTERNS) {
    if (pattern.test(entityId)) return type;
  }
  return "Unknown";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Look up garden by webhook token
  const garden = await db.query.gardens.findFirst({
    where: eq(gardens.webhookToken, token),
  });

  if (!garden) {
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }

  // 2. Parse and validate payload
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  // 3. Process each entity
  let received = 0;

  for (const entity of parsed.data) {
    const numericValue = parseFloat(entity.state);
    if (isNaN(numericValue)) continue; // Skip non-numeric states

    const unit = entity.attributes?.unit_of_measurement ?? "";

    // Find or create sensor for this entity
    let sensor = await db.query.sensors.findFirst({
      where: and(
        eq(sensors.haEntityId, entity.entity_id),
        eq(sensors.gardenId, garden.id),
      ),
    });

    if (!sensor) {
      // Auto-discover: create unassigned sensor
      const [created] = await db
        .insert(sensors)
        .values({
          gardenId: garden.id,
          haEntityId: entity.entity_id,
          sensorType: inferSensorType(entity.entity_id),
        })
        .returning();
      sensor = created;
    }

    // Insert reading
    await db.insert(sensorReadings).values({
      sensorId: sensor.id,
      value: numericValue,
      unit,
    });

    // Update last reading on sensor
    await db
      .update(sensors)
      .set({
        lastReading: { value: numericValue, unit },
        lastReadAt: new Date(),
      })
      .where(eq(sensors.id, sensor.id));

    received++;
  }

  return Response.json({ received });
}
```

**Step 2: Build check**

```bash
pnpm --filter @gardoo/web build
```

**Step 3: Commit**

```bash
git add packages/web/src/app/api/webhook/ha/\[token\]/route.ts
git commit -m "feat: add HA webhook endpoint for sensor data push"
```

---

### Task 4: Server — Remove pull-based HA code

**Files:**
- Modify: `packages/server/src/routers/sensors.ts`
- Modify: `packages/server/src/db/schema.ts` (UserSettings interface)
- Delete or gut: `packages/server/src/lib/homeassistant.ts`

**Step 1: Remove `read` and `readAll` from sensors router**

In `packages/server/src/routers/sensors.ts`:
- Remove lines 144-163 (the `read` and `readAll` mutations).
- Remove the `readSensor` function (lines 56-100).
- Remove the `getHAConfig` function (lines 17-32).
- Remove the `import { fetchSensorState } from "../lib/homeassistant";` at line 11.
- The `assertSensorOwnership` function (lines 38-51) stays — it's used by `delete` and `getReadings`.

**Step 2: Update `assertSensorOwnership` for nullable zoneId**

Since `zoneId` is now nullable, the sensor might not have a zone. Update the ownership check to use `gardenId` instead:

```typescript
async function assertSensorOwnership(
  db: Parameters<typeof assertZoneOwnership>[0],
  sensorId: string,
  userId: string,
) {
  const sensor = await db.query.sensors.findFirst({
    where: eq(sensors.id, sensorId),
    with: { zone: { with: { garden: true } } },
  });
  if (!sensor) throw new Error("Sensor not found");

  // Check ownership via zone->garden if assigned, or directly via gardenId
  if (sensor.zone) {
    if (sensor.zone.garden.userId !== userId) throw new Error("Sensor not found");
  } else {
    // Unassigned sensor — check gardenId
    const garden = await db.query.gardens.findFirst({
      where: eq(gardens.id, sensor.gardenId!),
    });
    if (!garden || garden.userId !== userId) throw new Error("Sensor not found");
  }
  return sensor;
}
```

You will need to add `gardens` to the schema import.

**Step 3: Add `sensors.update` mutation for assigning zones**

Add after the `create` mutation:

```typescript
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        zoneId: z.string().uuid().optional(),
        sensorType: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSensorOwnership(ctx.db, input.id, ctx.userId);

      const { id, ...updates } = input;
      const [updated] = await ctx.db
        .update(sensors)
        .set(updates)
        .where(eq(sensors.id, id))
        .returning();
      return updated;
    }),
```

**Step 4: Add `sensors.listUnassigned` query**

Add to the sensors router:

```typescript
  listUnassigned: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      return ctx.db.query.sensors.findMany({
        where: and(
          eq(sensors.gardenId, input.gardenId),
          isNull(sensors.zoneId),
        ),
      });
    }),
```

You'll need to add `isNull` to the drizzle-orm import and `assertGardenOwnership` from `"../lib/ownership"`.

**Step 5: Remove `haUrl` and `haToken` from UserSettings**

In `packages/server/src/db/schema.ts`, remove lines 60-61 from the `UserSettings` interface:

```typescript
export interface UserSettings {
  timezone?: string;
  hardinessZone?: string;
  skillLevel?: string;
  preferredProvider?: "claude" | "kimi";
  units?: "metric" | "imperial";
  taskQuantity?: "low" | "normal" | "high";
  gardeningDays?: number[];
  extraInstructions?: string;
}
```

**Step 6: Delete `packages/server/src/lib/homeassistant.ts`**

This file is no longer needed — the webhook replaces all pull-based HA access.

**Step 7: Update sensor relations for nullable zone**

In `packages/server/src/db/schema.ts`, update the sensors relations to also include a garden relation:

```typescript
export const sensorsRelations = relations(sensors, ({ one, many }) => ({
  zone: one(zones, {
    fields: [sensors.zoneId],
    references: [zones.id],
  }),
  garden: one(gardens, {
    fields: [sensors.gardenId],
    references: [gardens.id],
  }),
  readings: many(sensorReadings),
}));
```

**Step 8: Typecheck**

```bash
pnpm --filter @gardoo/server typecheck
```

**Step 9: Commit**

```bash
git add packages/server/src/routers/sensors.ts packages/server/src/db/schema.ts
git rm packages/server/src/lib/homeassistant.ts
git commit -m "feat: remove pull-based HA, add sensor update/listUnassigned endpoints"
```

---

### Task 5: Server — Sensor readings retention cleanup

**Files:**
- Modify: `packages/server/src/routers/gardens.ts`

**Step 1: Add cleanup to the inline analysis function**

In `packages/server/src/routers/gardens.ts`, find the `runInlineAnalysis` function. At the start of the function (before the zone loop), add retention cleanup:

```typescript
// Clean up sensor readings older than 30 days
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
await db.delete(sensorReadings).where(
  sql`${sensorReadings.recordedAt} < ${thirtyDaysAgo}`,
);
```

You will need to add `sensorReadings` to the schema import at the top of the file.

**Step 2: Typecheck**

```bash
pnpm --filter @gardoo/server typecheck
```

**Step 3: Commit**

```bash
git add packages/server/src/routers/gardens.ts
git commit -m "feat: add 30-day sensor reading retention cleanup"
```

---

### Task 6: Web — Replace HA settings section with webhook UI

**Files:**
- Modify: `packages/web/src/app/settings/page.tsx`

**Step 1: Remove old HA state and handler**

Remove these lines:
- Line 46-47: `const [haUrl, setHaUrl]` and `const [haToken, setHaToken]`
- Line 51-52: `setHaUrl(...)` and `setHaToken(...)` in the useEffect
- Line 150-155: `handleSaveHA` function

**Step 2: Add webhook state and mutations**

Add near the other state declarations:

```typescript
const generateWebhookMutation = trpc.gardens.generateWebhookToken.useMutation({
  onSuccess() {
    gardensQuery.refetch();
  },
});
const [copiedWebhook, setCopiedWebhook] = useState(false);
```

**Step 3: Add unassigned sensors query**

```typescript
const unassignedSensorsQuery = trpc.sensors.listUnassigned.useQuery(
  { gardenId: garden?.id! },
  { enabled: !!garden?.id },
);

const updateSensorMutation = trpc.sensors.update.useMutation({
  onSuccess() {
    unassignedSensorsQuery.refetch();
  },
});

const zonesQuery = trpc.zones.list.useQuery(
  { gardenId: garden?.id! },
  { enabled: !!garden?.id },
);
```

**Step 4: Replace the HA settings section (lines 495-535)**

Replace the entire `{/* Home Assistant */}` section with:

```tsx
{/* Home Assistant */}
<section className="rounded-xl border border-gray-200 bg-white p-5">
  <h2 className="mb-4 text-lg font-semibold text-gray-900">
    Home Assistant
  </h2>

  {!garden?.webhookToken ? (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Connect Home Assistant to push sensor data (soil moisture, temperature, light) to Gardoo automatically.
      </p>
      <button
        onClick={() => generateWebhookMutation.mutate({ gardenId: garden!.id })}
        disabled={generateWebhookMutation.isPending || !garden}
        className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
      >
        {generateWebhookMutation.isPending ? "Generating..." : "Generate Webhook URL"}
      </button>
    </div>
  ) : (
    <div className="space-y-4">
      {/* Webhook URL */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Webhook URL
        </label>
        <div className="flex gap-2">
          <input
            readOnly
            value={`${window.location.origin}/api/webhook/ha/${garden.webhookToken}`}
            className="flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600 font-mono"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/api/webhook/ha/${garden.webhookToken}`);
              setCopiedWebhook(true);
              setTimeout(() => setCopiedWebhook(false), 2000);
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {copiedWebhook ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* YAML snippet */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          HA Automation YAML
        </label>
        <p className="mb-2 text-xs text-gray-500">
          Edit the entity_id values to match your sensors, then paste into your HA configuration.
        </p>
        <pre className="max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-green-400 font-mono">
{`rest_command:
  gardoo_push:
    url: "${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhook/ha/${garden.webhookToken}"
    method: POST
    content_type: "application/json"
    payload: >
      [
        {"entity_id": "sensor.soil_moisture_1", "state": "{{ states('sensor.soil_moisture_1') }}", "attributes": {"unit_of_measurement": "{{ state_attr('sensor.soil_moisture_1', 'unit_of_measurement') }}"}},
        {"entity_id": "sensor.soil_temp_1", "state": "{{ states('sensor.soil_temp_1') }}", "attributes": {"unit_of_measurement": "{{ state_attr('sensor.soil_temp_1', 'unit_of_measurement') }}"}}
      ]

automation:
  - alias: "Gardoo Sensor Push"
    trigger:
      - platform: time_pattern
        minutes: "/15"
    action:
      - service: rest_command.gardoo_push`}
        </pre>
      </div>

      {/* Regenerate */}
      <button
        onClick={() => {
          if (confirm("Regenerate webhook token? The old URL will stop working.")) {
            generateWebhookMutation.mutate({ gardenId: garden.id });
          }
        }}
        className="text-sm text-gray-500 underline hover:text-gray-700"
      >
        Regenerate Token
      </button>
    </div>
  )}

  {/* Unassigned Sensors */}
  {(unassignedSensorsQuery.data?.length ?? 0) > 0 && (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <h3 className="mb-2 text-sm font-semibold text-amber-700">
        Unassigned Sensors
      </h3>
      <p className="mb-3 text-xs text-gray-500">
        These sensors were discovered from incoming data. Assign them to a zone so they appear in AI analysis.
      </p>
      <div className="space-y-2">
        {unassignedSensorsQuery.data?.map((sensor) => {
          const reading = sensor.lastReading as { value: number; unit: string } | null;
          return (
            <div key={sensor.id} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{sensor.sensorType}</p>
                <p className="text-xs text-gray-500 truncate">{sensor.haEntityId}</p>
              </div>
              {reading && (
                <span className="text-sm font-medium text-gray-700">
                  {reading.value}{reading.unit}
                </span>
              )}
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    updateSensorMutation.mutate({ id: sensor.id, zoneId: e.target.value });
                  }
                }}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">Assign zone...</option>
                {zonesQuery.data?.map((zone) => (
                  <option key={zone.id} value={zone.id}>{zone.name}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  )}
</section>
```

**Step 5: Remove haUrl/haToken from the updateSettings calls**

Search the settings page for any remaining references to `haUrl` or `haToken` and remove them (there may be one in the `handleSaveHA` function which we already removed in step 1).

**Step 6: Build check**

```bash
pnpm --filter @gardoo/web build
```

**Step 7: Commit**

```bash
git add packages/web/src/app/settings/page.tsx
git commit -m "feat: replace HA settings with webhook URL and sensor assignment UI"
```

---

### Task 7: Web — Update sensor display on zone detail for nullable zoneId

**Files:**
- Modify: `packages/web/src/app/garden/[zoneId]/page.tsx`

**Step 1: Remove any "Read" buttons for sensors**

Search the zone detail page for any buttons that call `sensors.read` or `sensors.readAll` and remove them. The sensor cards should just display `lastReading` data (which the webhook keeps updated).

**Step 2: Build check**

```bash
pnpm --filter @gardoo/web build
```

If there are TypeScript errors referencing `sensors.read` or `sensors.readAll`, remove those references.

**Step 3: Commit (if changes were needed)**

```bash
git add packages/web/src/app/garden/\[zoneId\]/page.tsx
git commit -m "chore: remove manual sensor read buttons from zone detail"
```

---

### Task 8: Context builder — Filter unassigned sensors

**Files:**
- Modify: `packages/server/src/jobs/contextBuilder.ts`

**Step 1: Add null check for unassigned sensors**

In `packages/server/src/jobs/contextBuilder.ts`, find the sensor query (line 73-76). The query already filters by `eq(sensors.zoneId, zoneId)`, which will naturally exclude sensors where `zoneId IS NULL` because `NULL != zoneId`. Verify this by running:

```bash
pnpm --filter @gardoo/server typecheck
```

If the typecheck passes with no changes, this task is done — the existing `eq(sensors.zoneId, zoneId)` filter correctly excludes NULL zoneIds in SQL.

**Step 2: Commit (if changes were needed)**

```bash
git add packages/server/src/jobs/contextBuilder.ts
git commit -m "chore: verify context builder filters unassigned sensors"
```

---

### Task 9: Full build verification

**Step 1: Server typecheck**

```bash
pnpm --filter @gardoo/server typecheck
```

**Step 2: Web build**

```bash
pnpm --filter @gardoo/web build
```

**Step 3: Fix any remaining issues**

Check for:
- Any remaining references to `haUrl`, `haToken`, `fetchSensorState`, `sensors.read`, or `sensors.readAll` in the codebase
- TypeScript errors from the nullable `zoneId` change
- Missing imports

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: HA webhook integration complete"
```
