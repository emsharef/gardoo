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
}

function buildChatSystemPrompt(context: ChatContext): string {
  const lines: string[] = [];

  lines.push(
    "You are an expert garden advisor helping with a specific garden. " +
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

  lines.push("");
  lines.push("## Instructions");
  lines.push(
    "Be specific to this garden. Reference actual plants and current conditions.",
  );
  lines.push(
    "If photos are attached, analyze them for visible issues like wilting, discoloration, pests, or disease symptoms.",
  );

  return lines.join("\n");
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const chatRouter = router({
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

      // 1. Validate ownership
      const garden = await assertGardenOwnership(
        ctx.db,
        gardenId,
        ctx.userId,
      );

      if (plantId) {
        await assertPlantOwnership(ctx.db, plantId, ctx.userId);
      } else if (zoneId) {
        await assertZoneOwnership(ctx.db, zoneId, ctx.userId);
      }

      // 2. Build context
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
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.userId),
      });
      if (user?.settings?.skillLevel) {
        chatContext.userSkillLevel = user.settings.skillLevel;
      }

      // Load weather from cache
      const cachedWeather = await ctx.db.query.weatherCache.findFirst({
        where: eq(weatherCache.gardenId, gardenId),
        orderBy: [desc(weatherCache.fetchedAt)],
      });
      if (cachedWeather) {
        chatContext.weather = {
          forecast: cachedWeather.forecast,
          fetchedAt: cachedWeather.fetchedAt.toISOString(),
        };
      }

      if (plantId) {
        // Plant-focused context: load plant + its zone + garden
        const plant = await ctx.db.query.plants.findFirst({
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

          // Also load the zone with its plants for broader context
          const zone = await ctx.db.query.zones.findFirst({
            where: eq(zones.id, plant.zoneId),
            with: { plants: true },
          });

          if (zone) {
            chatContext.focusZone = {
              id: zone.id,
              name: zone.name,
              ...(zone.soilType ? { soilType: zone.soilType } : {}),
              ...(zone.sunExposure ? { sunExposure: zone.sunExposure } : {}),
              plants: zone.plants.map((p) => ({
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

          // Recent care logs for the plant
          const plantCareLogs = await ctx.db
            .select()
            .from(careLogs)
            .where(
              and(
                eq(careLogs.targetId, plantId),
                gte(careLogs.loggedAt, fourteenDaysAgo),
              ),
            )
            .orderBy(desc(careLogs.loggedAt));

          chatContext.recentCareLogs = plantCareLogs.map((log) => ({
            actionType: log.actionType,
            targetId: log.targetId,
            loggedAt: log.loggedAt.toISOString(),
            ...(log.notes ? { notes: log.notes } : {}),
          }));
        }
      } else if (zoneId) {
        // Zone-focused context: load zone + all plants + care logs
        const zone = await ctx.db.query.zones.findFirst({
          where: eq(zones.id, zoneId),
          with: { plants: true },
        });

        if (zone) {
          chatContext.focusZone = {
            id: zone.id,
            name: zone.name,
            ...(zone.soilType ? { soilType: zone.soilType } : {}),
            ...(zone.sunExposure ? { sunExposure: zone.sunExposure } : {}),
            plants: zone.plants.map((p) => ({
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

          // Care logs for zone + all its plants
          const plantIds = zone.plants.map((p) => p.id);
          const careLogTargetIds = [zoneId, ...plantIds];

          const zoneCareLogRows =
            careLogTargetIds.length > 0
              ? await ctx.db
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

          chatContext.recentCareLogs = zoneCareLogRows.map((log) => ({
            actionType: log.actionType,
            targetId: log.targetId,
            loggedAt: log.loggedAt.toISOString(),
            ...(log.notes ? { notes: log.notes } : {}),
          }));
        }
      } else {
        // Garden-level context: load all zones and plants
        const gardenZones = await ctx.db.query.zones.findMany({
          where: eq(zones.gardenId, gardenId),
          with: { plants: true },
        });

        chatContext.zones = gardenZones.map((zone) => ({
          id: zone.id,
          name: zone.name,
          ...(zone.soilType ? { soilType: zone.soilType } : {}),
          ...(zone.sunExposure ? { sunExposure: zone.sunExposure } : {}),
          plants: zone.plants.map((p) => ({
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

        // Care logs for all zone and plant targets in this garden
        const allZoneIds = gardenZones.map((z) => z.id);
        const allPlantIds = gardenZones.flatMap((z) =>
          z.plants.map((p) => p.id),
        );
        const allTargetIds = [...allZoneIds, ...allPlantIds];

        if (allTargetIds.length > 0) {
          const gardenCareLogRows = await ctx.db
            .select()
            .from(careLogs)
            .where(
              and(
                inArray(careLogs.targetId, allTargetIds),
                gte(careLogs.loggedAt, fourteenDaysAgo),
              ),
            )
            .orderBy(desc(careLogs.loggedAt));

          chatContext.recentCareLogs = gardenCareLogRows.map((log) => ({
            actionType: log.actionType,
            targetId: log.targetId,
            loggedAt: log.loggedAt.toISOString(),
            ...(log.notes ? { notes: log.notes } : {}),
          }));
        }
      }

      // 3. Determine AI provider — try Claude first, fall back to Kimi
      let apiKey = await getApiKey(ctx.db, ctx.userId, "claude");
      let provider: AIProvider = new ClaudeProvider();

      if (!apiKey) {
        apiKey = await getApiKey(ctx.db, ctx.userId, "kimi");
        provider = new KimiProvider();
      }

      if (!apiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No AI API key configured. Please add a Claude or Kimi API key in settings.",
        });
      }

      // 4. Build system prompt and call provider
      const systemPrompt = buildChatSystemPrompt(chatContext);

      const result = await provider.chat(
        messages,
        systemPrompt,
        apiKey,
        imageBase64,
      );

      // 5. Return response
      return {
        content: result.content,
        tokensUsed: result.tokensUsed,
      };
    }),
});
