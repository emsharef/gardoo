# Analysis Prompt Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the AI analysis system prompt to produce specific, data-driven recommendations instead of generic advice, and enrich the data context so the AI can reason better.

**Architecture:** Three files change: (1) schema.ts gets a context field limit bump from 200→500, (2) contextBuilder.ts enriches care log entries with plant names/varieties and photo flags, (3) provider.ts gets a full prompt rewrite shifting from "task factory" to "diagnostic advisor" mode. The AnalysisContext interface adds two fields to its care log type.

**Tech Stack:** TypeScript, Zod, Vitest

---

### Task 1: Increase context field max from 200 to 500 chars in schema

**Files:**
- Modify: `packages/server/src/ai/schema.ts:21` — change `.max(200)` to `.max(500)`
- Modify: `packages/server/src/ai/__tests__/schema.test.ts` — (no existing test for 500 — but provider.test.ts line 545-556 tests 200 limit)
- Modify: `packages/server/src/ai/__tests__/provider.test.ts:545-556` — update context length test

**Step 1: Update the context max in schema.ts**

In `packages/server/src/ai/schema.ts`, line 21, change:

```typescript
  context: z.string().max(200).optional(),
```

to:

```typescript
  context: z.string().max(500).optional(),
```

**Step 2: Update the context length test in provider.test.ts**

In `packages/server/src/ai/__tests__/provider.test.ts`, the test at line 545-556 ("rejects context exceeding 200 characters") needs updating. Change:

```typescript
  it("rejects context exceeding 200 characters", () => {
    const invalid = {
      operations: [
        {
          ...validAnalysisResult.operations[0],
          context: "B".repeat(201),
        },
      ],
    };
    const parsed = analysisResultSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });
```

to:

```typescript
  it("rejects context exceeding 500 characters", () => {
    const invalid = {
      operations: [
        {
          ...validAnalysisResult.operations[0],
          context: "B".repeat(501),
        },
      ],
    };
    const parsed = analysisResultSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });
```

**Step 3: Run tests to verify**

Run: `cd packages/server && pnpm test`
Expected: All tests pass. The 200-char test now uses 501 chars.

**Step 4: Commit**

```bash
git add packages/server/src/ai/schema.ts packages/server/src/ai/__tests__/provider.test.ts
git commit -m "feat: increase analysis context field max from 200 to 500 chars"
```

---

### Task 2: Enrich care log data in context builder with plant names, varieties, and photo flags

**Files:**
- Modify: `packages/server/src/ai/provider.ts:22-28` — add `targetName`, `targetType`, `hasPhoto` to care log type in AnalysisContext interface
- Modify: `packages/server/src/jobs/contextBuilder.ts:50-67,148-155` — build plant name map, enrich care log entries

**Step 1: Update the AnalysisContext interface in provider.ts**

In `packages/server/src/ai/provider.ts`, lines 22-28, change the `recentCareLogs` type from:

```typescript
    recentCareLogs: Array<{
      actionType: string;
      targetId: string;
      loggedAt: string;
      notes?: string;
    }>;
```

to:

```typescript
    recentCareLogs: Array<{
      actionType: string;
      targetType: string;
      targetId: string;
      targetName: string;
      loggedAt: string;
      notes?: string;
      hasPhoto?: boolean;
    }>;
```

**Step 2: Build plant name map and enrich care log entries in contextBuilder.ts**

In `packages/server/src/jobs/contextBuilder.ts`, replace the care log mapping block (lines 150-155):

```typescript
      recentCareLogs: recentCareLogs.map((log) => ({
        actionType: log.actionType,
        targetId: log.targetId,
        loggedAt: log.loggedAt.toISOString(),
        ...(log.notes ? { notes: log.notes } : {}),
      })),
```

with:

