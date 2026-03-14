# Plant Lifecycle & Zone Re-scan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add plant retirement (preserving history) and zone photo re-scanning to detect bulk plant changes.

**Architecture:** Add `status`, `retired_at`, `retired_reason` columns to the plants table for soft-delete. Add `zones.rescan` and `zones.applyRescan` endpoints that use AI to diff a new zone photo against the current plant inventory. Filter retired plants from active queries and AI context.

**Tech Stack:** Drizzle ORM (schema + migrations), tRPC (server endpoints), Next.js (UI), Anthropic/OpenAI SDK (AI identification)

---

### Task 1: Database Migration — Add retirement columns to plants

**Files:**
- Modify: `packages/server/src/db/schema.ts:166-179`
- Generate: `packages/server/drizzle/` (new migration SQL)

**Step 1: Add columns to plants table schema**

In `packages/server/src/db/schema.ts`, modify the `plants` table (line 166) to add three new columns after `createdAt`:

```typescript
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
  careProfile: jsonb("care_profile").$type<CareProfile>(),
  createdAt: timestamp("created_at").defaultNow(),
  status: text("status").notNull().default("active"),
  retiredAt: timestamp("retired_at"),
  retiredReason: text("retired_reason"),
});
```

**Step 2: Generate the migration**

Run:
```bash
pnpm db:generate
```
Expected: new SQL migration file in `packages/server/drizzle/` adding the three columns.

**Step 3: Run the migration**

Run:
```bash
pnpm db:migrate
```
Expected: migration applies successfully. All existing plants get `status = 'active'`, `retired_at = NULL`, `retired_reason = NULL`.

**Step 4: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/drizzle/
git commit -m "feat: add retirement columns to plants table"
```

---

### Task 2: Server — plants.retire endpoint

**Files:**
- Modify: `packages/server/src/routers/plants.ts`

**Step 1: Add the retire mutation**

Add after the existing `delete` mutation (line ~110) in `packages/server/src/routers/plants.ts`:

```typescript
  retire: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.enum(["harvested", "died", "removed", "relocated"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plant = await assertPlantOwnership(ctx.db, input.id, ctx.userId);

      // Set plant status to retired
      await ctx.db
        .update(plants)
        .set({
          status: "retired",
          retiredAt: new Date(),
          retiredReason: input.reason,
        })
        .where(eq(plants.id, input.id));

      // Auto-create care log entry
      await ctx.db.insert(careLogs).values({
        targetType: "plant",
        targetId: input.id,
        actionType: "other",
        notes: `Plant retired: ${input.reason}`,
      });

      // Cancel any pending tasks for this plant
      await ctx.db
        .update(tasks)
        .set({ status: "cancelled", completedAt: new Date(), completedVia: "retirement" })
        .where(
          and(
            eq(tasks.targetType, "plant"),
            eq(tasks.targetId, input.id),
            eq(tasks.status, "pending"),
          ),
        );

      return { success: true as const };
    }),
