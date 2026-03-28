# Budget-Aware Task Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent task pile-up by enforcing per-zone task budgets scaled to plant count and user intensity preference, with automatic staleness cleanup.

**Architecture:** Three layers added to the existing per-zone analysis flow: (1) programmatic staleness cleanup before AI runs, (2) budget numbers injected into the AI prompt replacing vague guidance, (3) post-analysis cap enforcement as a safety net. All logic lives in a shared helper module used by both `trigger/analyze-zone.ts` and the inline fallback in `gardens.ts`.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest

---

### Task 1: Extract budget calculation helper

**Files:**
- Create: `packages/server/src/lib/taskBudget.ts`
- Test: `packages/server/src/lib/__tests__/taskBudget.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/server/src/lib/__tests__/taskBudget.test.ts
import { describe, it, expect } from "vitest";
import { computeTaskBudget } from "../taskBudget";

describe("computeTaskBudget", () => {
  it("uses normal ratio (2) and floor (3) by default", () => {
    const result = computeTaskBudget({ plantCount: 8 });
    // ceil(8/2) = 4, max(3, 4) = 4
    expect(result).toEqual({ maxTasks: 4, ratio: 2, floor: 3 });
  });

  it("applies floor when plant count is low", () => {
    const result = computeTaskBudget({ plantCount: 1, taskQuantity: "normal" });
    // ceil(1/2) = 1, max(3, 1) = 3
    expect(result).toEqual({ maxTasks: 3, ratio: 2, floor: 3 });
  });

  it("uses low ratio (4) and floor (2)", () => {
    const result = computeTaskBudget({ plantCount: 20, taskQuantity: "low" });
    // ceil(20/4) = 5, max(2, 5) = 5
    expect(result).toEqual({ maxTasks: 5, ratio: 4, floor: 2 });
  });

  it("applies low floor when plant count is very low", () => {
    const result = computeTaskBudget({ plantCount: 2, taskQuantity: "low" });
    // ceil(2/4) = 1, max(2, 1) = 2
    expect(result).toEqual({ maxTasks: 2, ratio: 4, floor: 2 });
  });

  it("uses high ratio (1) and floor (5)", () => {
    const result = computeTaskBudget({ plantCount: 12, taskQuantity: "high" });
    // ceil(12/1) = 12, max(5, 12) = 12
    expect(result).toEqual({ maxTasks: 12, ratio: 1, floor: 5 });
  });

  it("applies high floor when plant count is low", () => {
    const result = computeTaskBudget({ plantCount: 3, taskQuantity: "high" });
    // ceil(3/1) = 3, max(5, 3) = 5
    expect(result).toEqual({ maxTasks: 5, ratio: 1, floor: 5 });
  });

  it("handles zero plants using the floor", () => {
    const result = computeTaskBudget({ plantCount: 0, taskQuantity: "normal" });
    // ceil(0/2) = 0, max(3, 0) = 3
    expect(result).toEqual({ maxTasks: 3, ratio: 2, floor: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/lib/__tests__/taskBudget.test.ts`
Expected: FAIL — module `../taskBudget` not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/server/src/lib/taskBudget.ts

const RATIOS: Record<string, number> = { low: 4, normal: 2, high: 1 };
const FLOORS: Record<string, number> = { low: 2, normal: 3, high: 5 };