```typescript
      recentCareLogs: (() => {
        // Build a lookup for plant names (name + variety)
        const activePlants = zone.plants.filter((p: any) => p.status !== "retired");
        const plantNameMap = new Map<string, string>();
        for (const p of activePlants) {
          const display = p.variety ? `${p.name} / ${p.variety}` : p.name;
          plantNameMap.set(p.id, display);
        }

        return recentCareLogs.map((log) => ({
          actionType: log.actionType,
          targetType: log.targetType,
          targetId: log.targetId,
          targetName: log.targetType === "plant"
            ? plantNameMap.get(log.targetId) ?? log.targetId
            : zone.name,
          loggedAt: log.loggedAt.toISOString(),
          ...(log.notes ? { notes: log.notes } : {}),
          ...(log.photoUrl ? { hasPhoto: true } : {}),
        }));
      })(),
```

**Step 3: Run tests to verify**

Run: `cd packages/server && pnpm test`
Expected: All existing tests pass. The `sampleContext` in provider.test.ts doesn't include the new fields (they're optional for backward compat at the interface level), so tests still work. The AnalysisContext type now requires `targetType`, `targetName` — but the test fixture has them implicitly not included... we need to update the fixture.

**Step 4: Update the test fixture in provider.test.ts**

In `packages/server/src/ai/__tests__/provider.test.ts`, update the `sampleContext.zone.recentCareLogs` (lines 33-40) to include the new required fields:

```typescript
    recentCareLogs: [
      {
        actionType: "water",
        targetType: "plant",
        targetId: PLANT_ID,
        targetName: "Tomato / Roma",
        loggedAt: "2025-06-10T08:00:00Z",
        notes: "Deep watering",
      },
    ],
```

**Step 5: Run tests again**

Run: `cd packages/server && pnpm test`
Expected: All tests pass with the enriched fixture.

**Step 6: Commit**

```bash
git add packages/server/src/ai/provider.ts packages/server/src/jobs/contextBuilder.ts packages/server/src/ai/__tests__/provider.test.ts
git commit -m "feat: enrich care log context with plant names, varieties, and photo flags"
```

---

### Task 3: Update photo descriptions in gatherZonePhotos to include UUIDs and relative dates

**Files:**
- Modify: `packages/server/src/jobs/contextBuilder.ts:256-266,291-296` — fetch plant variety, include UUID and relative date in description

**Step 1: Update plant name map in gatherZonePhotos to include variety**

In `packages/server/src/jobs/contextBuilder.ts`, the `gatherZonePhotos` function (line 256-266) loads plant names but not varieties. Change the select and map:

```typescript
  // Load plant names for description building
  const plantMap = new Map<string, string>();
  if (plantIds.length > 0) {
    const plantRows = await db
      .select({ id: plants.id, name: plants.name })
      .from(plants)
      .where(inArray(plants.id, plantIds));
    for (const p of plantRows) {
      plantMap.set(p.id, p.name);
    }
  }
```

to:

```typescript
  // Load plant names + varieties for description building
  const plantMap = new Map<string, string>();
  if (plantIds.length > 0) {
    const plantRows = await db
      .select({ id: plants.id, name: plants.name, variety: plants.variety })
      .from(plants)
      .where(inArray(plants.id, plantIds));
    for (const p of plantRows) {
      const display = p.variety ? `${p.name} / ${p.variety}` : p.name;
      plantMap.set(p.id, display);
    }
  }
```

**Step 2: Update photo description format to include UUID and relative date**

In `packages/server/src/jobs/contextBuilder.ts`, replace the description building block (lines 291-296):

```typescript
      const targetName =
        log.targetType === "plant"
          ? plantMap.get(log.targetId) ?? "unknown plant"
          : "zone";
      const dateStr = log.loggedAt.toISOString().split("T")[0];
      const description = `Care log photo: ${log.actionType} action on ${log.targetType} '${targetName}' (${dateStr})${log.notes ? ` — '${log.notes}'` : ""}`;
```

with:

```typescript
      const targetName =
        log.targetType === "plant"
          ? plantMap.get(log.targetId) ?? "unknown plant"
          : zone.name ?? "zone";
      const daysAgo = Math.round(
        (Date.now() - log.loggedAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      const relativeDate = daysAgo === 0 ? "today" : daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;
      const description = `Care log photo: ${log.actionType} action on ${log.targetType} '${targetName}' (${log.targetId}) — ${relativeDate}${log.notes ? ` — '${log.notes}'` : ""}`;
```

Note: `gatherZonePhotos` doesn't currently have access to the zone name. We need to pass it in or hardcode "zone". Since `gatherZonePhotos` is called from `analyze-zone.ts` which has the zone context, we'll add a `zoneName` parameter.

**Step 3: Add zoneName parameter to gatherZonePhotos**

Change the function signature from:

```typescript
export async function gatherZonePhotos(
  db: DB,
  zoneId: string,
  plantIds: string[],
): Promise<Array<{ dataUrl: string; description: string }>> {
```

to:

```typescript
export async function gatherZonePhotos(
  db: DB,
  zoneId: string,
  plantIds: string[],
  zoneName?: string,
): Promise<Array<{ dataUrl: string; description: string }>> {
```

And update the `targetName` line for zones:

```typescript
      const targetName =
        log.targetType === "plant"
          ? plantMap.get(log.targetId) ?? "unknown plant"
          : zoneName ?? "zone";
```

**Step 4: Update the caller in analyze-zone.ts**

In `trigger/analyze-zone.ts`, find where `gatherZonePhotos` is called and add the zone name. Search for the call and add the fourth argument. The call looks like:

```typescript
const photos = await gatherZonePhotos(db, zoneId, plantIds);
```

Change to:

```typescript
const photos = await gatherZonePhotos(db, zoneId, plantIds, context.zone.name);
```

(The `context` variable is the `AnalysisContext` built just before.)

**Step 5: Run tests**

Run: `cd packages/server && pnpm test`
Expected: All tests pass. `gatherZonePhotos` isn't directly unit-tested (it hits the DB), so no test changes needed here.

**Step 6: Commit**

```bash
git add packages/server/src/jobs/contextBuilder.ts trigger/analyze-zone.ts
git commit -m "feat: include plant variety and UUID in photo descriptions, use relative dates"
```

---

### Task 4: Rewrite the system prompt — new role, diagnostic framework, and care log formatting

This is the main task. Rewrite `buildAnalysisSystemPrompt()` in `packages/server/src/ai/provider.ts`.

**Files:**
- Modify: `packages/server/src/ai/provider.ts:114-427` — full rewrite of `buildAnalysisSystemPrompt()`

**Step 1: Rewrite the buildAnalysisSystemPrompt function**

Replace the entire `buildAnalysisSystemPrompt` function (lines 114-427) with the new version below. The new structure is:

1. **Role statement** — diagnostic plant health specialist
2. **Diagnostic reasoning framework** — how to analyze photos, sensors, care logs, weather
3. **Output format** — same JSON schema but with 500 char context
4. **Garden context** — same as before
5. **Zone details** — now includes zoneType and dimensions
6. **Plants** — same as before
7. **Recent care logs** — now human-readable with name/variety + UUID + relative date + photo flag
8. **Sensor readings** — same as before
9. **Existing tasks** — same as before
10. **Weather** — same as before
11. **Attached photos** — same as before
12. **User preferences** — same as before
13. **Anti-generic filter** — new section with good/bad examples
14. **Priority guidelines** — same as before
15. **Task lifecycle instructions** — same as before (moved to end)

