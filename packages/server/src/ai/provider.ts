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
  lines.push('  "actions": [');
  lines.push("    {");
  lines.push(
    '      "targetType": "zone" | "plant",           // what the action applies to',
  );
  lines.push(
    '      "targetId": "<uuid>",                     // the zone or plant id',
  );
  lines.push(
    '      "actionType": "water" | "fertilize" | "harvest" | "prune" | "plant" | "monitor" | "protect" | "other",',
  );
  lines.push(
    '      "priority": "urgent" | "today" | "upcoming" | "informational",',
  );
  lines.push(
    '      "label": "Short human-readable label (max 60 chars)",',
  );
  lines.push(
    '      "suggestedDate": "YYYY-MM-DD",            // when to perform it',
  );
  lines.push(
    '      "context": "Brief explanation (max 200 chars, optional)",',
  );
  lines.push(
    '      "recurrence": "optional cron-like hint, e.g. every 3 days"',
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
    "1. Analyze the zone holistically: consider plant needs, recent care, sensor data, and weather.",
  );
  lines.push(
    "2. Produce specific, actionable tasks — avoid generic advice. Reference actual plant names and IDs.",
  );
  lines.push(
    "3. Prioritize: 'urgent' means within 24 hours, 'today' means do it today, 'upcoming' within a week, 'informational' is FYI.",
  );
  lines.push(
    "4. Include observations about overall zone health and any alerts for problems (pest, disease, frost, drought).",
  );
  lines.push(
    "5. If photos are attached, analyze them for visible issues like wilting, discoloration, pests, or disease symptoms.",
  );

  return lines.join("\n");
}