export function computeTaskBudget(opts: {
  plantCount: number;
  taskQuantity?: "low" | "normal" | "high";
}): { maxTasks: number; ratio: number; floor: number } {
  const quantity = opts.taskQuantity ?? "normal";
  const ratio = RATIOS[quantity];
  const floor = FLOORS[quantity];
  const maxTasks = Math.max(floor, Math.ceil(opts.plantCount / ratio));
  return { maxTasks, ratio, floor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/lib/__tests__/taskBudget.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/lib/taskBudget.ts packages/server/src/lib/__tests__/taskBudget.test.ts
git commit -m "feat: add computeTaskBudget helper for per-zone task limits"
```

---

### Task 2: Extract staleness cleanup and post-analysis enforcement helpers

**Files:**
- Create: `packages/server/src/lib/taskLifecycle.ts`
- Test: `packages/server/src/lib/__tests__/taskLifecycle.test.ts`

These are pure-logic helpers tested with mock data. The DB interaction will be done by the callers — these helpers determine *what* to cancel and *which* tasks to keep.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/server/src/lib/__tests__/taskLifecycle.test.ts
import { describe, it, expect } from "vitest";
import { findStaleTasks, enforceBudget } from "../taskLifecycle";

// Minimal task shape for testing
interface MockTask {
  id: string;
  suggestedDate: string;
  priority: string;
  status: string;
}

describe("findStaleTasks", () => {
  it("returns tasks whose suggestedDate is >7 days before currentDate", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-10", priority: "today", status: "pending" },
      { id: "b", suggestedDate: "2026-03-20", priority: "today", status: "pending" },
      { id: "c", suggestedDate: "2026-03-28", priority: "upcoming", status: "pending" },
    ];
    // currentDate is March 28. March 10 is 18 days ago (stale). March 20 is 8 days ago (stale). March 28 is today (not stale).
    const stale = findStaleTasks(tasks, "2026-03-28");
    expect(stale.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("returns empty array when no tasks are stale", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-25", priority: "today", status: "pending" },
    ];
    const stale = findStaleTasks(tasks, "2026-03-28");
    expect(stale).toEqual([]);
  });

  it("treats exactly 7 days ago as not stale", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-21", priority: "today", status: "pending" },
    ];
    const stale = findStaleTasks(tasks, "2026-03-28");
    expect(stale).toEqual([]);
  });
});

describe("enforceBudget", () => {
  it("returns empty array when under budget", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-28", priority: "today", status: "pending" },
      { id: "b", suggestedDate: "2026-03-29", priority: "upcoming", status: "pending" },
    ];
    const toCancel = enforceBudget(tasks, 5);
    expect(toCancel).toEqual([]);
  });

  it("cancels lowest-priority tasks when over budget", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-28", priority: "urgent", status: "pending" },
      { id: "b", suggestedDate: "2026-03-28", priority: "today", status: "pending" },
      { id: "c", suggestedDate: "2026-03-29", priority: "upcoming", status: "pending" },
      { id: "d", suggestedDate: "2026-03-30", priority: "informational", status: "pending" },
    ];
    const toCancel = enforceBudget(tasks, 2);
    // Keep a (urgent) and b (today). Cancel c (upcoming) and d (informational).
    expect(toCancel.map((t) => t.id)).toEqual(["c", "d"]);
  });

  it("breaks priority ties by suggestedDate ascending (sooner = keep)", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-30", priority: "upcoming", status: "pending" },
      { id: "b", suggestedDate: "2026-03-28", priority: "upcoming", status: "pending" },
      { id: "c", suggestedDate: "2026-03-29", priority: "upcoming", status: "pending" },
    ];
    const toCancel = enforceBudget(tasks, 2);
    // Keep b (Mar 28) and c (Mar 29). Cancel a (Mar 30).
    expect(toCancel.map((t) => t.id)).toEqual(["a"]);
  });

  it("returns empty array when exactly at budget", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-28", priority: "today", status: "pending" },
    ];
    const toCancel = enforceBudget(tasks, 1);
    expect(toCancel).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/lib/__tests__/taskLifecycle.test.ts`
Expected: FAIL — module `../taskLifecycle` not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/server/src/lib/taskLifecycle.ts

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  today: 1,
  upcoming: 2,
  informational: 3,
};

const STALENESS_DAYS = 7;

interface TaskLike {
  id: string;
  suggestedDate: string;
  priority: string;
}

/**
 * Returns tasks whose suggestedDate is more than 7 days before currentDate.
 */
export function findStaleTasks<T extends TaskLike>(
  tasks: T[],
  currentDate: string,
): T[] {
  const now = new Date(currentDate + "T00:00:00Z");
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - STALENESS_DAYS);

  return tasks.filter((t) => {
    const suggested = new Date(t.suggestedDate + "T00:00:00Z");
    return suggested < cutoff;
  });
}

/**
 * Given all pending tasks and a budget, returns the tasks that should be
 * cancelled (lowest priority, furthest date) to bring count to maxTasks.
 */
export function enforceBudget<T extends TaskLike>(
  pendingTasks: T[],
  maxTasks: number,
): T[] {
  if (pendingTasks.length <= maxTasks) return [];

  // Sort: highest priority first, then earliest date first (these we keep)
  const sorted = [...pendingTasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.suggestedDate.localeCompare(b.suggestedDate);
  });

  // Keep the first maxTasks, cancel the rest
  const toCancel = sorted.slice(maxTasks);
  return toCancel;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/lib/__tests__/taskLifecycle.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/lib/taskLifecycle.ts packages/server/src/lib/__tests__/taskLifecycle.test.ts