```typescript
export function buildAnalysisSystemPrompt(context: AnalysisContext): string {
  const lines: string[] = [];

  // ── 1. Role ──────────────────────────────────────────────────────────────
  lines.push(
    "You are a diagnostic plant health specialist. Your primary job is to ANALYZE what you see — in photos, sensor data, care logs, and weather — and derive specific, evidence-based recommendations.",
  );
  lines.push(
    "Every recommendation you make must be grounded in something specific you observed, not generic advice that could apply to any garden.",
  );

  // ── 2. Diagnostic Reasoning Framework ────────────────────────────────────
  lines.push("");
  lines.push("## How to Analyze");
  lines.push("");
  lines.push("Before generating any tasks, reason through the data systematically:");
  lines.push("");
  lines.push("**Photo analysis:** For each attached photo, examine leaf color, texture, spots, wilting, pest damage, growth patterns, and fruit/flower development. Compare what you see against what is expected for the plant's growth stage and current season. Note anything abnormal.");
  lines.push("");
  lines.push("**Sensor correlation:** Look for anomalies in sensor readings — dropping soil moisture, temperature spikes, low light levels. Correlate sensor trends with any visible symptoms in photos. If soil moisture is low AND leaves look wilted, that's a specific finding.");
  lines.push("");
  lines.push("**Care log engagement:** Read every care log note carefully. If the user asked a question, expressed concern, or described something unusual — this is your TOP PRIORITY to address. Create a task that directly responds to their observation. Reference what they wrote.");
  lines.push("");
  lines.push("**Weather-informed timing:** Use the 7-day forecast to time recommendations precisely. Reference specific dates and conditions — \"water Thursday morning before the 31°C heat on Friday\" not \"water soon.\"");

  // ── 3. Output Format ─────────────────────────────────────────────────────
  lines.push("");
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
    '      "context": "Specific explanation grounded in observed data (max 500 chars, optional)"',
  );
  lines.push(
    '      "recurrence": "optional hint, e.g. every 3 days"',
  );
  lines.push(
    '      "photoRequested": true,                   // optional — set on monitor tasks when you have a diagnostic hypothesis that a photo would confirm',
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

  // ── 4. Garden Context ────────────────────────────────────────────────────
  lines.push("");
  lines.push("## Garden Context");
  lines.push("");
  lines.push(`Garden name: ${context.garden.name}`);
  if (context.garden.hardinessZone) {
    lines.push(`USDA hardiness zone: ${context.garden.hardinessZone}`);
  }
  if (context.garden.location) {
    lines.push(
      `Location: ${context.garden.location.lat}, ${context.garden.location.lng}`,
    );
  }
  lines.push(`Current date: ${context.currentDate}`);
  if (context.userSkillLevel) {
    lines.push(
      `Gardener skill level: ${context.userSkillLevel} (adjust advice complexity accordingly)`,
    );
  }

  // ── 5. Zone Details ──────────────────────────────────────────────────────
  lines.push("");
  lines.push("## Zone Details");
  lines.push("");
  lines.push(`Zone ID: ${context.zone.id}`);
  lines.push(`Zone name: ${context.zone.name}`);
  if ((context.zone as any).zoneType) {
    lines.push(`Zone type: ${(context.zone as any).zoneType}`);
  }
  if ((context.zone as any).dimensions) {
    lines.push(`Dimensions: ${(context.zone as any).dimensions}`);
  }
  if (context.zone.soilType) {
    lines.push(`Soil type: ${context.zone.soilType}`);
  }
  if (context.zone.sunExposure) {
    lines.push(`Sun exposure: ${context.zone.sunExposure}`);
  }

  // ── 6. Plants ────────────────────────────────────────────────────────────
  if (context.zone.plants.length > 0) {
    lines.push("");
    lines.push("## Plants in this zone");
    lines.push("");
    for (const plant of context.zone.plants) {
      const displayName = plant.variety ? `${plant.name} / ${plant.variety}` : plant.name;
      lines.push(`- **${displayName}** (ID: ${plant.id})`);
      if (plant.datePlanted) lines.push(`  Planted: ${plant.datePlanted}`);
      if (plant.growthStage) lines.push(`  Growth stage: ${plant.growthStage}`);
      if (plant.careProfile) {
        lines.push(`  Care profile: ${JSON.stringify(plant.careProfile)}`);
      }
    }
  }

  // ── 7. Recent Care Logs (human-readable) ─────────────────────────────────
  if (context.zone.recentCareLogs.length > 0) {
    lines.push("");
    lines.push("## Recent care logs (last 14 days)");
    lines.push("");
    lines.push("Read these carefully — address any user questions or concerns as top priority.");
    lines.push("");
    for (const log of context.zone.recentCareLogs) {
      const daysAgo = Math.round(
        (new Date(context.currentDate + "T00:00:00Z").getTime() - new Date(log.loggedAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      const relativeDate = daysAgo === 0 ? "today" : daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;
      let line = `- ${log.actionType} on ${log.targetName} (${log.targetType} ${log.targetId}) — ${relativeDate}`;
      if (log.notes) line += ` — "${log.notes}"`;
      if (log.hasPhoto) line += " (photo attached)";
      lines.push(line);
    }
  }

  // ── 8. Sensor Readings ───────────────────────────────────────────────────
  if (context.zone.sensorReadings && context.zone.sensorReadings.length > 0) {
    lines.push("");
    lines.push("## Sensor readings (last 48 hours)");
    lines.push("");
    for (const reading of context.zone.sensorReadings) {
      lines.push(
        `- ${reading.sensorType}: ${reading.value} ${reading.unit} (at ${reading.recordedAt})`,
      );
    }
  }

  // ── 9. Existing Tasks ────────────────────────────────────────────────────
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
        let resolution: string;
        if (task.completedVia === "user_dismissed") {
          resolution = "DISMISSED by user (they chose to ignore this task)";
        } else if (task.completedVia === "user" && task.status === "completed") {
          resolution = "COMPLETED by user";
        } else if (task.completedVia === "ai") {
          resolution = `${task.status} by AI`;
        } else {
          resolution = task.status;
        }
        const date = task.completedAt
          ? ` on ${task.completedAt.split("T")[0]}`
          : "";
        lines.push(
          `- Task ${task.id}: [${task.actionType}] "${task.label}" — ${resolution}${date}`,
        );
        if (task.recurrence) {
          lines.push(`  Recurrence: ${task.recurrence}`);
        }
      }
      lines.push("");
      lines.push(
        "IMPORTANT: Tasks marked DISMISSED by user should NOT be recreated unless conditions have significantly changed. The user deliberately chose to ignore these tasks.",
      );
    }
  }

  // ── 10. Weather ──────────────────────────────────────────────────────────
  if (context.weather) {
    lines.push("");
    lines.push("## Weather");
    lines.push("");
    const cur = context.weather.current as Record<string, number>;
    lines.push("### Current Conditions");
    lines.push(`- Condition: ${weatherCodeToCondition(cur.weatherCode ?? 0)}`);
    lines.push(`- Temperature: ${cur.temperature}°C (feels like ${cur.apparentTemperature}°C)`);
    lines.push(`- Humidity: ${cur.humidity}%`);
    lines.push(`- Wind: ${cur.windSpeed} km/h (gusts ${cur.windGusts} km/h)`);
    lines.push(`- UV Index: ${cur.uvIndex}`);
    lines.push(`- Dew Point: ${cur.dewPoint}°C`);
    if (cur.soilTemperature0cm != null) {
      lines.push(`- Soil Temperature: ${cur.soilTemperature0cm}°C (surface), ${cur.soilTemperature6cm}°C (6cm)`);
    }
    if (context.weather.forecast.length > 0) {
      lines.push("");
      lines.push("### 7-Day Forecast");
      for (const day of context.weather.forecast) {
        const d = day as Record<string, unknown>;
        const condition = weatherCodeToCondition((d.weatherCode as number) ?? 0);
        lines.push(
          `- ${d.date}: ${condition}, ${d.tempMin}–${d.tempMax}°C, Precip: ${d.precipitationSum}mm (${d.precipitationProbability}%), UV: ${d.uvIndexMax}, Gusts: ${d.windGustsMax} km/h`,
        );
      }
    }
  }

  // ── 11. Attached Photos ──────────────────────────────────────────────────
  if (context.photos && context.photos.length > 0) {
    lines.push("");
    lines.push("## Attached Photos");
    lines.push("");
    lines.push(
      `${context.photos.length} photo(s) are attached. Each photo has a description that matches a care log entry above:`,
    );
    for (const photo of context.photos) {
      lines.push(`- ${photo.description}`);
    }
    lines.push("");
    lines.push("Examine each photo for: leaf color/texture anomalies, spots or discoloration, wilting or drooping, pest presence, disease symptoms, growth stage accuracy, fruit/flower development, and overall plant vigor.");
  }

  // ── 12. User Preferences ─────────────────────────────────────────────────
  if (context.taskQuantity || context.gardeningDays || context.extraInstructions) {
    lines.push("");
    lines.push("## User Preferences");
    lines.push("");

    if (context.taskQuantity) {
      const descriptions: Record<string, string> = {
        low: "Generate only urgent and today-priority tasks. Skip routine suggestions and informational items.",
        normal: "Balanced — include a mix of urgent, today, upcoming, and informational tasks as appropriate.",
        high: "Comprehensive — include all relevant tasks, monitoring suggestions, and informational observations. Be thorough.",
      };
      lines.push(`Task quantity preference: ${context.taskQuantity} — ${descriptions[context.taskQuantity]}`);
    }

    if (context.gardeningDays && context.gardeningDays.length > 0) {
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const names = context.gardeningDays.map((d) => dayNames[d]).join(", ");
      lines.push(`Gardening days: ${names}`);
      lines.push(
        "Tasks should ONLY be scheduled on these days. If the ideal date doesn't fall on a gardening day, move it to the nearest gardening day (prefer the next one).",
      );
    }

    if (context.extraInstructions) {
      lines.push("");
      lines.push("## Additional User Instructions");
      lines.push("");
      lines.push(context.extraInstructions);
    }
  }

  // ── 13. Anti-Generic Filter ──────────────────────────────────────────────
  lines.push("");
  lines.push("## Quality Rules — CRITICAL");
  lines.push("");
  lines.push("NEVER create a task that could apply to any garden without modification. Every task label and context MUST reference something specific you observed in the data above.");
  lines.push("");
  lines.push("Examples of BAD (generic) vs GOOD (specific) tasks:");
  lines.push("- BAD: \"Monitor white flowers for fruit set\" — generic textbook advice");
  lines.push("- GOOD: \"Blackberry flowers open but no fruit visible in March 12 photo — check for pollinator activity or hand-pollinate if bees are scarce\"");
  lines.push("- BAD: \"Check moisture levels before heat wave\" — obvious to any gardener");
  lines.push("- GOOD: \"Soil moisture at 28% (sensor) with 31°C forecast Thursday — water deeply tomorrow morning before the heat\"");
  lines.push("- BAD: \"Watch for pests\" — vague, no evidence");
  lines.push("- GOOD: \"Small white spots visible on chard leaves in today's photo — possible leafminer eggs, inspect undersides and remove affected leaves\"");
  lines.push("");
  lines.push("If you don't have specific evidence for a recommendation, don't create it. Fewer specific tasks are better than many generic ones.");
  lines.push("");
  lines.push("**Diagnostic photo requests:** Only set photoRequested when you have a specific diagnostic hypothesis. BAD: \"Check on your tomato.\" GOOD: \"Leaf curl in last week's photo could be early blight or heat stress — take a close-up of affected leaves so I can differentiate next analysis.\"");
  lines.push("");
  lines.push("**Proactive education:** When a plant is healthy and nothing concerning is detected, you may provide growth-stage-specific education (what to expect next, what to watch for). Limit these to at most 2 informational tasks per analysis. These must be genuinely useful, not filler.");

  // ── 14. Priority Guidelines ──────────────────────────────────────────────
  lines.push("");
  lines.push("## Priority Guidelines");
  lines.push("");
  lines.push("Use the FULL range of priorities:");
  lines.push("- **urgent**: Immediate action within 24h — plant health at risk, frost, severe pest/disease. Use SPARINGLY (0-1 per analysis).");
  lines.push("- **today**: Time-sensitive — ripe harvest, optimal weather window, sensor-detected issue needing quick response.");
  lines.push("- **upcoming**: This week — routine care grounded in specific observations. Most tasks belong here.");
  lines.push("- **informational**: Growth-stage education, seasonal preparation tips. Max 2 per analysis.");

  // ── 15. Task Lifecycle Instructions ──────────────────────────────────────
  lines.push("");
  lines.push("## Task Operations");
  lines.push("");
  lines.push(
    "1. Review existing pending tasks first. Do NOT create duplicates.",
  );
  lines.push(
    "2. Use 'update' to reschedule overdue or misaligned tasks.",
  );
  lines.push(
    "3. Use 'complete' when care logs, sensor data, or photos show the work is done.",
  );
  lines.push(
    "4. Use 'cancel' when a task is no longer relevant.",
  );
  lines.push(
    "5. Use 'create' only for genuinely new, specific work.",
  );
  lines.push(
    "6. For recurring tasks recently completed, create the next occurrence with an appropriate future date.",
  );
  lines.push(
    "7. Do NOT recreate tasks the user has dismissed unless conditions have significantly changed.",
  );

  return lines.join("\n");
}
```

