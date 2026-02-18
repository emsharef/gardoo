# Persistent Tasks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ephemeral analysis actions with persistent tasks that the AI can create, update, complete, and cancel across analysis runs.

**Architecture:** New `tasks` table with lifecycle status. AI output schema changes from flat actions to operations (create/update/complete/cancel). Context builder includes existing tasks. Server applies operations transactionally. UI queries tasks table instead of analysis_results JSONB.

**Tech Stack:** Drizzle ORM (Postgres), tRPC, Zod, Vitest, React Query (mobile + web)

---

### Task 1: Add tasks table to DB schema

**Files:**
- Modify: `packages/server/src/db/schema.ts`

**Step 1: Add new enums and table to schema.ts**

Add after the existing `priorityEnum` definition (line 34):

```typescript
export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "completed",
  "cancelled",
  "snoozed",
]);

export const completedViaEnum = pgEnum("completed_via", ["user", "ai"]);
```

Add the `tasks` table after the `careLogs` table (after line 155):

```typescript
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  gardenId: uuid("garden_id")
    .notNull()
    .references(() => gardens.id, { onDelete: "cascade" }),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id, { onDelete: "cascade" }),
  targetType: targetTypeEnum("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  actionType: actionTypeEnum("action_type").notNull(),
  priority: priorityEnum("priority").notNull(),
  status: taskStatusEnum("status").notNull().default("pending"),
  label: text("label").notNull(),
  context: text("context"),
  suggestedDate: text("suggested_date").notNull(),
  recurrence: text("recurrence"),
  photoRequested: text("photo_requested").default("false"),
  completedAt: timestamp("completed_at"),
  completedVia: completedViaEnum("completed_via"),
  careLogId: uuid("care_log_id").references(() => careLogs.id),
  sourceAnalysisId: uuid("source_analysis_id").references(() => analysisResults.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

Add relations after `analysisResultsRelations`:

```typescript
export const tasksRelations = relations(tasks, ({ one }) => ({
  garden: one(gardens, {
    fields: [tasks.gardenId],
    references: [gardens.id],
  }),
  zone: one(zones, {
    fields: [tasks.zoneId],
    references: [zones.id],
  }),
  careLog: one(careLogs, {
    fields: [tasks.careLogId],
    references: [careLogs.id],
  }),
  sourceAnalysis: one(analysisResults, {
    fields: [tasks.sourceAnalysisId],
    references: [analysisResults.id],
  }),
}));
```

**Step 2: Generate the migration**

Run: `cd packages/server && pnpm db:generate`

This will create a new SQL file in `drizzle/` (e.g., `0005_*.sql`) with the CREATE TABLE and CREATE TYPE statements.

**Step 3: Run the migration locally**

Run: `cd packages/server && pnpm db:migrate`
Expected: Migration applies successfully, `tasks` table created.

**Step 4: Verify with typecheck**

Run: `pnpm --filter @gardoo/server typecheck`
Expected: No type errors.

**Step 5: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/drizzle/
git commit -m "feat: add tasks table for persistent task lifecycle"
```

---

### Task 2: Update AI schema (Zod) for operations

**Files:**
- Modify: `packages/server/src/ai/schema.ts`

**Step 1: Write the failing test**

