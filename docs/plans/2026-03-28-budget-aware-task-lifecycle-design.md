# Budget-Aware Task Lifecycle

## Problem

Nightly analysis creates tasks per-zone daily. Tasks pile up for users who don't open the app regularly. No hard limits, no automatic cleanup, no consolidation. The `taskQuantity` setting is just a vague prompt hint with no enforcement.

## Solution

Three-layer approach, all operating at the zone level within `analyze-zone.ts` (and the inline fallback in `gardens.ts`).

### Layer 1: Pre-analysis staleness cleanup

Before building AI context, programmatically cancel stale tasks:

- **Target:** All pending tasks for this zone where `suggestedDate` is >7 days in the past
- **Action:** Set `status: "cancelled"`, `completedVia: "system_stale"`, `completedAt: now()`
- **Rationale:** If a task said "water by March 15" and it's March 23, it's clearly stale. No need to burn AI tokens reasoning about it.

### Layer 2: Budget-aware AI prompt

Calculate the zone's task budget based on plant count and user's `taskQuantity` setting:

```
plant_count = number of active plants in zone
ratio = { low: 4, normal: 2, high: 1 }[taskQuantity ?? "normal"]
floor = { low: 2, normal: 3, high: 5 }[taskQuantity ?? "normal"]
max_tasks = max(floor, ceil(plant_count / ratio))
current_pending = pending tasks remaining after staleness cleanup
budget = max(0, max_tasks - current_pending)
```

**Examples:**
- Zone with 8 plants, normal intensity: max 4 tasks
- Zone with 2 plants, normal intensity: max 3 tasks (floor)
- Zone with 20 plants, low intensity: max 5 tasks
- Zone with 12 plants, high intensity: max 12 tasks

Add to the system prompt (replacing the current vague `taskQuantity` guidance):
- Hard cap for this zone
- Current pending count after cleanup
- Available budget for new tasks
- Instruction: "You MUST cancel or consolidate existing tasks before creating new ones if at or over budget. Prioritize ruthlessly — keep only the most impactful tasks."

### Layer 3: Post-analysis enforcement (safety net)

After applying all AI operations, if pending tasks for the zone still exceed `max_tasks`:
- Sort remaining pending tasks by priority (urgent > today > upcoming > informational), then by `suggestedDate` ascending
- Keep the top `max_tasks` tasks
- Auto-cancel the rest with `completedVia: "system_budget"`, `completedAt: now()`

This catches cases where the AI ignores or miscounts the budget.

## Changes required

### `trigger/analyze-zone.ts`
- Add pre-cleanup step: query and cancel stale tasks before `buildZoneContext()`
- Compute budget: count zone plants, apply ratio/floor formula
- Pass budget info to the provider (new fields on context or as separate arg)
- Add post-enforcement: after applying operations, query pending tasks, enforce cap

### `packages/server/src/ai/provider.ts`
- Replace the current `taskQuantity` prompt section with a concrete budget section
- Include: max_tasks, current_pending, available_budget
- Stronger language: "hard limit", "MUST cancel before creating if at capacity"

### `packages/server/src/routers/gardens.ts`
- Same pre-cleanup, budget calculation, and post-enforcement in `runInlineAnalysis()` (the Trigger.dev fallback path)

## What stays the same

- **AI schema** (`ai/schema.ts`): No changes to operations format
- **Tasks table**: No schema changes (`completedVia` is already free-text, accommodates new values `system_stale` and `system_budget`)
- **User settings**: `taskQuantity` reinterpreted as ratio instead of vague hint; no new settings needed
- **`gardeningDays`** scheduling constraint: Unchanged
- **Dismissed task protection**: Unchanged — AI still told not to recreate dismissed tasks
- **Anti-generic quality rules**: Unchanged
- **Photo request logic**: Unchanged
