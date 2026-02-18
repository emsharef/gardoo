# Persistent Tasks — Design Document

**Date:** 2026-02-17
**Branch:** `feature/revise-analysis`

## Problem

Every analysis run creates fresh actions with no reference to what already exists or what has been done. This causes duplication, no task lifecycle, and no way to reschedule overdue items.

## Solution: AI Returns Operations

The AI receives existing tasks as context and returns a list of **operations** (create, update, complete, cancel) instead of a flat list of new actions. A new first-class `tasks` table persists tasks across analysis runs.

## Data Model

### New `tasks` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `gardenId` | uuid FK → gardens | |
| `zoneId` | uuid FK → zones | Always set (tasks belong to zone analysis) |
| `targetType` | enum: zone \| plant | |
| `targetId` | uuid | The zone or plant this applies to |
| `actionType` | enum: water \| fertilize \| harvest \| prune \| plant \| monitor \| protect \| other | Shared with care_logs |
| `priority` | enum: urgent \| today \| upcoming \| informational | |
| `status` | enum: pending \| completed \| cancelled \| snoozed | |
| `label` | text | Max 60 chars |
| `context` | text | Max 200 chars, optional |
| `suggestedDate` | date | |
| `recurrence` | text | Optional, e.g. "every 3 days" |
| `photoRequested` | boolean | AI can request a fresh photo (mainly for monitor tasks) |
| `completedAt` | timestamp | Nullable |
| `completedVia` | enum: user \| ai | Nullable — who marked it done |
| `careLogId` | uuid FK → care_logs | Nullable — the care log that fulfilled it |
| `sourceAnalysisId` | uuid FK → analysis_results | Nullable — which analysis created/last touched it |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

The `analysis_results` table is unchanged — it remains an audit log of raw AI responses.

## AI Output Schema

```typescript
interface AnalysisOperation {
  op: "create" | "update" | "complete" | "cancel";

  // For update/complete/cancel — references existing task
  taskId?: string;          // required when op != "create"

  // For create/update — the task fields
  targetType?: "zone" | "plant";
  targetId?: string;
  actionType?: string;
  priority?: string;
  label?: string;
  suggestedDate?: string;
  context?: string;
  recurrence?: string;
  photoRequested?: boolean;

  // For complete/cancel — why
  reason?: string;
}

interface AnalysisResult {
  operations: AnalysisOperation[];
  observations?: string[];
  alerts?: string[];
}
```

Rules:
- `create` — all task fields required (targetType, targetId, actionType, priority, label, suggestedDate)
- `update` — `taskId` required, only include fields that are changing
- `complete` — `taskId` + optional `reason`
- `cancel` — `taskId` + optional `reason`

## Context Builder Changes

Each zone analysis includes existing tasks in the prompt:

- All `pending` tasks for the zone
- Tasks `completed` or `cancelled` in the last 7 days

Format in prompt:
```
## Existing Tasks

### Pending
- Task abc-123: [water] "Water tomatoes" for plant 'Cherry Tomato' (def-456)
  Priority: today | Due: 2026-02-17 | Recurrence: every 3 days

### Recently Completed (last 7 days)
- Task ghi-789: [water] "Water tomatoes" — completed by user on 2026-02-15

### Recently Cancelled (last 7 days)
- Task jkl-012: [prune] "Prune dead leaves" — cancelled by AI on 2026-02-14
  Reason: "Plant recovered, no dead leaves visible in photos"
```

AI instructions updated to:
1. Review existing pending tasks before creating new ones — don't duplicate
2. Reschedule overdue tasks to realistic new dates instead of creating duplicates
3. Complete tasks when care logs or photos show the work is done
4. Cancel tasks that are no longer relevant
5. Create new tasks only for genuinely new work
6. Set `photoRequested: true` on monitor tasks when a fresh photo is needed

## Server-Side Operation Handling

After AI returns operations, validated against Zod schema, applied transactionally:

- `create` → INSERT into tasks, set sourceAnalysisId
- `update` → UPDATE existing row, only change provided fields, bump updatedAt
- `complete` → SET status='completed', completedAt=now(), completedVia='ai', store reason
- `cancel` → SET status='cancelled', store reason

Validation before applying:
- For update/complete/cancel: verify taskId exists, belongs to this zone, is currently pending
- Skip invalid operations (log warning) rather than failing the batch
- Wrap all operations for one zone in a single transaction

## Care Log → Task Completion

When user taps "Done" on a task:
1. Create a care log with the task's actionType, targetType, targetId
2. Update the task: status='completed', completedAt=now(), completedVia='user', careLogId=new log id
3. Single atomic tRPC endpoint handles both

Independent care logs (not from a task) don't auto-complete tasks — left for AI to reconcile next run.

## Recurrence

Handled by the AI, not auto-generated. When a recurring task is completed, the AI sees it in the "recently completed" context with its recurrence hint and creates the next occurrence during the next analysis run. This lets the AI adjust timing based on weather/conditions.

## API Changes

**Modified:**
- `gardens.getActions()` → queries `tasks` table (WHERE status='pending') instead of flattening analysis_results JSONB. Deduplication logic removed — tasks are unique rows.

**New endpoints:**
- `tasks.complete(taskId)` → marks done + creates care log
- `tasks.snooze(taskId, newDate)` → user manually reschedules
- `tasks.dismiss(taskId)` → user cancels a task

**Unchanged:**
- `gardens.getAnalysisResults()` — raw AI responses for analysis page
- `gardens.triggerAnalysis()` — same trigger, downstream handling changes

## Migration Strategy

1. Add `tasks` table via Drizzle migration
2. Update AI schema, context builder, and system prompt
3. Update `handleAnalyzeZone` to apply operations to tasks table
4. Update `getActions` to query tasks instead of analysis_results
5. Update mobile + web to use new task endpoints
6. No data migration — existing analysis_results stay, tasks table starts empty and populates on next analysis run