Create: `packages/server/src/ai/__tests__/schema.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { analysisResultSchema } from "../schema.js";

describe("analysisResultSchema", () => {
  it("should validate a create operation", () => {
    const input = {
      operations: [
        {
          op: "create",
          targetType: "plant",
          targetId: "00000000-0000-4000-a000-000000000010",
          actionType: "water",
          priority: "today",
          label: "Water the tomatoes",
          suggestedDate: "2026-02-18",
          context: "Soil is dry based on sensor readings",
        },
      ],
      observations: ["Zone looks healthy overall"],
      alerts: [],
    };
    const result = analysisResultSchema.parse(input);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].op).toBe("create");
  });

  it("should validate an update operation with partial fields", () => {
    const input = {
      operations: [
        {
          op: "update",
          taskId: "00000000-0000-4000-a000-000000000020",
          suggestedDate: "2026-02-20",
          priority: "upcoming",
        },
      ],
    };
    const result = analysisResultSchema.parse(input);
    expect(result.operations[0].op).toBe("update");
    expect(result.operations[0].taskId).toBeDefined();
  });

  it("should validate a complete operation", () => {
    const input = {
      operations: [
        {
          op: "complete",
          taskId: "00000000-0000-4000-a000-000000000020",
          reason: "Care log shows watering done yesterday",
        },
      ],
    };
    const result = analysisResultSchema.parse(input);
    expect(result.operations[0].op).toBe("complete");
  });

  it("should validate a cancel operation", () => {
    const input = {
      operations: [
        {
          op: "cancel",
          taskId: "00000000-0000-4000-a000-000000000020",
          reason: "Plant was removed from zone",
        },
      ],
    };
    const result = analysisResultSchema.parse(input);
    expect(result.operations[0].op).toBe("cancel");
  });

  it("should validate a create operation with photoRequested", () => {
    const input = {
      operations: [
        {
          op: "create",
          targetType: "plant",
          targetId: "00000000-0000-4000-a000-000000000010",
          actionType: "monitor",
          priority: "today",
          label: "Check tomato leaves for spots",
          suggestedDate: "2026-02-18",
          photoRequested: true,
        },
      ],
    };
    const result = analysisResultSchema.parse(input);
    expect(result.operations[0].photoRequested).toBe(true);
  });

  it("should validate mixed operations", () => {
    const input = {
      operations: [
        {
          op: "create",
          targetType: "zone",
          targetId: "00000000-0000-4000-a000-000000000001",
          actionType: "fertilize",
          priority: "upcoming",
          label: "Apply compost to bed",
          suggestedDate: "2026-02-22",
        },
        {
          op: "update",
          taskId: "00000000-0000-4000-a000-000000000030",
          suggestedDate: "2026-02-19",
        },
        {
          op: "complete",
          taskId: "00000000-0000-4000-a000-000000000040",
          reason: "Watering completed per care log",
        },
      ],
      observations: ["Soil moisture is good"],
    };
    const result = analysisResultSchema.parse(input);
    expect(result.operations).toHaveLength(3);
  });

  it("should reject create without required fields", () => {
    const input = {
      operations: [
        {
          op: "create",
          targetType: "plant",
          // missing targetId, actionType, priority, label, suggestedDate
        },
      ],
    };
    expect(() => analysisResultSchema.parse(input)).toThrow();
  });

  it("should reject update without taskId", () => {
    const input = {
      operations: [
        {
          op: "update",
          suggestedDate: "2026-02-20",
          // missing taskId
        },
      ],
    };
    expect(() => analysisResultSchema.parse(input)).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/ai/__tests__/schema.test.ts`
Expected: FAIL — `operations` is not a recognized field in the current schema.

**Step 3: Replace schema.ts with the new operations-based schema**

Replace the entire content of `packages/server/src/ai/schema.ts`:

```typescript
import { z } from "zod";

const baseOperationFields = z.object({
  targetType: z.enum(["zone", "plant"]).optional(),
  targetId: z.string().uuid().optional(),
  actionType: z
    .enum([
      "water",
      "fertilize",
      "harvest",
      "prune",
      "plant",
      "monitor",
      "protect",
      "other",
    ])
    .optional(),
  priority: z.enum(["urgent", "today", "upcoming", "informational"]).optional(),
  label: z.string().max(60).optional(),
  suggestedDate: z.string().optional(),
  context: z.string().max(200).optional(),
  recurrence: z.string().optional(),
  photoRequested: z.boolean().optional(),
});

export const createOperationSchema = baseOperationFields.extend({
  op: z.literal("create"),
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
});

export const updateOperationSchema = baseOperationFields.extend({
  op: z.literal("update"),
  taskId: z.string().uuid(),
});

export const completeOperationSchema = z.object({
  op: z.literal("complete"),
  taskId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

export const cancelOperationSchema = z.object({
  op: z.literal("cancel"),
  taskId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

export const analysisOperationSchema = z.discriminatedUnion("op", [
  createOperationSchema,
  updateOperationSchema,
  completeOperationSchema,
  cancelOperationSchema,
]);

export const analysisResultSchema = z.object({
  operations: z.array(analysisOperationSchema),
  observations: z.array(z.string()).optional(),
  alerts: z.array(z.string()).optional(),
});

export type AnalysisOperation = z.infer<typeof analysisOperationSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
```

**Step 4: Update the AnalysisResult interface in schema.ts (DB types)**

In `packages/server/src/db/schema.ts`, update the `AnalysisResult` interface (around line 62) to match the new shape:

```typescript
export interface AnalysisOperation {
  op: "create" | "update" | "complete" | "cancel";
  taskId?: string;
  targetType?: string;
  targetId?: string;
  actionType?: string;
  priority?: string;
  label?: string;
  suggestedDate?: string;
  context?: string;
  recurrence?: string;
  photoRequested?: boolean;
  reason?: string;
}

export interface AnalysisResult {
  operations: AnalysisOperation[];
  observations: string[];
  alerts: string[];
}
```

Remove the old `AnalysisAction` interface (lines 61-70) since it's replaced by `AnalysisOperation`.

**Step 5: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/ai/__tests__/schema.test.ts`
Expected: All 8 tests PASS.

**Step 6: Run typecheck**

Run: `pnpm --filter @gardoo/server typecheck`
Expected: May show errors in files that reference the old `AnalysisAction` type or `actions` field — that's expected, we'll fix those in subsequent tasks.

**Step 7: Commit**

```bash
git add packages/server/src/ai/schema.ts packages/server/src/ai/__tests__/schema.test.ts packages/server/src/db/schema.ts
git commit -m "feat: replace flat actions schema with operations-based schema"
```

---

### Task 3: Update system prompt and context builder

**Files:**
- Modify: `packages/server/src/ai/provider.ts`
- Modify: `packages/server/src/jobs/contextBuilder.ts`

**Step 1: Add existing tasks to AnalysisContext**

In `packages/server/src/ai/provider.ts`, add to the `AnalysisContext` interface (after `photos?` on line 39):

```typescript
  existingTasks?: Array<{
    id: string;
    targetType: string;
    targetId: string;
    actionType: string;
    priority: string;
    status: string;
    label: string;
    suggestedDate: string;
    context?: string;
    recurrence?: string;
    photoRequested?: boolean;
    completedAt?: string;
    completedVia?: string;
  }>;
```

**Step 2: Update `buildAnalysisSystemPrompt` in provider.ts**

Replace the output format section (lines 78-120) with the new operations schema:

```typescript
  lines.push("## Output Format");
  lines.push("");
  lines.push(
    "Respond ONLY with a JSON object matching this schema (no extra text, no markdown fences):",
  );
  lines.push("```");
  lines.push("{");
  lines.push('  "operations": [');
  lines.push("    {");
  lines.push(
    '      "op": "create" | "update" | "complete" | "cancel",',
  );
  lines.push(
    '      "taskId": "<uuid>",                     // REQUIRED for update/complete/cancel — the existing task id',
  );
  lines.push(
    '      "targetType": "zone" | "plant",           // REQUIRED for create',
  );
  lines.push(
    '      "targetId": "<uuid>",                     // REQUIRED for create — the zone or plant id',
  );
  lines.push(
    '      "actionType": "water" | "fertilize" | "harvest" | "prune" | "plant" | "monitor" | "protect" | "other",  // REQUIRED for create',
  );
  lines.push(
    '      "priority": "urgent" | "today" | "upcoming" | "informational",  // REQUIRED for create, optional for update',
  );
  lines.push(
    '      "label": "Short human-readable label (max 60 chars)",           // REQUIRED for create, optional for update',
  );
  lines.push(
    '      "suggestedDate": "YYYY-MM-DD",            // REQUIRED for create, optional for update',
  );
  lines.push(
    '      "context": "Brief explanation (max 200 chars, optional)"',
  );
  lines.push(
    '      "recurrence": "optional hint, e.g. every 3 days"',
  );
  lines.push(
    '      "photoRequested": true,                   // optional — set on monitor tasks when you need a fresh photo',
  );
  lines.push(
    '      "reason": "why this task is being completed or cancelled"  // optional for complete/cancel',
  );
  lines.push("    }");
  lines.push("  ],");
  lines.push(
    '  "observations": ["Free-text observations about the zone (optional)"],',
  );
  lines.push(
    '  "alerts": ["Urgent warnings that need attention (optional)"]',
  );
  lines.push("}");
  lines.push("```");
