# Analysis Prompt Redesign

## Problem

The AI analysis produces generic, obvious recommendations ("water your plants", "monitor flowering progress") instead of specific, data-driven insights. Three root issues:

1. **Generic tasks**: Recommendations could apply to any garden — not grounded in specific observations from photos, sensors, or care logs
2. **Ignored care logs**: User questions and concerns in care log notes aren't addressed
3. **Underused photos**: Images aren't being analyzed for diagnostics — just acknowledged

## Approach

Rewrite the system prompt in `buildAnalysisSystemPrompt()` to shift the AI from "task factory" mode to "diagnostic advisor" mode. Enrich the data context so the AI can reason better. No schema changes except increasing context field length.

## Design

### 1. Prompt Structure Change

**Current:** Role → Output format → Data dump → Task lifecycle instructions

**New:** Role → Diagnostic reasoning framework → Data dump → Anti-generic filter → Output format → Task lifecycle instructions

The diagnostic reasoning instructions come BEFORE the data, so the AI reads everything through a diagnostic lens.

### 2. New Role Statement

Replace the generic "expert garden advisor" with:

> You are a diagnostic plant health specialist. Your primary job is to ANALYZE what you see — in photos, sensor data, care logs, and weather — and derive specific, evidence-based recommendations. Every recommendation must be grounded in something specific you observed, not generic advice that could apply to any garden.

### 3. Diagnostic Reasoning Framework (new section, before data)

Four reasoning directives placed before the data sections:

- **Photo analysis**: For each photo, describe what you see — leaf color, texture, spots, wilting, growth patterns, fruit development. Compare against what's expected for the plant's growth stage and season.
- **Sensor correlation**: Look for anomalies in sensor data — soil moisture trends, temperature spikes. Correlate with visible symptoms in photos.
- **Care log engagement**: Read every care log note carefully. If the user asked a question, expressed concern, or described something unusual — address it directly in a task. This is top priority.
- **Weather-informed timing**: Use the forecast to time recommendations precisely — reference specific dates and conditions, not vague "soon."

### 4. Anti-Generic Filter (new section, after data)

Explicit quality gate with good/bad examples:

- NEVER create a task that could apply to any garden. Every task must reference specific observed data.
- BAD: "Monitor white flowers for fruit set" — generic textbook advice
- GOOD: "Blackberry flowers open but no fruit visible in March 12 photo — check for pollinator activity or hand-pollinate"
- BAD: "Check moisture levels before heat wave" — obvious
- GOOD: "Soil moisture at 28% (sensor) with 31C forecast Thursday — water deeply tomorrow morning"
- If you don't have specific evidence, don't create the task. Fewer specific tasks > many generic ones.

### 5. Purposeful Diagnostic Requests

Only request a photo or check-in when you have a specific diagnostic hypothesis:

- BAD: "Check on your tomato"
- GOOD: "Leaf curl in last week's photo could be early blight or heat stress — take a close-up of affected leaves so I can differentiate"
- Every monitor/check task must state WHAT you're looking for and WHY

### 6. Proactive Education (capped)

When nothing concerning is found, provide growth-stage-specific education. Limited to max 2 informational tasks per analysis run. Must be genuinely useful — not filler.

### 7. Data Quality Improvements

#### Care logs — human-readable with IDs

Change from:
```
- water on target abc-123 at 2026-03-14T10:30:00Z — "looking wilted"
```
To:
```
- water on Tomato / Sungold (plant abc-123) — 1 day ago — "looking wilted" (photo attached)
```

Requires: adding `targetName` (name + variety) and `hasPhoto` to care log entries in the context.

#### Zone type and dimensions

Include `zoneType` (raised_bed, container, etc.) and `dimensions` in the Zone Details section. These affect watering/drainage reasoning.

#### Photo descriptions — include UUID

```
Care log photo: water action on plant 'Tomato / Sungold' (abc-123) — 1 day ago — 'looking wilted'
```

Both care logs and photo descriptions use the same format so the AI can match them.

### 8. Schema Change

Increase `context` field max from 200 to 500 characters to allow richer explanations.

## Files Changed

1. `packages/server/src/ai/provider.ts` — Rewrite `buildAnalysisSystemPrompt()`, update `AnalysisContext` interface (add targetName/hasPhoto to care logs)
2. `packages/server/src/ai/schema.ts` — Increase context max to 500
3. `packages/server/src/jobs/contextBuilder.ts` — Enrich care log data with plant names, varieties, and photo flags

## Non-Goals

- No new schema fields (diagnosis, evidence) — keep it simple
- No multi-pass analysis — single prompt is sufficient
- No changes to photo selection logic — current flow is fine
- No changes to task lifecycle operations (create/update/complete/cancel)
