import { z } from "zod";
import { eq, and, gte, inArray, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import {
  gardens,
  zones,
  plants,
  careLogs,
  weatherCache,
  users,
  conversations,
  tasks,
  analysisResults,
  type ChatMessage,
} from "../db/schema.js";
import {
  assertGardenOwnership,
  assertZoneOwnership,
  assertPlantOwnership,
} from "../lib/ownership.js";
import { getApiKey } from "../lib/getApiKey.js";
import { ClaudeProvider } from "../ai/claude.js";
import { KimiProvider } from "../ai/kimi.js";
import type { AIProvider } from "../ai/provider.js";
import { parseActions, executeAction } from "../ai/chatActions.js";

// ─── System prompt builder ──────────────────────────────────────────────────

interface ChatContext {
  garden: {
    name: string;
    hardinessZone?: string;
    location?: { lat: number; lng: number };
  };
  zones?: Array<{
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
  }>;
  focusZone?: {
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
  };
  focusPlant?: {
    id: string;
    name: string;
    variety?: string;
    datePlanted?: string;
    growthStage?: string;
    careProfile?: Record<string, unknown>;
    zoneName: string;
  };
  recentCareLogs: Array<{
    actionType: string;
    targetId: string;
    loggedAt: string;
    notes?: string;
  }>;
  weather?: {
    forecast: unknown;
    fetchedAt: string;
  };
  userSkillLevel?: string;
  currentDate: string;
  latestAnalysis?: Array<{
    zoneName: string;
    observations: string[];
    alerts: string[];
    generatedAt: string;
  }>;
  pendingTasks?: Array<{
    id: string;
    targetType: string;
    targetId: string;
    zoneId: string;
    actionType: string;
    priority: string;
    label: string;
    suggestedDate: string;
  }>;
}

function buildChatSystemPrompt(
  context: ChatContext,
  includeActions: boolean,
): string {
  const lines: string[] = [];

  lines.push(
    "You are Gardooner, an expert garden advisor helping with a specific garden. " +
      "Provide practical, specific advice based on the garden's actual plants, conditions, and care history. " +
      "Be conversational but precise. Reference actual plant names and conditions when relevant.",
  );
  lines.push("");

  // Garden metadata
  lines.push("## Garden");
  lines.push(`Name: ${context.garden.name}`);
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

  // Focus plant context
  if (context.focusPlant) {
    lines.push("");
    lines.push("## Focus Plant");
    lines.push(
      `Name: ${context.focusPlant.name} (ID: ${context.focusPlant.id})`,
    );
    lines.push(`Zone: ${context.focusPlant.zoneName}`);
    if (context.focusPlant.variety)
      lines.push(`Variety: ${context.focusPlant.variety}`);
    if (context.focusPlant.datePlanted)
      lines.push(`Planted: ${context.focusPlant.datePlanted}`);
    if (context.focusPlant.growthStage)
      lines.push(`Growth stage: ${context.focusPlant.growthStage}`);
    if (context.focusPlant.careProfile) {
      lines.push(
        `Care profile: ${JSON.stringify(context.focusPlant.careProfile)}`,
      );
    }
  }

  // Focus zone context
  if (context.focusZone) {
    lines.push("");
    lines.push("## Focus Zone");
    lines.push(
      `Name: ${context.focusZone.name} (ID: ${context.focusZone.id})`,
    );
    if (context.focusZone.soilType)
      lines.push(`Soil type: ${context.focusZone.soilType}`);
    if (context.focusZone.sunExposure)
      lines.push(`Sun exposure: ${context.focusZone.sunExposure}`);

    if (context.focusZone.plants.length > 0) {
      lines.push("");
      lines.push("### Plants in this zone");
      for (const plant of context.focusZone.plants) {
        lines.push(`- **${plant.name}** (ID: ${plant.id})`);
        if (plant.variety) lines.push(`  Variety: ${plant.variety}`);
        if (plant.datePlanted) lines.push(`  Planted: ${plant.datePlanted}`);
        if (plant.growthStage)
          lines.push(`  Growth stage: ${plant.growthStage}`);
        if (plant.careProfile) {
          lines.push(`  Care profile: ${JSON.stringify(plant.careProfile)}`);
        }
      }
    }
  }

  // Garden-wide zones (when no specific focus)
  if (context.zones && context.zones.length > 0) {
    lines.push("");
    lines.push("## Zones & Plants");
    for (const zone of context.zones) {
      lines.push(`\n### ${zone.name} (ID: ${zone.id})`);
      if (zone.soilType) lines.push(`Soil: ${zone.soilType}`);
      if (zone.sunExposure) lines.push(`Sun: ${zone.sunExposure}`);
      for (const plant of zone.plants) {
        lines.push(`- **${plant.name}** (ID: ${plant.id})`);
        if (plant.variety) lines.push(`  Variety: ${plant.variety}`);
        if (plant.growthStage)
          lines.push(`  Growth stage: ${plant.growthStage}`);
      }
    }
  }

  // Recent care logs
  if (context.recentCareLogs.length > 0) {
    lines.push("");
    lines.push("## Recent Care History (last 14 days)");
    for (const log of context.recentCareLogs) {
      lines.push(
        `- ${log.actionType} on target ${log.targetId} at ${log.loggedAt}${log.notes ? ` — ${log.notes}` : ""}`,
      );
    }
  }

  // Weather
  if (context.weather) {
    lines.push("");
    lines.push("## Weather");
    lines.push(`Data fetched: ${context.weather.fetchedAt}`);
    lines.push(`Forecast: ${JSON.stringify(context.weather.forecast)}`);
  }

  // Latest analysis results
  if (context.latestAnalysis && context.latestAnalysis.length > 0) {
    lines.push("");
    lines.push("## Latest Analysis Results");
    for (const analysis of context.latestAnalysis) {
      lines.push(`\n### ${analysis.zoneName} (${analysis.generatedAt})`);
      if (analysis.observations.length > 0) {
        lines.push("Observations:");
        for (const obs of analysis.observations) {
          lines.push(`- ${obs}`);
        }
      }
      if (analysis.alerts.length > 0) {
        lines.push("Alerts:");
        for (const alert of analysis.alerts) {
          lines.push(`- ${alert}`);
        }
      }
    }
  }

  // Pending tasks
  if (context.pendingTasks && context.pendingTasks.length > 0) {
    lines.push("");
    lines.push("## Current Pending Tasks");
    for (const task of context.pendingTasks) {
      lines.push(
        `- Task ${task.id}: [${task.actionType}] "${task.label}" for ${task.targetType} — Priority: ${task.priority}, Due: ${task.suggestedDate}`,
      );
    }
  }

  // Action capabilities (only for web conversations)
  if (includeActions) {
    lines.push("");
    lines.push("## Action Capabilities");
    lines.push(
      "You can perform actions in the garden by embedding action tags in your response.",
    );
    lines.push(
      "ONLY use actions when the user explicitly asks you to create tasks, complete tasks, cancel tasks, or log care activities.",
    );
    lines.push("");
    lines.push("### Create Task");
    lines.push("```");
    lines.push(
      '<garden_action type="create_task">{"targetType":"zone|plant","targetId":"<uuid>","zoneId":"<uuid>","actionType":"water|fertilize|harvest|prune|plant|monitor|protect|other","priority":"urgent|today|upcoming|informational","label":"Short label (max 60 chars)","suggestedDate":"YYYY-MM-DD"}</garden_action>',
    );
    lines.push("```");
    lines.push("");
    lines.push("### Complete Task");
    lines.push("```");
    lines.push(
      '<garden_action type="complete_task">{"taskId":"<uuid>","reason":"optional reason"}</garden_action>',
    );
    lines.push("```");
    lines.push("");
    lines.push("### Cancel Task");
    lines.push("```");
    lines.push(
      '<garden_action type="cancel_task">{"taskId":"<uuid>","reason":"optional reason"}</garden_action>',
    );
    lines.push("```");
    lines.push("");
    lines.push("### Log Care Activity");
    lines.push("```");
    lines.push(
      '<garden_action type="create_care_log">{"targetType":"zone|plant","targetId":"<uuid>","actionType":"water|fertilize|harvest|prune|plant|monitor|protect|other","notes":"optional notes"}</garden_action>',
    );
    lines.push("```");
    lines.push("");
    lines.push("Guidelines:");
    lines.push("- ONLY use actions when the user explicitly requests them");
    lines.push(
      "- Always confirm what you're doing when executing an action",
    );
    lines.push("- Use real IDs from the garden context above");
    lines.push(
      "- For create_task, zoneId is always required (use the plant's zone if targeting a plant)",
    );
  }

  lines.push("");
  lines.push("## Instructions");
  lines.push(
    "Be specific to this garden. Reference actual plants and current conditions.",
  );
  lines.push(
    "If photos are attached, analyze them for visible issues like wilting, discoloration, pests, or disease symptoms.",
  );
  lines.push(
    "Format your responses using Markdown for readability: use **bold** for emphasis, bullet lists for multiple items, and headings (###) to organize longer answers. Keep it conversational — don't over-format short replies.",
  );

  return lines.join("\n");
}

// ─── Shared context builder ─────────────────────────────────────────────────

async function buildGardenChatContext(
  db: any,
  gardenId: string,
  userId: string,
  options?: { zoneId?: string; plantId?: string; includeAnalysis?: boolean },
): Promise<ChatContext> {
  const garden = await assertGardenOwnership(db, gardenId, userId);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const chatContext: ChatContext = {
    garden: {
      name: garden.name,
      ...(garden.hardinessZone
        ? { hardinessZone: garden.hardinessZone }
        : {}),
      ...(garden.locationLat != null && garden.locationLng != null
        ? { location: { lat: garden.locationLat, lng: garden.locationLng } }
        : {}),
    },
    recentCareLogs: [],
    currentDate: new Date().toISOString().split("T")[0],
  };

  // Load user settings for skill level
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (user?.settings?.skillLevel) {
    chatContext.userSkillLevel = user.settings.skillLevel;
  }

  // Load weather from cache
  const cachedWeather = await db.query.weatherCache.findFirst({
    where: eq(weatherCache.gardenId, gardenId),
    orderBy: [desc(weatherCache.fetchedAt)],
  });
  if (cachedWeather) {
    chatContext.weather = {
      forecast: cachedWeather.forecast,
      fetchedAt: cachedWeather.fetchedAt.toISOString(),
    };
  }

  const { zoneId, plantId } = options ?? {};

  if (plantId) {
    const plant = await db.query.plants.findFirst({
      where: eq(plants.id, plantId),
      with: { zone: true },
    });

    if (plant) {
      chatContext.focusPlant = {
        id: plant.id,
        name: plant.name,
        ...(plant.variety ? { variety: plant.variety } : {}),
        ...(plant.datePlanted
          ? { datePlanted: plant.datePlanted.toISOString().split("T")[0] }
          : {}),
        ...(plant.growthStage ? { growthStage: plant.growthStage } : {}),
        ...(plant.careProfile
          ? { careProfile: plant.careProfile as Record<string, unknown> }
          : {}),
        zoneName: plant.zone.name,
      };

      const zone = await db.query.zones.findFirst({
        where: eq(zones.id, plant.zoneId),
        with: { plants: true },
      });

      if (zone) {
        chatContext.focusZone = {
          id: zone.id,
          name: zone.name,
          ...(zone.soilType ? { soilType: zone.soilType } : {}),
          ...(zone.sunExposure ? { sunExposure: zone.sunExposure } : {}),
          plants: zone.plants.map((p: any) => ({
            id: p.id,
            name: p.name,
            ...(p.variety ? { variety: p.variety } : {}),
            ...(p.datePlanted
              ? { datePlanted: p.datePlanted.toISOString().split("T")[0] }
              : {}),
            ...(p.growthStage ? { growthStage: p.growthStage } : {}),
            ...(p.careProfile
              ? { careProfile: p.careProfile as Record<string, unknown> }
              : {}),
          })),
        };
      }

      const plantCareLogs = await db
        .select()
        .from(careLogs)
        .where(
          and(
            eq(careLogs.targetId, plantId),
            gte(careLogs.loggedAt, fourteenDaysAgo),
          ),
        )
        .orderBy(desc(careLogs.loggedAt));

      chatContext.recentCareLogs = plantCareLogs.map((log: any) => ({
        actionType: log.actionType,
        targetId: log.targetId,
        loggedAt: log.loggedAt.toISOString(),
        ...(log.notes ? { notes: log.notes } : {}),
      }));
    }
  } else if (zoneId) {
    const zone = await db.query.zones.findFirst({
      where: eq(zones.id, zoneId),
      with: { plants: true },
    });

    if (zone) {
      chatContext.focusZone = {
        id: zone.id,
        name: zone.name,
        ...(zone.soilType ? { soilType: zone.soilType } : {}),
        ...(zone.sunExposure ? { sunExposure: zone.sunExposure } : {}),
        plants: zone.plants.map((p: any) => ({
          id: p.id,
          name: p.name,
          ...(p.variety ? { variety: p.variety } : {}),
          ...(p.datePlanted
            ? { datePlanted: p.datePlanted.toISOString().split("T")[0] }
            : {}),
          ...(p.growthStage ? { growthStage: p.growthStage } : {}),
          ...(p.careProfile
            ? { careProfile: p.careProfile as Record<string, unknown> }
            : {}),
        })),
      };

      const plantIds = zone.plants.map((p: any) => p.id);
      const careLogTargetIds = [zoneId, ...plantIds];

      const zoneCareLogRows =
        careLogTargetIds.length > 0
          ? await db
              .select()
              .from(careLogs)
              .where(
                and(
                  inArray(careLogs.targetId, careLogTargetIds),
                  gte(careLogs.loggedAt, fourteenDaysAgo),
                ),
              )
              .orderBy(desc(careLogs.loggedAt))
          : [];

      chatContext.recentCareLogs = zoneCareLogRows.map((log: any) => ({
        actionType: log.actionType,
        targetId: log.targetId,
        loggedAt: log.loggedAt.toISOString(),
        ...(log.notes ? { notes: log.notes } : {}),
      }));
    }
  } else {
    // Garden-level context
    const gardenZones = await db.query.zones.findMany({
      where: eq(zones.gardenId, gardenId),
      with: { plants: true },
    });

    chatContext.zones = gardenZones.map((zone: any) => ({
      id: zone.id,
      name: zone.name,
      ...(zone.soilType ? { soilType: zone.soilType } : {}),
      ...(zone.sunExposure ? { sunExposure: zone.sunExposure } : {}),
      plants: zone.plants.map((p: any) => ({
        id: p.id,
        name: p.name,
        ...(p.variety ? { variety: p.variety } : {}),
        ...(p.datePlanted
          ? { datePlanted: p.datePlanted.toISOString().split("T")[0] }
          : {}),
        ...(p.growthStage ? { growthStage: p.growthStage } : {}),
        ...(p.careProfile
          ? { careProfile: p.careProfile as Record<string, unknown> }
          : {}),
      })),
    }));

    const allZoneIds = gardenZones.map((z: any) => z.id);
    const allPlantIds = gardenZones.flatMap((z: any) =>
      z.plants.map((p: any) => p.id),
    );
    const allTargetIds = [...allZoneIds, ...allPlantIds];

    if (allTargetIds.length > 0) {
      const gardenCareLogRows = await db
        .select()
        .from(careLogs)
        .where(
          and(
            inArray(careLogs.targetId, allTargetIds),
            gte(careLogs.loggedAt, fourteenDaysAgo),
          ),
        )
        .orderBy(desc(careLogs.loggedAt));

      chatContext.recentCareLogs = gardenCareLogRows.map((log: any) => ({
        actionType: log.actionType,
        targetId: log.targetId,
        loggedAt: log.loggedAt.toISOString(),
        ...(log.notes ? { notes: log.notes } : {}),
      }));
    }
  }

  // Load analysis results + pending tasks for enhanced context
  if (options?.includeAnalysis) {
    // Latest analysis per zone
    const gardenZonesForAnalysis = await db.query.zones.findMany({
      where: eq(zones.gardenId, gardenId),
    });
    const zoneNameMap = new Map(
      gardenZonesForAnalysis.map((z: any) => [z.id, z.name]),
    );

    const recentAnalysis = await db.query.analysisResults.findMany({
      where: eq(analysisResults.gardenId, gardenId),
      orderBy: [desc(analysisResults.generatedAt)],
      limit: 10,
    });

    // Deduplicate — keep only the latest per zone
    const seenZones = new Set<string>();
    const latestPerZone: typeof recentAnalysis = [];
    for (const result of recentAnalysis) {
      const key = result.targetId ?? "garden";
      if (!seenZones.has(key)) {
        seenZones.add(key);
        latestPerZone.push(result);
      }
    }

    chatContext.latestAnalysis = latestPerZone
      .filter((r: (typeof recentAnalysis)[number]) => r.result)
      .map((r: (typeof recentAnalysis)[number]) => ({
        zoneName: r.targetId
          ? zoneNameMap.get(r.targetId) ?? "Unknown"
          : "Garden",
        observations: (r.result as any).observations ?? [],
        alerts: (r.result as any).alerts ?? [],
        generatedAt: r.generatedAt.toISOString().split("T")[0],
      }));

    // Pending tasks
    const pendingTasks = await db.query.tasks.findMany({
      where: and(
        eq(tasks.gardenId, gardenId),
        eq(tasks.status, "pending"),
      ),
    });

    chatContext.pendingTasks = pendingTasks.map((t: any) => ({
      id: t.id,
      targetType: t.targetType,
      targetId: t.targetId,
      zoneId: t.zoneId,
      actionType: t.actionType,
      priority: t.priority,
      label: t.label,
      suggestedDate: t.suggestedDate,
    }));
  }

  return chatContext;
}

// ─── Resolve AI provider ────────────────────────────────────────────────────

async function resolveProvider(
  db: any,
  userId: string,
): Promise<{ provider: AIProvider; apiKey: string }> {
  let apiKey = await getApiKey(db, userId, "claude");
  let provider: AIProvider = new ClaudeProvider();

  if (!apiKey) {
    apiKey = await getApiKey(db, userId, "kimi");
    provider = new KimiProvider();
  }

  if (!apiKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "No AI API key configured. Please add a Claude or Kimi API key in settings.",
    });
  }

  return { provider, apiKey };
}