```

Add the existing tasks section after the sensor readings section (after line 187) and before the weather section:

```typescript
  if (context.existingTasks && context.existingTasks.length > 0) {
    lines.push("");
    lines.push("## Existing Tasks");
    lines.push("");

    const pending = context.existingTasks.filter(
      (t) => t.status === "pending",
    );
    const recent = context.existingTasks.filter(
      (t) => t.status === "completed" || t.status === "cancelled",
    );

    if (pending.length > 0) {
      lines.push("### Pending");
      lines.push("");
      for (const task of pending) {
        lines.push(
          `- Task ${task.id}: [${task.actionType}] "${task.label}" for ${task.targetType} (${task.targetId})`,
        );
        let details = `  Priority: ${task.priority} | Due: ${task.suggestedDate}`;
        if (task.recurrence) details += ` | Recurrence: ${task.recurrence}`;
        if (task.photoRequested) details += ` | Photo requested`;
        lines.push(details);
        if (task.context) lines.push(`  Context: ${task.context}`);
      }
    }

    if (recent.length > 0) {
      lines.push("");
      lines.push("### Recently Resolved (last 7 days)");
      lines.push("");
      for (const task of recent) {
        const via = task.completedVia ? ` by ${task.completedVia}` : "";
        const date = task.completedAt
          ? ` on ${task.completedAt.split("T")[0]}`
          : "";
        lines.push(
          `- Task ${task.id}: [${task.actionType}] "${task.label}" — ${task.status}${via}${date}`,
        );
        if (task.recurrence) {
          lines.push(`  Recurrence: ${task.recurrence}`);
        }
      }
    }
  }
```

Update the instructions section (lines 215-231) to reference operations:

```typescript
  lines.push("");
  lines.push("## Instructions");
  lines.push("");
  lines.push(
    "1. Review the existing pending tasks first. Do NOT create duplicates of tasks that already exist.",
  );
  lines.push(
    "2. Use 'update' to reschedule overdue or misaligned tasks (change suggestedDate, priority, etc.).",
  );
  lines.push(
    "3. Use 'complete' when care logs, sensor data, or photos show the work is done.",
  );
  lines.push(
    "4. Use 'cancel' when a task is no longer relevant (plant removed, condition resolved, etc.).",
  );
  lines.push(
    "5. Use 'create' only for genuinely new work not covered by existing tasks.",
  );
  lines.push(
    "6. For recurring tasks that were recently completed, create the next occurrence with an appropriate future date.",
  );
  lines.push(
    "7. Prioritize: 'urgent' means within 24 hours, 'today' means do it today, 'upcoming' within a week, 'informational' is FYI.",
  );
  lines.push(
    "8. Set 'photoRequested: true' on monitor tasks when you haven't seen the zone/plant recently and want a fresh photo.",
  );
  lines.push(
    "9. If photos are attached, analyze them for visible issues like wilting, discoloration, pests, or disease symptoms.",
  );
  lines.push(
    "10. Include observations about overall zone health and alerts for problems (pest, disease, frost, drought).",
  );
```

**Step 3: Add task loading to contextBuilder.ts**

In `packages/server/src/jobs/contextBuilder.ts`, add the import for `tasks` at line 8:

```typescript
import {
  gardens,
  zones,
  plants,
  careLogs,
  sensors,
  sensorReadings,
  tasks,
} from "../db/schema.js";
```

Add task loading to `buildZoneContext` — after step 4 (sensor readings, around line 93) and before step 5 (format into AnalysisContext):

```typescript
  // 4.5. Load existing tasks for this zone
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const pendingTasks = await db
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.zoneId, zoneId), eq(tasks.status, "pending")),
    );

  const recentlyResolvedTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.zoneId, zoneId),
        inArray(tasks.status, ["completed", "cancelled"]),
        gte(tasks.completedAt, sevenDaysAgo),
      ),
    );

  const allTasks = [...pendingTasks, ...recentlyResolvedTasks];
```

Then in step 5, add existing tasks to the context object (before the weather section, around line 141):

```typescript
  // Include existing tasks in context
  if (allTasks.length > 0) {
    context.existingTasks = allTasks.map((t) => ({
      id: t.id,
      targetType: t.targetType,
      targetId: t.targetId,
      actionType: t.actionType,
      priority: t.priority,
      status: t.status,
      label: t.label,
      suggestedDate: t.suggestedDate,
      ...(t.context ? { context: t.context } : {}),
      ...(t.recurrence ? { recurrence: t.recurrence } : {}),
      ...(t.photoRequested === "true" ? { photoRequested: true } : {}),
      ...(t.completedAt
        ? { completedAt: t.completedAt.toISOString() }
        : {}),
      ...(t.completedVia ? { completedVia: t.completedVia } : {}),
    }));
  }
