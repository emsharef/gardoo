import type { AnalysisResult } from "./schema.js";

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

  if (context.weather) {
    lines.push("");
    lines.push("## Weather");
    lines.push("");
    lines.push(`Current conditions: ${JSON.stringify(context.weather.current)}`);
    if (context.weather.forecast.length > 0) {
      lines.push(`Forecast: ${JSON.stringify(context.weather.forecast)}`);
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
    "9. If photos are attached, analyze them for visible plant health issues, pests, disease symptoms, or other relevant observations.",
  );
  lines.push(
    "10. Include observations about overall zone health and alerts for problems (pest, disease, frost, drought).",
  );

  return lines.join("\n");
}