// ─── Conversations sub-router ───────────────────────────────────────────────

const conversationsRouter = router({
  list: protectedProcedure
    .input(z.object({ gardenId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const rows = await ctx.db.query.conversations.findMany({
        where: and(
          eq(conversations.userId, ctx.userId),
          eq(conversations.gardenId, input.gardenId),
        ),
        orderBy: [desc(conversations.updatedAt)],
      });

      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        messageCount: (r.messages as ChatMessage[]).length,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    }),

  get: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conv = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.userId, ctx.userId),
        ),
      });

      if (!conv) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      return {
        id: conv.id,
        gardenId: conv.gardenId,
        title: conv.title,
        messages: conv.messages as ChatMessage[],
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        gardenId: z.string().uuid(),
        title: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGardenOwnership(ctx.db, input.gardenId, ctx.userId);

      const [conv] = await ctx.db
        .insert(conversations)
        .values({
          userId: ctx.userId,
          gardenId: input.gardenId,
          title: input.title ?? "New conversation",
        })
        .returning();

      return {
        id: conv.id,
        title: conv.title,
        gardenId: conv.gardenId,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conv = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.userId, ctx.userId),
        ),
      });

      if (!conv) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      await ctx.db
        .delete(conversations)
        .where(eq(conversations.id, input.conversationId));

      return { success: true };
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        content: z.string().min(1),
        imageBase64: z.string().optional(),
        imageKey: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Load conversation, validate ownership
      const conv = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.userId, ctx.userId),
        ),
      });

      if (!conv) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const existingMessages = conv.messages as ChatMessage[];

      // 2. Append user message
      const userMessage: ChatMessage = {
        role: "user",
        content: input.content,
        timestamp: new Date().toISOString(),
        ...(input.imageKey ? { imageUrl: input.imageKey } : {}),
      };
      const updatedMessages = [...existingMessages, userMessage];

      // 3. Auto-generate title from first message
      let title = conv.title;
      if (existingMessages.length === 0) {
        title = input.content.slice(0, 50) + (input.content.length > 50 ? "..." : "");
      }

      // 4. Build enhanced context
      const chatContext = await buildGardenChatContext(
        ctx.db,
        conv.gardenId,
        ctx.userId,
        { includeAnalysis: true },
      );

      // 5. Resolve AI provider
      const { provider, apiKey } = await resolveProvider(ctx.db, ctx.userId);

      // 6. Call provider with full message history
      const systemPrompt = buildChatSystemPrompt(chatContext, true);
      const aiMessages = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const result = await provider.chat(
        aiMessages,
        systemPrompt,
        apiKey,
        input.imageBase64,
      );

      // 7. Parse actions from response
      const { cleanText, parsedActions } = parseActions(result.content);

      // 8. Execute each action
      const actionResults = [];
      for (const action of parsedActions) {
        const actionResult = await executeAction(
          ctx.db,
          conv.gardenId,
          ctx.userId,
          action,
        );
        actionResults.push(actionResult);
      }

      // 9. Append assistant message
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: cleanText,
        timestamp: new Date().toISOString(),
        ...(actionResults.length > 0 ? { actions: actionResults } : {}),
      };
      updatedMessages.push(assistantMessage);

      // 10. Persist
      await ctx.db
        .update(conversations)
        .set({
          title,
          messages: updatedMessages,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, input.conversationId));

      // 11. Return
      return {
        message: assistantMessage,
        tokensUsed: result.tokensUsed,
      };
    }),
});

// ─── Router ─────────────────────────────────────────────────────────────────

export const chatRouter = router({
  // Keep existing mobile-compatible stateless send
  send: protectedProcedure
    .input(
      z.object({
        gardenId: z.string().uuid(),
        zoneId: z.string().uuid().optional(),
        plantId: z.string().uuid().optional(),
        messages: z.array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          }),
        ),
        imageBase64: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { gardenId, zoneId, plantId, messages, imageBase64 } = input;

      if (plantId) {
        await assertPlantOwnership(ctx.db, plantId, ctx.userId);
      } else if (zoneId) {
        await assertZoneOwnership(ctx.db, zoneId, ctx.userId);
      }

      const chatContext = await buildGardenChatContext(
        ctx.db,
        gardenId,
        ctx.userId,
        { zoneId, plantId },
      );

      const { provider, apiKey } = await resolveProvider(ctx.db, ctx.userId);
      const systemPrompt = buildChatSystemPrompt(chatContext, false);

      const result = await provider.chat(
        messages,
        systemPrompt,
        apiKey,
        imageBase64,
      );

      return {
        content: result.content,
        tokensUsed: result.tokensUsed,
      };
    }),

  // Persisted conversation endpoints
  conversations: conversationsRouter,
});