```

**Step 4: Run typecheck**

Run: `pnpm --filter @gardoo/server typecheck`
Expected: Passes (or only shows errors in files we haven't updated yet — dailyAnalysis.ts, gardens.ts).

**Step 5: Commit**

```bash
git add packages/server/src/ai/provider.ts packages/server/src/jobs/contextBuilder.ts
git commit -m "feat: include existing tasks in analysis context and update system prompt"
```

---

### Task 4: Update daily analysis job to apply operations

**Files:**
- Modify: `packages/server/src/jobs/dailyAnalysis.ts`

**Step 1: Replace the storage logic in handleAnalyzeZone**

In `packages/server/src/jobs/dailyAnalysis.ts`, add imports at the top:

```typescript
import {
  gardens,
  weatherCache,
  analysisResults,
  tasks,
  type AnalysisResult,
} from "../db/schema.js";
```

Replace lines 186-205 (from `// Validate the result` to `// Store in the database` block) with:

```typescript
      // Validate the result against the schema
      const validated = analysisResultSchema.parse(result);

      // Normalize optional fields for DB storage
      const dbResult: AnalysisResult = {
        operations: validated.operations,
        observations: validated.observations ?? [],
        alerts: validated.alerts ?? [],
      };

      // Store raw AI response as audit log
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

      // Apply operations to the tasks table
      for (const op of validated.operations) {
        try {
          switch (op.op) {
            case "create": {
              await db.insert(tasks).values({
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
                  eq(tasks.id, op.taskId!),
                  eq(tasks.zoneId, zoneId),
                  eq(tasks.status, "pending"),
                ),
              });
              if (!existing) {
                console.warn(
                  `[analyze-zone] Update op references unknown/non-pending task ${op.taskId}, skipping`,
                );
                break;
              }
              const updates: Record<string, unknown> = {
                updatedAt: new Date(),
                sourceAnalysisId: analysisRow.id,
              };
              if (op.suggestedDate !== undefined)
                updates.suggestedDate = op.suggestedDate;
              if (op.priority !== undefined) updates.priority = op.priority;
              if (op.label !== undefined) updates.label = op.label;
              if (op.context !== undefined) updates.context = op.context;
              if (op.recurrence !== undefined)
                updates.recurrence = op.recurrence;
              if (op.photoRequested !== undefined)
                updates.photoRequested = op.photoRequested ? "true" : "false";
              await db
                .update(tasks)
                .set(updates)
                .where(eq(tasks.id, op.taskId!));
              break;
            }
            case "complete": {
              const existing = await db.query.tasks.findFirst({
                where: and(
                  eq(tasks.id, op.taskId!),
                  eq(tasks.zoneId, zoneId),
                  eq(tasks.status, "pending"),
                ),
              });
              if (!existing) {
                console.warn(
                  `[analyze-zone] Complete op references unknown/non-pending task ${op.taskId}, skipping`,
                );
                break;
              }
              await db
                .update(tasks)
                .set({
                  status: "completed",
                  completedAt: new Date(),
                  completedVia: "ai",
                  context: op.reason ?? existing.context,
                  updatedAt: new Date(),
                  sourceAnalysisId: analysisRow.id,
                })
                .where(eq(tasks.id, op.taskId!));
              break;
            }
            case "cancel": {
              const existing = await db.query.tasks.findFirst({
                where: and(
                  eq(tasks.id, op.taskId!),
                  eq(tasks.zoneId, zoneId),
                  eq(tasks.status, "pending"),
                ),
              });
              if (!existing) {
                console.warn(
                  `[analyze-zone] Cancel op references unknown/non-pending task ${op.taskId}, skipping`,
                );
                break;
              }
              await db
                .update(tasks)
                .set({
                  status: "cancelled",
                  completedAt: new Date(),
                  context: op.reason ?? existing.context,
                  updatedAt: new Date(),
                  sourceAnalysisId: analysisRow.id,
                })
                .where(eq(tasks.id, op.taskId!));
              break;
            }
          }
        } catch (opErr) {
          console.error(
            `[analyze-zone] Failed to apply ${op.op} operation:`,
            opErr,
          );
          // Continue with remaining operations
        }
      }
```

**Step 2: Run typecheck**

Run: `pnpm --filter @gardoo/server typecheck`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/server/src/jobs/dailyAnalysis.ts
git commit -m "feat: apply AI operations to tasks table in analysis job"
```

---

### Task 5: Add tasks router with complete/snooze/dismiss endpoints

**Files:**
- Create: `packages/server/src/routers/tasks.ts`
- Modify: `packages/server/src/router.ts`

**Step 1: Write the failing test**

Create: `packages/server/src/routers/__tests__/tasks.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { createTestCaller } from "../../test-utils.js";
import { db } from "../../db/index.js";
import { tasks, gardens, zones } from "../../db/schema.js";
import { eq } from "drizzle-orm";