**Step 2: Update the AnalysisContext zone interface to include zoneType and dimensions**

In `packages/server/src/ai/provider.ts`, update the zone type (lines 10-14) from:

```typescript
  zone: {
    id: string;
    name: string;
    soilType?: string;
    sunExposure?: string;
```

to:

```typescript
  zone: {
    id: string;
    name: string;
    zoneType?: string;
    dimensions?: string;
    soilType?: string;
    sunExposure?: string;
```

Now the `(context.zone as any).zoneType` casts in the prompt builder can become `context.zone.zoneType` (clean up the `as any` casts in the prompt).

**Step 3: Run tests**

Run: `cd packages/server && pnpm test`
Expected: All tests pass. The prompt content changed but tests only check that the AI call succeeds and returns valid data — they don't assert on prompt text.

**Step 4: Run typecheck**

Run: `cd packages/server && pnpm typecheck`
Expected: No type errors.

**Step 5: Commit**

```bash
git add packages/server/src/ai/provider.ts
git commit -m "feat: rewrite analysis system prompt for diagnostic reasoning and anti-generic quality"
```

---

### Task 5: Build and verify end-to-end

**Step 1: Run all server tests**

Run: `cd packages/server && pnpm test`
Expected: All tests pass.

**Step 2: Run typecheck**