```

You will need to add these imports at the top of `plants.ts`:

```typescript
import { careLogs, tasks } from "../db/schema";
import { and } from "drizzle-orm";
```

Check the existing imports — `eq` and `plants` should already be imported. `and` may or may not be. `careLogs` and `tasks` likely need adding.

**Step 2: Verify the server compiles**

Run:
```bash
pnpm --filter @gardoo/server typecheck
```
Expected: no errors.

**Step 3: Commit**

```bash
git add packages/server/src/routers/plants.ts
git commit -m "feat: add plants.retire endpoint with care log and task cancellation"
```

---

### Task 3: Server — Filter retired plants from active queries

**Files:**
- Modify: `packages/server/src/routers/plants.ts`
- Modify: `packages/server/src/routers/zones.ts`
- Modify: `packages/server/src/routers/gardens.ts`
- Modify: `packages/server/src/jobs/contextBuilder.ts`

**Step 1: Add a `listRetired` query to plants router**

In `packages/server/src/routers/plants.ts`, add:

```typescript
  listRetired: protectedProcedure
    .input(z.object({ zoneId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertZoneOwnership(ctx.db, input.zoneId, ctx.userId);

      return ctx.db.query.plants.findMany({
        where: and(eq(plants.zoneId, input.zoneId), eq(plants.status, "retired")),
        orderBy: [desc(plants.retiredAt)],
      });
    }),
```

Add `desc` to the imports from `drizzle-orm` if not already there.

**Step 2: Filter active plants in context builder**

In `packages/server/src/jobs/contextBuilder.ts`, find the line where plants are fetched for zone context (line ~138). The plants come from the zone query's `with: { plants: true }`. We need to filter retired plants. Find where the zone is fetched and add a filter.

Look for the zone query — it likely uses `db.query.zones.findFirst` with `with: { plants: true }`. After the query result, filter the plants:

```typescript
// After fetching zone, filter to active plants only
const activePlants = zone.plants.filter((p) => p.status !== "retired");
```

Then use `activePlants` instead of `zone.plants` in the context building block (line ~138).

**Step 3: Filter in gardens.list query**

In `packages/server/src/routers/gardens.ts`, the `list` query (line ~26) returns gardens with zones with plants. The plants come from `with: { plants: true }`. Since this is a Drizzle relational query, we can't easily filter inside `with`. Instead, after the query, filter client-side or keep as-is and filter on the frontend.

**Decision:** Leave `gardens.list` unchanged — the zone and plant detail pages already handle their own queries. The gardens list is used for the garden picker, not for rendering individual plants.

**Step 4: Verify**

Run:
```bash
pnpm --filter @gardoo/server typecheck
```

**Step 5: Commit**

```bash
git add packages/server/src/routers/plants.ts packages/server/src/jobs/contextBuilder.ts
git commit -m "feat: add listRetired query and filter retired plants from analysis context"
```

---

### Task 4: Web — Retire button on plant detail page

**Files:**
- Modify: `packages/web/src/app/garden/[zoneId]/[plantId]/page.tsx`

**Step 1: Add retirement state and mutation**

Near the top of the component (after line ~81 where `expandedPhoto` is), add:

```typescript
  const [showRetireModal, setShowRetireModal] = useState(false);
  const [retireReason, setRetireReason] = useState<string>("harvested");

  const retirePlantMutation = trpc.plants.retire.useMutation({
    async onSuccess() {
      await utils.zones.get.invalidate({ id: zoneId });
      await utils.zones.list.invalidate();
      router.push(`/garden/${zoneId}`);
    },
  });
```

**Step 2: Add Retire button next to Delete button**

Find the Delete button in view mode (around line ~474). Add a Retire button before it:

```tsx
<button
  onClick={() => setShowRetireModal(true)}
  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100"
>
  Retire
</button>
```

**Step 3: Add retirement modal**

After the existing delete confirmation modal (around line ~501), add:

```tsx
{showRetireModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <h3 className="text-lg font-bold text-gray-900">Retire Plant</h3>
      <p className="mt-1 text-sm text-gray-500">
        Retiring preserves all care logs and history. Why is this plant being retired?
      </p>
      <div className="mt-4 space-y-2">
        {(["harvested", "died", "removed", "relocated"] as const).map((reason) => (
          <label key={reason} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 cursor-pointer hover:bg-gray-50">
            <input
              type="radio"
              name="retireReason"
              value={reason}
              checked={retireReason === reason}
              onChange={() => setRetireReason(reason)}
              className="accent-[#2D7D46]"
            />
            <span className="text-sm font-medium capitalize text-gray-700">{reason}</span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => retirePlantMutation.mutate({ id: plantId, reason: retireReason as "harvested" | "died" | "removed" | "relocated" })}
          disabled={retirePlantMutation.isPending}
          className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {retirePlantMutation.isPending ? "Retiring..." : "Retire Plant"}
        </button>
        <button
          onClick={() => setShowRetireModal(false)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
)}
```

**Step 4: Build check**

Run:
```bash
pnpm --filter @gardoo/web build
```
Expected: builds without errors.

**Step 5: Commit**

```bash
git add packages/web/src/app/garden/\[zoneId\]/\[plantId\]/page.tsx
git commit -m "feat: add retire button and modal on plant detail page"
```

---

### Task 5: Web — History tab on zone detail page

**Files:**
- Modify: `packages/web/src/app/garden/[zoneId]/page.tsx`

**Step 1: Add "History" to the tab type and list**

Find the tab definition (line ~63):

```typescript
type Tab = "plants" | "careLogs" | "tasks" | "photos";
```

Change to:

```typescript
type Tab = "plants" | "careLogs" | "tasks" | "photos" | "history";
```

And add to the `TABS` array:

```typescript
const TABS: { key: Tab; label: string }[] = [
  { key: "plants", label: "Plants" },
  { key: "tasks", label: "Tasks" },
  { key: "careLogs", label: "Care Logs" },
  { key: "photos", label: "Photos" },
  { key: "history", label: "History" },
];
```

**Step 2: Add the retired plants query**

Near the other queries (around line ~80), add:

```typescript
  const retiredPlantsQuery = trpc.plants.listRetired.useQuery(
    { zoneId },
    { enabled: !!zoneId },
  );
```

**Step 3: Add the History tab content**

Find where the tab content is rendered (after the Photos tab section). Add:

```tsx
{activeTab === "history" && (
  <div>
    {retiredPlantsQuery.isLoading ? (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
    ) : (retiredPlantsQuery.data?.length ?? 0) === 0 ? (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-400">No retired plants.</p>
      </div>
    ) : (
      <div className="space-y-3">
        {retiredPlantsQuery.data?.map((plant) => (
          <Link
            key={plant.id}
            href={`/garden/${zoneId}/${plant.id}`}
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100">
              {plant.photoUrl ? (
                <Photo src={plant.photoUrl} alt={plant.name} className="h-full w-full rounded-lg object-cover" />
              ) : (
                <span className="text-xl opacity-50">{"\uD83C\uDF31"}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-600 line-through">{plant.name}</p>
              {plant.variety && <p className="text-sm text-gray-400">{plant.variety}</p>}
            </div>
            <div className="text-right shrink-0">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                plant.retiredReason === "harvested" ? "bg-green-100 text-green-700" :
                plant.retiredReason === "died" ? "bg-red-100 text-red-700" :
                plant.retiredReason === "relocated" ? "bg-blue-100 text-blue-700" :
                "bg-gray-100 text-gray-600"
              }`}>
                {plant.retiredReason ?? "retired"}
              </span>
              {plant.retiredAt && (
                <p className="mt-1 text-xs text-gray-400">{new Date(plant.retiredAt).toLocaleDateString()}</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    )}
  </div>
)}
```

**Step 4: Build check**

Run:
```bash
pnpm --filter @gardoo/web build
```

**Step 5: Commit**

```bash
git add packages/web/src/app/garden/\[zoneId\]/page.tsx
git commit -m "feat: add History tab showing retired plants on zone detail page"
```

---

### Task 6: Server — zones.rescan endpoint

**Files:**
- Modify: `packages/server/src/routers/zones.ts`

**Step 1: Add the rescan mutation**

This endpoint takes a zone photo, sends it to the AI along with the current plant inventory, and returns a structured diff.

Add to the zones router:

```typescript
  rescan: protectedProcedure
    .input(
      z.object({
        zoneId: z.string().uuid(),
        imageBase64: z.string(),
        mediaType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const zone = await ctx.db.query.zones.findFirst({
        where: eq(zones.id, input.zoneId),
        with: { plants: true, garden: true },
      });
      if (!zone || zone.garden.userId !== ctx.userId) {
        throw new Error("Zone not found");
      }

      const activePlants = zone.plants.filter((p) => p.status !== "retired");

      const currentInventory = activePlants.map((p) => ({
        id: p.id,
        name: p.name,
        variety: p.variety ?? undefined,
        growthStage: p.growthStage ?? undefined,
      }));

      const systemPrompt = `You are a garden plant identification expert. You are given a photo of a garden zone and the current plant inventory for that zone.

Compare what you see in the photo to the current inventory and return a JSON object with three arrays:

1. "newPlants" — plants visible in the photo that are NOT in the current inventory. Include name and variety if identifiable.
2. "missingPlants" — plants in the current inventory that you do NOT see in the photo. Include the plantId from the inventory and suggest a reason (harvested, died, removed).
3. "growthUpdates" — plants in the inventory whose growth stage appears different from what's recorded. Include plantId, current stage (from inventory), and the new stage you observe.

Valid growth stages: Seed, Seedling, Vegetative, Budding, Flowering, Fruiting, Harvest, Dormant.

Current inventory:
${JSON.stringify(currentInventory, null, 2)}

Return ONLY valid JSON matching this schema:
{
  "newPlants": [{ "name": "string", "variety": "string or null" }],
  "missingPlants": [{ "plantId": "uuid", "name": "string", "suggestedReason": "harvested|died|removed" }],
  "growthUpdates": [{ "plantId": "uuid", "name": "string", "currentStage": "string", "newStage": "string" }]
}

If there are no changes in a category, return an empty array. Be conservative — only flag plants as missing if you're reasonably confident they should be visible but aren't. Some plants may simply be hidden behind others.`;

      // Use the same AI provider pattern as plants.identify
      const { getApiKey } = await import("../lib/getApiKey");
      const { ClaudeProvider } = await import("../ai/claude");
      const { KimiProvider } = await import("../ai/kimi");

      const claudeKey = await getApiKey(ctx.db, zone.garden.userId, "claude");
      const kimi = await getApiKey(ctx.db, zone.garden.userId, "kimi");

      let responseText: string | undefined;

      if (claudeKey) {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey: claudeKey });
        const msg = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: input.mediaType ?? "image/jpeg",
                    data: input.imageBase64,
                  },
                },
                { type: "text", text: systemPrompt },
              ],
            },
          ],
        });
        const textBlock = msg.content.find((b) => b.type === "text");
        responseText = textBlock?.text;
      } else if (kimi) {
        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({
          apiKey: kimi,
          baseURL: "https://api.moonshot.cn/v1",
        });
        const resp = await client.chat.completions.create({
          model: "moonshot-v1-8k",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${input.mediaType ?? "image/jpeg"};base64,${input.imageBase64}`,
                  },
                },
                { type: "text", text: systemPrompt },
              ],
            },
          ],
        });
        responseText = resp.choices[0]?.message?.content ?? undefined;
      } else {
        throw new Error("No AI API key configured. Add a Claude or Kimi key in Settings.");
      }

      if (!responseText) {
        throw new Error("AI returned empty response");
      }

      // Parse JSON from response (may be wrapped in markdown code block)
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, responseText];
      const parsed = JSON.parse(jsonMatch[1]!.trim());

      // Validate structure
      const rescanSchema = z.object({
        newPlants: z.array(z.object({ name: z.string(), variety: z.string().nullable().optional() })),
        missingPlants: z.array(z.object({
          plantId: z.string(),
          name: z.string(),
          suggestedReason: z.enum(["harvested", "died", "removed"]).optional(),
        })),
        growthUpdates: z.array(z.object({
          plantId: z.string(),
          name: z.string(),
          currentStage: z.string(),
          newStage: z.string(),
        })),
      });

      return rescanSchema.parse(parsed);
    }),