describe("tasks router", () => {
  const TEST_USER_ID = "00000000-0000-4000-a000-000000000001";
  const OTHER_USER_ID = "00000000-0000-4000-a000-000000000002";

  async function createTestTask(gardenId: string, zoneId: string) {
    const [task] = await db
      .insert(tasks)
      .values({
        gardenId,
        zoneId,
        targetType: "zone",
        targetId: zoneId,
        actionType: "water",
        priority: "today",
        status: "pending",
        label: "Water the bed",
        suggestedDate: "2026-02-18",
      })
      .returning();
    return task;
  }

  it("should complete a task and create a care log", async () => {
    const caller = createTestCaller(TEST_USER_ID);
    const garden = await caller.gardens.create({ name: "Task Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Test Bed",
    });
    const task = await createTestTask(garden.id, zone.id);

    const result = await caller.tasks.complete({
      taskId: task.id,
      notes: "Done watering",
    });

    expect(result.task.status).toBe("completed");
    expect(result.task.completedVia).toBe("user");
    expect(result.careLog).toBeDefined();
    expect(result.careLog.actionType).toBe("water");
  });

  it("should snooze a task to a new date", async () => {
    const caller = createTestCaller(TEST_USER_ID);
    const garden = await caller.gardens.create({ name: "Snooze Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Snooze Bed",
    });
    const task = await createTestTask(garden.id, zone.id);

    const result = await caller.tasks.snooze({
      taskId: task.id,
      newDate: "2026-02-25",
    });

    expect(result.suggestedDate).toBe("2026-02-25");
    expect(result.status).toBe("pending");
  });

  it("should dismiss a task", async () => {
    const caller = createTestCaller(TEST_USER_ID);
    const garden = await caller.gardens.create({
      name: "Dismiss Test Garden",
    });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Dismiss Bed",
    });
    const task = await createTestTask(garden.id, zone.id);

    const result = await caller.tasks.dismiss({ taskId: task.id });

    expect(result.status).toBe("cancelled");
  });

  it("should throw when completing another user's task", async () => {
    const caller1 = createTestCaller(TEST_USER_ID);
    const caller2 = createTestCaller(OTHER_USER_ID);
    const garden = await caller1.gardens.create({ name: "Owned Garden" });
    const zone = await caller1.zones.create({
      gardenId: garden.id,
      name: "Owned Bed",
    });
    const task = await createTestTask(garden.id, zone.id);

    await expect(
      caller2.tasks.complete({ taskId: task.id }),
    ).rejects.toThrow();
  });

  it("should throw when completing an already completed task", async () => {
    const caller = createTestCaller(TEST_USER_ID);
    const garden = await caller.gardens.create({
      name: "Double Complete Garden",
    });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Double Bed",
    });
    const task = await createTestTask(garden.id, zone.id);

    await caller.tasks.complete({ taskId: task.id });
    await expect(
      caller.tasks.complete({ taskId: task.id }),
    ).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/routers/__tests__/tasks.test.ts`
Expected: FAIL — `tasks` router doesn't exist yet.

**Step 3: Create the tasks router**

Create `packages/server/src/routers/tasks.ts`:

```typescript
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { tasks, careLogs } from "../db/schema.js";
import { assertZoneOwnership } from "../lib/ownership.js";

