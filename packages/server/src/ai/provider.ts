import type { AnalysisResult } from "./schema";
import { weatherCodeToCondition } from "../lib/weather";

export interface AnalysisContext {
  garden: {
    name: string;
    hardinessZone?: string;
    location?: { lat: number; lng: number };
  };
  zone: {
    id: string;
    name: string;
    zoneType?: string;
    dimensions?: string;
    soilType?: string;
    sunExposure?: string;
    plants: Array<{
      id: string;
      name: string;
      variety?: string;
      datePlanted?: string;
      growthStage?: string;
      careProfile?: Record<string, unknown>;
    }>;
    recentCareLogs: Array<{
      actionType: string;
      targetType: string;
      targetId: string;
      targetName: string;
      loggedAt: string;
      notes?: string;
      hasPhoto?: boolean;
    }>;
    sensorReadings?: Array<{
      sensorType: string;
      value: number;
      unit: string;
      recordedAt: string;
    }>;
  };
  weather?: {
    current: Record<string, unknown>;
    forecast: Array<Record<string, unknown>>;
  };
  photos?: Array<{ dataUrl: string; description: string }>;
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
  currentDate: string;
  userSkillLevel?: string;
  taskQuantity?: "low" | "normal" | "high";
  gardeningDays?: number[];
  extraInstructions?: string;
}

export interface ChatToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ type: string; [key: string]: unknown }>;

export interface AIProvider {
  analyzeZone(
    context: AnalysisContext,
    apiKey: string,
  ): Promise<{
    result: AnalysisResult;
    tokensUsed: { input: number; output: number };
  }>;

  chat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    systemPrompt: string,
    apiKey: string,
    imageBase64?: string,
    imageMediaType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
    tools?: ChatToolDefinition[],
    onToolCall?: ToolExecutor,
  ): Promise<{
    content: string;
    tokensUsed: { input: number; output: number };
  }>;

  chatStream(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    systemPrompt: string,
    apiKey: string,
    onChunk: (text: string) => void,
    imageBase64?: string,
    imageMediaType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
    tools?: ChatToolDefinition[],
    onToolCall?: ToolExecutor,
  ): Promise<{
    content: string;
    tokensUsed: { input: number; output: number };
  }>;
}

/**
 * Builds the system prompt used for zone analysis. Shared by both providers.
 */
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
    '      "photoRequested": true,                   // optional — set when you have a diagnostic hypothesis a photo would confirm',
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
  if (context.zone.zoneType) {
    lines.push(`Zone type: ${context.zone.zoneType}`);
  }
  if (context.zone.dimensions) {
    lines.push(`Dimensions: ${context.zone.dimensions}`);
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
      const logDate = new Date(log.loggedAt);
      const currentDate = new Date(context.currentDate + "T00:00:00Z");
      const daysAgo = Math.round(
        (currentDate.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const relativeDate = daysAgo <= 0 ? "today" : daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;
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
        "IMPORTANT: Tasks marked DISMISSED by user should NOT be recreated unless conditions have significantly changed.",
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
      `${context.photos.length} photo(s) are attached. Each description matches a care log entry above:`,
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
  lines.push('- BAD: "Monitor white flowers for fruit set" — generic textbook advice');
  lines.push('- GOOD: "Blackberry flowers open but no fruit visible in March 12 photo — check for pollinator activity or hand-pollinate if bees are scarce"');
  lines.push('- BAD: "Check moisture levels before heat wave" — obvious to any gardener');
  lines.push('- GOOD: "Soil moisture at 28% (sensor) with 31°C forecast Thursday — water deeply tomorrow morning before the heat"');
  lines.push('- BAD: "Watch for pests" — vague, no evidence');
  lines.push('- GOOD: "Small white spots visible on chard leaves in today\'s photo — possible leafminer eggs, inspect undersides and remove affected leaves"');
  lines.push("");
  lines.push("If you don't have specific evidence for a recommendation, don't create it. Fewer specific tasks are better than many generic ones.");
  lines.push("");
  lines.push('**Diagnostic photo requests:** Only set photoRequested when you have a specific diagnostic hypothesis. BAD: "Check on your tomato." GOOD: "Leaf curl in last week\'s photo could be early blight or heat stress — take a close-up of affected leaves so I can differentiate next analysis."');
  lines.push("");
  lines.push("**Proactive education:** When a plant is healthy and nothing concerning is detected, you may provide growth-stage-specific education (what to expect next, what to watch for). Limit these to at most 2 informational tasks per analysis. These must be genuinely useful, not filler.");

  // ── 14. Priority Guidelines ──────────────────────────────────────────────
  lines.push("");
  lines.push("## Priority Guidelines");
  lines.push("");
  lines.push("Use the FULL range of priorities:");
  lines.push("- **urgent**: Immediate action within 24h — plant health at risk, frost, severe pest/disease. Use SPARINGLY (0-1 per analysis).");
  lines.push("- **today**: Time-sensitive — ripe harvest, optimal weather window, sensor-detected issue needing quick response.");
  lines.push("- **upcoming**: This week — care grounded in specific observations. Most tasks belong here.");
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