```

You will need to add imports for `zones` schema, `eq`, and `z` — check which are already imported in the file.

**Step 2: Typecheck**

Run:
```bash
pnpm --filter @gardoo/server typecheck
```

**Step 3: Commit**

```bash
git add packages/server/src/routers/zones.ts
git commit -m "feat: add zones.rescan endpoint for AI photo diff"
```

---

### Task 7: Server — zones.applyRescan endpoint

**Files:**
- Modify: `packages/server/src/routers/zones.ts`

**Step 1: Add the applyRescan mutation**

Add after the `rescan` mutation:

```typescript
  applyRescan: protectedProcedure
    .input(
      z.object({
        zoneId: z.string().uuid(),
        photoUrl: z.string().optional(),
        newPlants: z.array(z.object({ name: z.string(), variety: z.string().optional() })),
        retirePlants: z.array(z.object({ plantId: z.string().uuid(), reason: z.enum(["harvested", "died", "removed", "relocated"]) })),
        growthUpdates: z.array(z.object({ plantId: z.string().uuid(), newStage: z.string() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertZoneOwnership(ctx.db, input.zoneId, ctx.userId);

      // Update zone photo if provided
      if (input.photoUrl) {
        await ctx.db.update(zones).set({ photoUrl: input.photoUrl }).where(eq(zones.id, input.zoneId));
      }

      // Create new plants
      for (const p of input.newPlants) {
        await ctx.db.insert(plants).values({
          zoneId: input.zoneId,
          name: p.name,
          variety: p.variety,
        });
      }

      // Retire plants
      for (const r of input.retirePlants) {
        await ctx.db
          .update(plants)
          .set({ status: "retired", retiredAt: new Date(), retiredReason: r.reason })
          .where(eq(plants.id, r.plantId));

        await ctx.db.insert(careLogs).values({
          targetType: "plant",
          targetId: r.plantId,
          actionType: "other",
          notes: `Plant retired via zone re-scan: ${r.reason}`,
        });

        // Cancel pending tasks
        await ctx.db
          .update(tasks)
          .set({ status: "cancelled", completedAt: new Date(), completedVia: "retirement" })
          .where(and(eq(tasks.targetType, "plant"), eq(tasks.targetId, r.plantId), eq(tasks.status, "pending")));
      }

      // Update growth stages
      for (const g of input.growthUpdates) {
        await ctx.db.update(plants).set({ growthStage: g.newStage }).where(eq(plants.id, g.plantId));
      }

      return { success: true as const };
    }),
```

You will need to add `plants`, `careLogs`, `tasks` to the schema imports and `and` from drizzle-orm.

**Step 2: Typecheck**

Run:
```bash
pnpm --filter @gardoo/server typecheck
```

**Step 3: Commit**

```bash
git add packages/server/src/routers/zones.ts
git commit -m "feat: add zones.applyRescan endpoint to apply diff changes"
```

---

### Task 8: Web — Re-scan UI on zone detail page

**Files:**
- Modify: `packages/web/src/app/garden/[zoneId]/page.tsx`

**Step 1: Add rescan state and mutations**

Near the other state declarations, add:

```typescript
  /* Re-scan state */
  const [showRescan, setShowRescan] = useState(false);
  const [rescanPhotoPreview, setRescanPhotoPreview] = useState<string | null>(null);
  const [rescanPhotoBase64, setRescanPhotoBase64] = useState<string | null>(null);
  const [rescanPhotoKey, setRescanPhotoKey] = useState<string | null>(null);
  const [rescanDiff, setRescanDiff] = useState<{
    newPlants: { name: string; variety?: string | null; selected: boolean }[];
    missingPlants: { plantId: string; name: string; suggestedReason?: string; selected: boolean }[];
    growthUpdates: { plantId: string; name: string; currentStage: string; newStage: string; selected: boolean }[];
  } | null>(null);

  const rescanMutation = trpc.zones.rescan.useMutation({
    onSuccess(data) {
      setRescanDiff({
        newPlants: data.newPlants.map((p) => ({ ...p, selected: true })),
        missingPlants: data.missingPlants.map((p) => ({ ...p, selected: true })),
        growthUpdates: data.growthUpdates.map((p) => ({ ...p, selected: true })),
      });
    },
  });

  const applyRescanMutation = trpc.zones.applyRescan.useMutation({
    onSuccess() {
      zoneQuery.refetch();
      retiredPlantsQuery.refetch();
      setShowRescan(false);
      setRescanDiff(null);
      setRescanPhotoPreview(null);
      setRescanPhotoBase64(null);
      setRescanPhotoKey(null);
    },
  });
```

**Step 2: Add photo upload handler for rescan**

```typescript
  const handleRescanPhotoUpload = useCallback(
    async (file: File) => {
      try {
        const { blob, dataUrl, base64 } = await resizeImage(file);
        setRescanPhotoPreview(dataUrl);
        setRescanPhotoBase64(base64);
        // Upload to R2 for zone photo update
        const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
          targetType: "zone",
          targetId: zoneId,
          contentType: "image/jpeg",
        });
        await uploadToR2(uploadUrl, blob);
        setRescanPhotoKey(key);
        // Trigger AI rescan
        rescanMutation.mutate({
          zoneId,
          imageBase64: base64,
          mediaType: "image/jpeg",
        });
      } catch (err) {
        console.error("Rescan photo upload failed:", err);
        setRescanPhotoPreview(null);
        setRescanPhotoBase64(null);
      }
    },
    [zoneId, getUploadUrlMutation, rescanMutation],
  );
```

**Step 3: Add "Re-scan Zone" button in the Plants tab header**

Find the "Add Plant" button (around line ~640). Add a re-scan button next to it:

```tsx
<button
  onClick={() => setShowRescan(true)}
  className="rounded-lg border border-[#2D7D46] px-3 py-1.5 text-sm font-medium text-[#2D7D46] transition-colors hover:bg-green-50"
>
  Re-scan Zone
</button>
```

**Step 4: Add the re-scan overlay/modal**

After the expanded photo overlay section, add:

```tsx
{showRescan && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
      <h3 className="text-lg font-bold text-gray-900">Re-scan Zone</h3>
      <p className="mt-1 text-sm text-gray-500">
        Upload a new photo and AI will detect what changed — new plants, removed plants, and growth updates.
      </p>

      {!rescanPhotoPreview ? (
        <label className="mt-4 flex h-40 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-[#2D7D46]">
          <div className="text-center text-gray-400">
            <span className="block text-3xl">{"\uD83D\uDCF7"}</span>
            <span className="mt-1 text-sm">Upload zone photo</span>
          </div>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleRescanPhotoUpload(file);
            }}
          />
        </label>
      ) : (
        <img src={rescanPhotoPreview} alt="Re-scan" className="mt-4 w-full rounded-xl object-cover" />
      )}

      {rescanMutation.isPending && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-sm text-blue-700">Analyzing photo...</span>
        </div>
      )}

      {rescanMutation.isError && (
        <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">Analysis failed. Make sure you have an AI API key configured in Settings.</p>
        </div>
      )}

      {rescanDiff && (
        <div className="mt-4 space-y-4">
          {rescanDiff.newPlants.length === 0 && rescanDiff.missingPlants.length === 0 && rescanDiff.growthUpdates.length === 0 && (
            <p className="text-sm text-gray-500">No changes detected.</p>
          )}

          {rescanDiff.newPlants.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-green-700">New Plants</h4>
              <div className="mt-1 space-y-1">
                {rescanDiff.newPlants.map((p, i) => (
                  <label key={i} className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.selected}
                      onChange={() => {
                        const updated = [...rescanDiff.newPlants];
                        updated[i] = { ...updated[i], selected: !updated[i].selected };
                        setRescanDiff({ ...rescanDiff, newPlants: updated });
                      }}
                      className="accent-green-600"
                    />
                    <span className="text-sm text-green-900">{p.name}{p.variety ? ` (${p.variety})` : ""}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {rescanDiff.missingPlants.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-amber-700">Missing Plants</h4>
              <div className="mt-1 space-y-1">
                {rescanDiff.missingPlants.map((p, i) => (
                  <label key={i} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.selected}
                      onChange={() => {
                        const updated = [...rescanDiff.missingPlants];
                        updated[i] = { ...updated[i], selected: !updated[i].selected };
                        setRescanDiff({ ...rescanDiff, missingPlants: updated });
                      }}
                      className="accent-amber-600"
                    />
                    <span className="text-sm text-amber-900">{p.name}</span>
                    <select
                      value={p.suggestedReason ?? "removed"}
                      onChange={(e) => {
                        const updated = [...rescanDiff.missingPlants];
                        updated[i] = { ...updated[i], suggestedReason: e.target.value };
                        setRescanDiff({ ...rescanDiff, missingPlants: updated });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="ml-auto rounded border border-amber-200 bg-white px-2 py-0.5 text-xs"
                    >
                      <option value="harvested">Harvested</option>
                      <option value="died">Died</option>
                      <option value="removed">Removed</option>
                      <option value="relocated">Relocated</option>
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}

          {rescanDiff.growthUpdates.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-blue-700">Growth Updates</h4>
              <div className="mt-1 space-y-1">
                {rescanDiff.growthUpdates.map((p, i) => (
                  <label key={i} className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.selected}
                      onChange={() => {
                        const updated = [...rescanDiff.growthUpdates];
                        updated[i] = { ...updated[i], selected: !updated[i].selected };
                        setRescanDiff({ ...rescanDiff, growthUpdates: updated });
                      }}
                      className="accent-blue-600"
                    />
                    <span className="text-sm text-blue-900">
                      {p.name}: {p.currentStage} {"\u2192"} {p.newStage}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => {
              applyRescanMutation.mutate({
                zoneId,
                photoUrl: rescanPhotoKey || undefined,
                newPlants: rescanDiff.newPlants.filter((p) => p.selected).map((p) => ({ name: p.name, variety: p.variety ?? undefined })),
                retirePlants: rescanDiff.missingPlants.filter((p) => p.selected).map((p) => ({
                  plantId: p.plantId,
                  reason: (p.suggestedReason ?? "removed") as "harvested" | "died" | "removed" | "relocated",
                })),
                growthUpdates: rescanDiff.growthUpdates.filter((p) => p.selected).map((p) => ({
                  plantId: p.plantId,
                  newStage: p.newStage,
                })),
              });
            }}
            disabled={applyRescanMutation.isPending}
            className="w-full rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white hover:bg-[#246838] disabled:opacity-50"
          >
            {applyRescanMutation.isPending ? "Applying..." : "Apply Changes"}
          </button>
        </div>
      )}

      <button
        onClick={() => {
          setShowRescan(false);
          setRescanDiff(null);
          setRescanPhotoPreview(null);
          setRescanPhotoBase64(null);
          setRescanPhotoKey(null);
        }}
        className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Cancel
      </button>
    </div>
  </div>
)}
```

**Step 5: Build check**

Run:
```bash
pnpm --filter @gardoo/web build
```

**Step 6: Commit**

```bash
git add packages/web/src/app/garden/\[zoneId\]/page.tsx
git commit -m "feat: add zone re-scan UI with AI diff review and apply"
```

---

### Task 9: Register new endpoints in the router

**Files:**
- Modify: `packages/server/src/router.ts` (if endpoints need registering)

**Step 1: Check if routers auto-register**

Read `packages/server/src/router.ts`. The zones and plants routers should already be registered. The new `retire`, `listRetired`, `rescan`, and `applyRescan` endpoints are added to existing routers, so they should auto-register. Verify by running:

```bash
pnpm --filter @gardoo/web build
```

If the build succeeds, all endpoints are accessible. If not, check the router file.

**Step 2: Final commit**

If any router changes were needed:
```bash
git add packages/server/src/router.ts
git commit -m "chore: register new zone and plant endpoints"
```

---

### Task 10: End-to-end verification

**Step 1: Start the dev server**

```bash
pnpm dev:web
```

**Step 2: Test plant retirement**

1. Navigate to a zone with plants
2. Click a plant to open its detail page
3. Click "Retire" button
4. Select "Harvested" and confirm
5. Verify: plant disappears from Plants tab, appears in History tab with "harvested" badge
6. Verify: pending tasks for that plant are cancelled

**Step 3: Test zone re-scan**

1. Navigate to a zone
2. Click "Re-scan Zone"
3. Upload a current photo
4. Wait for AI analysis
5. Review the diff (new plants, missing plants, growth updates)
6. Toggle some checkboxes, change a retirement reason
7. Click "Apply Changes"
8. Verify: new plants appear, retired plants move to History, growth stages update

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: plant lifecycle and zone re-scan complete"
```