export const tasksRouter = router({
  complete: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        notes: z.string().optional(),
        photoUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Load the task
      const task = await ctx.db.query.tasks.findFirst({
        where: eq(tasks.id, input.taskId),
      });
      if (!task) throw new Error("Task not found");

      // Verify ownership via zone → garden → user
      await assertZoneOwnership(ctx.db, task.zoneId, ctx.userId);

      // Must be pending
      if (task.status !== "pending") {
        throw new Error("Task is not pending");
      }

      // Create the care log
      const [careLog] = await ctx.db
        .insert(careLogs)
        .values({
          targetType: task.targetType,
          targetId: task.targetId,
          actionType: task.actionType,
          notes: input.notes ?? `Completed: ${task.label}`,
          photoUrl: input.photoUrl,
        })
        .returning();

      // Mark the task completed
      const [updated] = await ctx.db
        .update(tasks)
        .set({
          status: "completed",
          completedAt: new Date(),
          completedVia: "user",
          careLogId: careLog.id,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId))
        .returning();

      return { task: updated, careLog };
    }),

  snooze: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        newDate: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.query.tasks.findFirst({
        where: eq(tasks.id, input.taskId),
      });
      if (!task) throw new Error("Task not found");

      await assertZoneOwnership(ctx.db, task.zoneId, ctx.userId);

      if (task.status !== "pending") {
        throw new Error("Task is not pending");
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set({
          suggestedDate: input.newDate,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId))
        .returning();

      return updated;
    }),

  dismiss: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.query.tasks.findFirst({
        where: eq(tasks.id, input.taskId),
      });
      if (!task) throw new Error("Task not found");

      await assertZoneOwnership(ctx.db, task.zoneId, ctx.userId);

      if (task.status !== "pending") {
        throw new Error("Task is not pending");
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set({
          status: "cancelled",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId))
        .returning();

      return updated;
    }),
});
```

**Step 4: Register the router**

In `packages/server/src/router.ts`, add:

```typescript
import { tasksRouter } from "./routers/tasks.js";
```

And add to the router object:

```typescript
  tasks: tasksRouter,
```

**Step 5: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/routers/__tests__/tasks.test.ts`
Expected: All 5 tests PASS.

**Step 6: Commit**

```bash
git add packages/server/src/routers/tasks.ts packages/server/src/routers/__tests__/tasks.test.ts packages/server/src/router.ts
git commit -m "feat: add tasks router with complete/snooze/dismiss endpoints"
```

---

### Task 6: Update getActions to query tasks table

**Files:**
- Modify: `packages/server/src/routers/gardens.ts`

**Step 1: Replace getActions implementation**

In `packages/server/src/routers/gardens.ts`, add the `tasks` import:

```typescript
import { gardens, analysisResults, weatherCache, tasks } from "../db/schema.js";
```

Replace the entire `getActions` endpoint (lines 98-150) with:

```typescript
  getActions: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const pendingTasks = await ctx.db.query.tasks.findMany({
        where: and(
          eq(tasks.gardenId, input.gardenId),
          eq(tasks.status, "pending"),
        ),
      });

      const priorityOrder: Record<string, number> = {
        urgent: 0,
        today: 1,
        upcoming: 2,
        informational: 3,
      };

      pendingTasks.sort(
        (a, b) =>
          (priorityOrder[a.priority] ?? 99) -
          (priorityOrder[b.priority] ?? 99),
      );

      return pendingTasks.map((t) => ({
        id: t.id,
        targetType: t.targetType,
        targetId: t.targetId,
        actionType: t.actionType,
        priority: t.priority,
        label: t.label,
        suggestedDate: t.suggestedDate,
        context: t.context,
        recurrence: t.recurrence,
        photoRequested: t.photoRequested === "true",
      }));
    }),
```

**Step 2: Run typecheck**

Run: `pnpm --filter @gardoo/server typecheck`
Expected: PASS (or only frontend errors remaining).

**Step 3: Run existing gardens tests**

Run: `cd packages/server && npx vitest run src/routers/__tests__/gardens.test.ts`
Expected: PASS — existing tests don't test getActions directly.

**Step 4: Commit**

```bash
git add packages/server/src/routers/gardens.ts
git commit -m "feat: getActions now queries tasks table instead of analysis_results JSONB"
```

---

### Task 7: Update AI providers to handle new schema

**Files:**
- Modify: `packages/server/src/ai/claude.ts`
- Modify: `packages/server/src/ai/kimi.ts`

**Step 1: Update claude.ts**

The ClaudeProvider already uses `analysisResultSchema.parse()` and `buildAnalysisSystemPrompt()` — both of which are already updated. The only change needed is updating the user message text. In `packages/server/src/ai/claude.ts`, change line 63:

```typescript
    userContent.push({
      type: "text",
      text: "Analyze this garden zone. Review existing tasks and provide your operations (create/update/complete/cancel) as JSON.",
    } as TextBlockParam);
```

**Step 2: Update kimi.ts**

Same change in `packages/server/src/ai/kimi.ts`, line 47:

```typescript
    userParts.push({
      type: "text",
      text: "Analyze this garden zone. Review existing tasks and provide your operations (create/update/complete/cancel) as JSON.",
    });
```

**Step 3: Run existing AI provider test**

Run: `cd packages/server && npx vitest run src/ai/__tests__/provider.test.ts`
Expected: PASS (or needs minor adjustment if it references old schema fields).