Run: `cd packages/server && pnpm typecheck`
Expected: No errors.

**Step 3: Build the web app**

Run: `cd packages/web && pnpm build`
Expected: Build succeeds with no errors (the web app imports from server package).

**Step 4: Commit and push**

```bash
git push origin master
```

The Vercel deploy will pick up the changes automatically. The next daily analysis run (06:00 UTC) will use the new prompt.

---

### Summary of all changes

| File | What changed |
|------|-------------|
| `packages/server/src/ai/schema.ts:21` | context max 200 → 500 |
| `packages/server/src/ai/provider.ts:4-61` | AnalysisContext: added `targetType`, `targetName`, `hasPhoto` to care logs; added `zoneType`, `dimensions` to zone |
| `packages/server/src/ai/provider.ts:114-427` | Full rewrite of `buildAnalysisSystemPrompt()` |
| `packages/server/src/jobs/contextBuilder.ts:150-155` | Care logs enriched with plant name/variety + photo flag |
| `packages/server/src/jobs/contextBuilder.ts:256-296` | Photo descriptions use variety + UUID + relative dates |
| `packages/server/src/jobs/contextBuilder.ts:215` | `gatherZonePhotos` gets optional `zoneName` param |
| `trigger/analyze-zone.ts` | Pass zone name to `gatherZonePhotos` |
| `packages/server/src/ai/__tests__/provider.test.ts` | Updated fixture + context length test |