git commit -m "feat: add findStaleTasks and enforceBudget helpers"
```

---

### Task 3: Update system prompt to use hard budget numbers

**Files:**
- Modify: `packages/server/src/ai/provider.ts:4-66` (AnalysisContext interface — add `taskBudget` field)
- Modify: `packages/server/src/ai/provider.ts:394-424` (section 12 — replace vague taskQuantity text with budget)
- Test: `packages/server/src/ai/__tests__/provider.test.ts` (add test for budget prompt section)

- [ ] **Step 1: Write the failing test**

Add to the existing `provider.test.ts` file. First read its structure: it tests `buildAnalysisSystemPrompt` indirectly through provider calls. We need to test the prompt text directly.

```typescript
// Add to packages/server/src/ai/__tests__/provider.test.ts
import { buildAnalysisSystemPrompt } from "../provider";

// Add at the end of the file, after the existing describe blocks:

describe("buildAnalysisSystemPrompt budget section", () => {
  const baseContext: AnalysisContext = {
    ...sampleContext,
    taskQuantity: "normal",
  };

  it("includes hard budget numbers when taskBudget is set", () => {
    const context = {
      ...baseContext,
      taskBudget: { maxTasks: 4, currentPending: 2, availableBudget: 2 },
    };
    const prompt = buildAnalysisSystemPrompt(context);
    expect(prompt).toContain("Task budget for this zone: 4 max");
    expect(prompt).toContain("Currently pending: 2");
    expect(prompt).toContain("Available for new tasks: 2");
    expect(prompt).toContain("MUST cancel");
  });

  it("shows zero available budget when at capacity", () => {
    const context = {
      ...baseContext,
      taskBudget: { maxTasks: 3, currentPending: 5, availableBudget: 0 },
    };
    const prompt = buildAnalysisSystemPrompt(context);
    expect(prompt).toContain("Available for new tasks: 0");
    expect(prompt).toContain("OVER BUDGET");
  });

  it("falls back to vague guidance when taskBudget is not set", () => {
    const prompt = buildAnalysisSystemPrompt(baseContext);
    expect(prompt).not.toContain("Task budget for this zone");
    // Should still include the old-style taskQuantity text as fallback
    expect(prompt).toContain("Task quantity preference: normal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/ai/__tests__/provider.test.ts`
Expected: FAIL — `taskBudget` not recognized on `AnalysisContext`, prompt doesn't contain budget text

- [ ] **Step 3: Add `taskBudget` to `AnalysisContext` interface**

In `packages/server/src/ai/provider.ts`, add the new optional field to the `AnalysisContext` interface:

```typescript
// Add after the extraInstructions field (line 65):
  taskBudget?: {
    maxTasks: number;
    currentPending: number;
    availableBudget: number;
  };
```

- [ ] **Step 4: Replace section 12 (User Preferences) taskQuantity block with budget-aware version**

In `packages/server/src/ai/provider.ts`, replace the taskQuantity block inside section 12 (lines 400-407) with:

```typescript
    if (context.taskBudget) {
      lines.push(`Task budget for this zone: ${context.taskBudget.maxTasks} max pending tasks.`);
      lines.push(`Currently pending: ${context.taskBudget.currentPending}.`);
      lines.push(`Available for new tasks: ${context.taskBudget.availableBudget}.`);
      if (context.taskBudget.availableBudget === 0) {
        lines.push("You are AT or OVER BUDGET. You MUST cancel or consolidate existing tasks before creating any new ones. Only create a new task if you cancel an existing one first.");
      } else {
        lines.push(`You MUST NOT create more than ${context.taskBudget.availableBudget} new tasks. Cancel existing tasks to free budget if needed. Prioritize ruthlessly — keep only the most impactful tasks.`);
      }
    } else if (context.taskQuantity) {
      const descriptions: Record<string, string> = {
        low: "Generate only urgent and today-priority tasks. Skip routine suggestions and informational items.",
        normal: "Balanced — include a mix of urgent, today, upcoming, and informational tasks as appropriate.",
        high: "Comprehensive — include all relevant tasks, monitoring suggestions, and informational observations. Be thorough.",
      };
      lines.push(`Task quantity preference: ${context.taskQuantity} — ${descriptions[context.taskQuantity]}`);
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/ai/__tests__/provider.test.ts`
Expected: All tests PASS (existing + 3 new)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/ai/provider.ts packages/server/src/ai/__tests__/provider.test.ts
git commit -m "feat: add budget-aware task section to analysis prompt"
```

---

### Task 4: Wire budget into `trigger/analyze-zone.ts`

**Files:**
- Modify: `trigger/analyze-zone.ts`

This task adds the three layers to the Trigger.dev code path: pre-cleanup, budget calculation passed to context, post-enforcement.

- [ ] **Step 1: Add imports**

At the top of `trigger/analyze-zone.ts`, add new imports:

```typescript
import { lt } from "drizzle-orm";
import { computeTaskBudget } from "@gardoo/server/src/lib/taskBudget";
import { findStaleTasks, enforceBudget } from "@gardoo/server/src/lib/taskLifecycle";
```

Also add `plants` to the schema import:

```typescript
import {
  users,
  analysisResults,
  tasks as tasksTable,
  plants as plantsTable,
  type AnalysisResult,
  type UserSettings,
} from "@gardoo/server/src/db/schema";
```

- [ ] **Step 2: Add pre-analysis staleness cleanup after user settings load, before `buildZoneContext`**

Insert after the `userSettings` line (after line 53) and before the `buildZoneContext` call (line 56):

```typescript
    // ── Layer 1: Pre-analysis staleness cleanup ────────────────────────
    const currentDate = new Date().toISOString().split("T")[0];
    const pendingBeforeCleanup = await db
      .select({ id: tasksTable.id, suggestedDate: tasksTable.suggestedDate, priority: tasksTable.priority, status: tasksTable.status })
      .from(tasksTable)
      .where(and(eq(tasksTable.zoneId, zoneId), eq(tasksTable.status, "pending")));

    const staleTasks = findStaleTasks(pendingBeforeCleanup, currentDate);
    if (staleTasks.length > 0) {
      const staleIds = staleTasks.map((t) => t.id);
      await db
        .update(tasksTable)
        .set({
          status: "cancelled",
          completedVia: "system_stale",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(tasksTable.id, staleIds));
      console.log(`[analyze-zone] Cancelled ${staleTasks.length} stale task(s) in zone ${zoneId}`);
    }
```

Also add `inArray` to the drizzle-orm import:

```typescript
import { and, eq, inArray } from "drizzle-orm";
```

- [ ] **Step 3: Add budget calculation and inject into context, after `buildZoneContext`**

Insert after the `buildZoneContext` call and before photo gathering:

```typescript
    // ── Layer 2: Compute budget and inject into context ────────────────
    const plantCount = context.zone.plants.length;
    const { maxTasks } = computeTaskBudget({
      plantCount,
      taskQuantity: userSettings.taskQuantity,
    });
    const currentPending = pendingBeforeCleanup.length - staleTasks.length;
    const availableBudget = Math.max(0, maxTasks - currentPending);
    context.taskBudget = { maxTasks, currentPending, availableBudget };
    console.log(`[analyze-zone] Budget: ${maxTasks} max, ${currentPending} pending, ${availableBudget} available (${plantCount} plants, quantity=${userSettings.taskQuantity ?? "normal"})`);
```

- [ ] **Step 4: Add post-analysis enforcement after the operations apply loop**

Insert after the operations `for` loop (after line 189), before the final `console.log`:

```typescript
    // ── Layer 3: Post-analysis budget enforcement ──────────────────────
    const pendingAfter = await db
      .select({ id: tasksTable.id, suggestedDate: tasksTable.suggestedDate, priority: tasksTable.priority, status: tasksTable.status })
      .from(tasksTable)
      .where(and(eq(tasksTable.zoneId, zoneId), eq(tasksTable.status, "pending")));

    const toCancel = enforceBudget(pendingAfter, maxTasks);
    if (toCancel.length > 0) {
      const cancelIds = toCancel.map((t) => t.id);
      await db
        .update(tasksTable)
        .set({
          status: "cancelled",
          completedVia: "system_budget",
          completedAt: new Date(),
          updatedAt: new Date(),
          sourceAnalysisId: analysisRow.id,
        })
        .where(inArray(tasksTable.id, cancelIds));
      console.log(`[analyze-zone] Budget enforcement: cancelled ${toCancel.length} lowest-priority task(s)`);
    }
```

- [ ] **Step 5: Verify the file compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add trigger/analyze-zone.ts
git commit -m "feat: wire task budget into Trigger.dev analyze-zone"
```

---

### Task 5: Wire budget into inline analysis fallback in `gardens.ts`

**Files:**
- Modify: `packages/server/src/routers/gardens.ts:359-557` (`runInlineAnalysis` function)

The inline path mirrors the Trigger.dev path. Apply the same three layers.

- [ ] **Step 1: Add imports**

At the top of `packages/server/src/routers/gardens.ts`, add:

```typescript
import { inArray } from "drizzle-orm";
import { computeTaskBudget } from "../lib/taskBudget";
import { findStaleTasks, enforceBudget } from "../lib/taskLifecycle";
```

Note: `inArray` may already be imported — check and add only if missing. (Currently imported on line 2: `import { eq, and, asc, desc, sql, inArray, gte } from "drizzle-orm";` — already there.)

So only add:

```typescript
import { computeTaskBudget } from "../lib/taskBudget";
import { findStaleTasks, enforceBudget } from "../lib/taskLifecycle";
```

- [ ] **Step 2: Add pre-cleanup, budget, and post-enforcement inside the zone loop**

In the `runInlineAnalysis` function, inside the `for (const zone of garden.zones)` loop (line 416), add the three layers in the same positions as the Trigger.dev path.

After `const context = await buildZoneContext(...)` (line 419) and before photo gathering (line 422), insert:

```typescript
    // ── Layer 1: Pre-analysis staleness cleanup ────────────────────────
    const currentDate = new Date().toISOString().split("T")[0];
    const pendingBeforeCleanup = await db
      .select({ id: tasks.id, suggestedDate: tasks.suggestedDate, priority: tasks.priority, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.zoneId, zone.id), eq(tasks.status, "pending")));

    const staleTasks = findStaleTasks(pendingBeforeCleanup, currentDate);
    if (staleTasks.length > 0) {
      const staleIds = staleTasks.map((t) => t.id);
      await db
        .update(tasks)
        .set({
          status: "cancelled",
          completedVia: "system_stale",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(tasks.id, staleIds));
      console.log(`[inline-analysis] Cancelled ${staleTasks.length} stale task(s) in zone ${zone.id}`);
    }

    // ── Layer 2: Compute budget and inject into context ────────────────
    const plantCount = context.zone.plants.length;
    const { maxTasks } = computeTaskBudget({
      plantCount,
      taskQuantity: userSettings.taskQuantity,
    });
    const currentPending = pendingBeforeCleanup.length - staleTasks.length;
    const availableBudget = Math.max(0, maxTasks - currentPending);
    context.taskBudget = { maxTasks, currentPending, availableBudget };
    console.log(`[inline-analysis] Budget: ${maxTasks} max, ${currentPending} pending, ${availableBudget} available`);
```

After the operations `for` loop (after line 551), before the per-zone log line, insert:

```typescript
    // ── Layer 3: Post-analysis budget enforcement ──────────────────────
    const pendingAfter = await db
      .select({ id: tasks.id, suggestedDate: tasks.suggestedDate, priority: tasks.priority, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.zoneId, zone.id), eq(tasks.status, "pending")));

    const toCancel = enforceBudget(pendingAfter, maxTasks);
    if (toCancel.length > 0) {
      const cancelIds = toCancel.map((t) => t.id);
      await db
        .update(tasks)
        .set({
          status: "cancelled",
          completedVia: "system_budget",
          completedAt: new Date(),
          updatedAt: new Date(),
          sourceAnalysisId: analysisRow.id,
        })
        .where(inArray(tasks.id, cancelIds));
      console.log(`[inline-analysis] Budget enforcement: cancelled ${toCancel.length} lowest-priority task(s)`);
    }
```

- [ ] **Step 3: Verify the file compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routers/gardens.ts
git commit -m "feat: wire task budget into inline analysis fallback"
```

---

### Task 6: Run full test suite and verify build

**Files:** None (verification only)

- [ ] **Step 1: Run all server tests**

Run: `cd packages/server && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run typecheck**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify web build**

Run: `pnpm --filter @gardoo/web build`
Expected: Build succeeds

- [ ] **Step 4: Final commit if any fixes were needed**

If any fixes were required, commit them:
```bash
git add -A
git commit -m "fix: resolve issues found during verification"
```
