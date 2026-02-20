import type { AnalysisResult } from "./schema.js";
import { weatherCodeToCondition } from "../lib/weather.js";

export interface AnalysisContext {
  garden: {
    name: string;
    hardinessZone?: string;
    location?: { lat: number; lng: number };
  };
  zone: {
    id: string;
    name: string;
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
      targetId: string;
      loggedAt: string;
      notes?: string;
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

  lines.push(
    "You are an expert garden advisor with deep knowledge of horticulture, plant biology, and seasonal care.",
  );
  lines.push(
    "Your job is to analyze a specific garden zone and produce actionable, prioritized recommendations.",
  );
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

  lines.push("");
  lines.push("## Zone Details");
  lines.push("");
  lines.push(`Zone ID: ${context.zone.id}`);
  lines.push(`Zone name: ${context.zone.name}`);
  if (context.zone.soilType) {
    lines.push(`Soil type: ${context.zone.soilType}`);
  }
  if (context.zone.sunExposure) {
    lines.push(`Sun exposure: ${context.zone.sunExposure}`);
  }

  if (context.zone.plants.length > 0) {
    lines.push("");
    lines.push("## Plants in this zone");
    lines.push("");
    for (const plant of context.zone.plants) {
      lines.push(`- **${plant.name}** (ID: ${plant.id})`);
      if (plant.variety) lines.push(`  Variety: ${plant.variety}`);
      if (plant.datePlanted) lines.push(`  Planted: ${plant.datePlanted}`);
      if (plant.growthStage) lines.push(`  Growth stage: ${plant.growthStage}`);
      if (plant.careProfile) {
        lines.push(`  Care profile: ${JSON.stringify(plant.careProfile)}`);
      }
    }
  }

  if (context.zone.recentCareLogs.length > 0) {
    lines.push("");
    lines.push("## Recent care logs");
    lines.push("");
    for (const log of context.zone.recentCareLogs) {
      lines.push(
        `- ${log.actionType} on target ${log.targetId} at ${log.loggedAt}${log.notes ? ` — ${log.notes}` : ""}`,
      );
    }
  }

  if (context.zone.sensorReadings && context.zone.sensorReadings.length > 0) {
    lines.push("");
    lines.push("## Sensor readings");
    lines.push("");
    for (const reading of context.zone.sensorReadings) {
      lines.push(
        `- ${reading.sensorType}: ${reading.value} ${reading.unit} (at ${reading.recordedAt})`,
      );
    }
  }

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
    if (cur.soilMoisture != null) {
      lines.push(`- Soil Moisture: ${cur.soilMoisture}`);
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

  if (context.photos && context.photos.length > 0) {
    lines.push("");
    lines.push("## Attached Photos");
    lines.push("");
    lines.push(
      `${context.photos.length} photo(s) are attached to this analysis request. Each photo has a description:`,
    );
    for (const photo of context.photos) {
      lines.push(`- ${photo.description}`);
    }
    lines.push(
      "Examine the photos carefully for visible plant health issues, pests, disease symptoms, growth progress, or any other relevant observations.",
    );
  }

  // ── Analysis settings ──────────────────────────────────────────────────
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

  lines.push("");
  lines.push("## Priority Guidelines");
  lines.push("");
  lines.push("Use the FULL range of priorities. Not everything is 'today' — distribute tasks across all levels:");
  lines.push("- **urgent**: Immediate action needed within 24 hours — plant health at risk, frost warning, severe pest/disease. Use SPARINGLY (0-1 per analysis).");
  lines.push("- **today**: Should be done today — time-sensitive watering, ripe harvest, optimal weather window for a task.");
  lines.push("- **upcoming**: Plan for this week — routine maintenance, fertilizing, monitoring checks. Most regular care tasks belong here.");
  lines.push("- **informational**: FYI observation — growth notes, seasonal tips, things to watch. No specific action date needed. Use for non-actionable insights.");
  lines.push("");
  lines.push("A typical analysis should have: mostly 'upcoming' tasks, a few 'today' if warranted, 'informational' for observations, and 'urgent' only for genuine emergencies.");

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
    "7. Set 'photoRequested: true' on monitor tasks when you haven't seen the zone/plant recently and want a fresh photo.",
  );
  lines.push(
    "8. If photos are attached, analyze them for visible plant health issues, pests, disease symptoms, or other relevant observations.",
  );
  lines.push(
    "9. Include observations about overall zone health and alerts for problems (pest, disease, frost, drought).",
  );
  lines.push(
    "10. Do NOT recreate tasks the user has dismissed unless conditions have significantly changed.",
  );

  return lines.join("\n");
}