**Step 4: Run full test suite**

Run: `pnpm --filter @gardoo/server test`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/server/src/ai/claude.ts packages/server/src/ai/kimi.ts
git commit -m "feat: update AI provider prompts for operations-based schema"
```

---

### Task 8: Update mobile HomeScreen and ActionCard

**Files:**
- Modify: `packages/mobile/src/screens/HomeScreen.tsx`
- Modify: `packages/mobile/src/components/ActionCard.tsx`

**Step 1: Update ActionCard to use tasks.complete instead of careLogs.create**

In `packages/mobile/src/components/ActionCard.tsx`, replace the `createCareLog` mutation and `handleDone` function with:

```typescript
const completeTask = trpc.tasks.complete.useMutation({
  onSuccess: () => {
    setCompleted(true);
    utils.gardens.getActions.invalidate();
    onDone?.();
  },
});

const handleDone = () => {
  if (!action.id) return;
  completeTask.mutate({
    taskId: action.id,
    notes: `Completed: ${action.label}`,
  });
};
```

Update references from `createCareLog.isPending` to `completeTask.isPending` throughout the component.

**Step 2: Update the action type to include `id`**

The `action` prop type needs to include `id` and `photoRequested`. Update the interface/type used for the action prop to match the new getActions return type:

```typescript
interface ActionItem {
  id: string;
  targetType: string;
  targetId: string;
  actionType: string;
  priority: string;
  label: string;
  suggestedDate?: string;
  context?: string;
  recurrence?: string;
  photoRequested?: boolean;
  targetName?: string;
}
```

**Step 3: Add camera icon for photoRequested tasks**

In the ActionCard render, add a camera indicator when `action.photoRequested` is true:

```typescript
{action.photoRequested && (
  <FontAwesome name="camera" size={14} color="#666" style={{ marginLeft: 4 }} />
)}
```

**Step 4: Update HomeScreen key extractor**

In `packages/mobile/src/screens/HomeScreen.tsx`, update the FlatList keyExtractor to use task ID:

```typescript
keyExtractor={(item) => item.id}
```

**Step 5: Verify the mobile app builds**

Run: `cd packages/mobile && npx expo export --platform ios --dev`
Expected: No build errors.

**Step 6: Commit**

```bash
git add packages/mobile/src/screens/HomeScreen.tsx packages/mobile/src/components/ActionCard.tsx
git commit -m "feat: mobile uses tasks.complete instead of careLogs.create"
```

---

### Task 9: Update web home page and analysis page

**Files:**
- Modify: `packages/web/src/app/page.tsx`
- Modify: `packages/web/src/app/analysis/page.tsx`

**Step 1: Update web home page Done button**

In `packages/web/src/app/page.tsx`, replace the `logMutation` with:

```typescript
const completeMutation = trpc.tasks.complete.useMutation({
  onSuccess() {
    actionsQuery.refetch();
  },
});
```

Replace the Done button's onClick handler:

```typescript
onClick={() => {
  completeMutation.mutate({
    taskId: action.id,
    notes: `Completed: ${action.label}`,
  });
}}
disabled={completeMutation.isPending}
```

Update the key on action cards:

```typescript
key={action.id}
```

**Step 2: Update analysis page to show operations instead of actions**

In `packages/web/src/app/analysis/page.tsx`, update the expanded result section to show `operations` instead of `actions`. The analysis result JSONB now has `operations` instead of `actions`:

Replace references to `analysisResult.actions` with `analysisResult.operations`, and update the rendering to show the operation type (create/update/complete/cancel) alongside each entry.

**Step 3: Build the web app to verify**

Run: `pnpm --filter @gardoo/web build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/web/src/app/page.tsx packages/web/src/app/analysis/page.tsx
git commit -m "feat: web uses tasks.complete and shows operations in analysis page"
```

---

### Task 10: Run full test suite and final verification

**Step 1: Run all server tests**

Run: `pnpm --filter @gardoo/server test`
Expected: All tests PASS.

**Step 2: Run server typecheck**

Run: `pnpm --filter @gardoo/server typecheck`
Expected: No errors.

**Step 3: Build web to verify**

Run: `pnpm --filter @gardoo/web build`
Expected: Build succeeds.

**Step 4: Commit any remaining fixes**

If any tests needed adjustments, commit those fixes.

```bash
git add -A
git commit -m "fix: resolve remaining type and test issues for persistent tasks"
```
