import { eq, and, isNotNull, desc, inArray } from "drizzle-orm";
import { type DB } from "../db/index";
import { zones, plants, careLogs } from "../db/schema";
import { getReadUrl } from "../lib/storage";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PhotoMetadata {
  key: string;
  targetType: "zone" | "plant";
  targetId: string;
  targetName: string;
  date: string;
  source: "hero" | "care_log";
  actionType: string | null;
}

export interface PhotoToolResult {
  type: "list" | "image";
  photos?: PhotoMetadata[];
  imageBase64?: string;
  mediaType?: string;
  error?: string;
}

// ─── JSON Schema fragments (shared across formats) ──────────────────────────

const LIST_PHOTOS_PARAMS = {
  type: "object" as const,
  properties: {
    targetType: {
      type: "string" as const,
      enum: ["zone", "plant"],
      description: "Filter photos by target type",
    },
    targetId: {
      type: "string" as const,
      description: "UUID of a specific zone or plant to list photos for",
    },
  },
  required: [] as string[],
};

const VIEW_PHOTO_PARAMS = {
  type: "object" as const,
  properties: {
    photoKey: {
      type: "string" as const,
      description: "The storage key of the photo to view (from list_photos results)",
    },
  },
  required: ["photoKey"],
};

// ─── Tool Definitions (Anthropic format) ─────────────────────────────────────

export const CHAT_TOOL_DEFINITIONS_CLAUDE = [
  {
    name: "list_photos",
    description:
      "List available photos in the garden. Can optionally filter by target type (zone or plant) and target ID. Returns metadata for each photo including storage key, target info, and date.",
    input_schema: LIST_PHOTOS_PARAMS,
  },
  {
    name: "view_photo",
    description:
      "View a specific photo by its storage key. Returns the image as base64 data. Limited to 4 photos per conversation turn.",
    input_schema: VIEW_PHOTO_PARAMS,
  },
];

// ─── Tool Definitions (OpenAI format) ────────────────────────────────────────

export const CHAT_TOOL_DEFINITIONS_OPENAI = [
  {
    type: "function" as const,
    function: {
      name: "list_photos",
      description:
        "List available photos in the garden. Can optionally filter by target type (zone or plant) and target ID. Returns metadata for each photo including storage key, target info, and date.",
      parameters: LIST_PHOTOS_PARAMS,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "view_photo",
      description:
        "View a specific photo by its storage key. Returns the image as base64 data. Limited to 4 photos per conversation turn.",
      parameters: VIEW_PHOTO_PARAMS,
    },
  },
];

// ─── Max photos per turn ────────────────────────────────────────────────────

const MAX_PHOTOS_PER_TURN = 4;

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleListPhotos(
  args: { targetType?: "zone" | "plant"; targetId?: string },
  db: DB,
  gardenId: string,
): Promise<PhotoToolResult> {
  const photos: PhotoMetadata[] = [];

  if (args.targetType && args.targetId) {
    // Scoped to a specific entity
    if (args.targetType === "zone") {
      const zone = await db.query.zones.findFirst({
        where: and(eq(zones.id, args.targetId), eq(zones.gardenId, gardenId)),
      });
      if (zone?.photoUrl) {
        photos.push({
          key: zone.photoUrl,
          targetType: "zone",
          targetId: zone.id,
          targetName: zone.name,
          date: zone.createdAt?.toISOString() ?? new Date().toISOString(),
          source: "hero",
          actionType: null,
        });
      }

      // Care logs for this zone
      const logs = await db.query.careLogs.findMany({
        where: and(
          eq(careLogs.targetId, args.targetId),
          eq(careLogs.targetType, "zone"),
          isNotNull(careLogs.photoUrl),
        ),
        orderBy: [desc(careLogs.loggedAt)],
      });
      for (const log of logs) {
        photos.push({
          key: log.photoUrl!,
          targetType: "zone",
          targetId: log.targetId,
          targetName: zone?.name ?? "Unknown zone",
          date: log.loggedAt.toISOString(),
          source: "care_log",
          actionType: log.actionType,
        });
      }
    } else {
      // plant
      const plant = await db.query.plants.findFirst({
        where: eq(plants.id, args.targetId),
        with: { zone: true },
      });
      if (plant && plant.zone.gardenId === gardenId) {
        if (plant.photoUrl) {
          photos.push({
            key: plant.photoUrl,
            targetType: "plant",
            targetId: plant.id,
            targetName: plant.name,
            date: plant.createdAt?.toISOString() ?? new Date().toISOString(),
            source: "hero",
            actionType: null,
          });
        }

        // Care logs for this plant
        const logs = await db.query.careLogs.findMany({
          where: and(
            eq(careLogs.targetId, args.targetId),
            eq(careLogs.targetType, "plant"),
            isNotNull(careLogs.photoUrl),
          ),
          orderBy: [desc(careLogs.loggedAt)],
        });
        for (const log of logs) {
          photos.push({
            key: log.photoUrl!,
            targetType: "plant",
            targetId: log.targetId,
            targetName: plant.name,
            date: log.loggedAt.toISOString(),
            source: "care_log",
            actionType: log.actionType,
          });
        }
      }
    }
  } else {
    // Garden-wide listing: all zones and plants with photos
    const gardenZones = await db.query.zones.findMany({
      where: eq(zones.gardenId, gardenId),
      with: { plants: true },
    });

    const zoneIds: string[] = [];
    const plantIds: string[] = [];
    const nameMap = new Map<string, string>();

    for (const zone of gardenZones) {
      zoneIds.push(zone.id);
      nameMap.set(zone.id, zone.name);

      if (zone.photoUrl) {
        photos.push({
          key: zone.photoUrl,
          targetType: "zone",
          targetId: zone.id,
          targetName: zone.name,
          date: zone.createdAt?.toISOString() ?? new Date().toISOString(),
          source: "hero",
          actionType: null,
        });
      }

      for (const plant of zone.plants) {
        plantIds.push(plant.id);
        nameMap.set(plant.id, plant.name);

        if (plant.photoUrl) {
          photos.push({
            key: plant.photoUrl,
            targetType: "plant",
            targetId: plant.id,
            targetName: plant.name,
            date: plant.createdAt?.toISOString() ?? new Date().toISOString(),
            source: "hero",
            actionType: null,
          });
        }
      }
    }

    // Care logs for all zones and plants in this garden
    const allTargetIds = [...zoneIds, ...plantIds];
    if (allTargetIds.length > 0) {
      const logs = await db.query.careLogs.findMany({
        where: and(
          inArray(careLogs.targetId, allTargetIds),
          isNotNull(careLogs.photoUrl),
        ),
        orderBy: [desc(careLogs.loggedAt)],
      });
      for (const log of logs) {
        photos.push({
          key: log.photoUrl!,
          targetType: log.targetType,
          targetId: log.targetId,
          targetName: nameMap.get(log.targetId) ?? "Unknown",
          date: log.loggedAt.toISOString(),
          source: "care_log",
          actionType: log.actionType,
        });
      }
    }
  }

  return { type: "list", photos };
}

async function handleViewPhoto(
  args: { photoKey: string },
  photoViewCount: { count: number },
): Promise<PhotoToolResult> {
  if (photoViewCount.count >= MAX_PHOTOS_PER_TURN) {
    return {
      type: "image",
      error: `Photo view limit reached (max ${MAX_PHOTOS_PER_TURN} per turn). Please ask the user to send another message to view more photos.`,
    };
  }

  try {
    const signedUrl = await getReadUrl(args.photoKey);
    const response = await fetch(signedUrl);

    if (!response.ok) {
      return {
        type: "image",
        error: `Failed to fetch photo: HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    photoViewCount.count++;

    return {
      type: "image",
      imageBase64: base64,
      mediaType: contentType,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      type: "image",
      error: `Failed to load photo: ${message}`,
    };
  }
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function executeChatTool(
  toolName: string,
  args: Record<string, unknown>,
  db: DB,
  gardenId: string,
  photoViewCount: { count: number },
): Promise<PhotoToolResult> {
  switch (toolName) {
    case "list_photos":
      return handleListPhotos(
        args as { targetType?: "zone" | "plant"; targetId?: string },
        db,
        gardenId,
      );
    case "view_photo":
      return handleViewPhoto(
        args as { photoKey: string },
        photoViewCount,
      );
    default:
      return { type: "list", error: `Unknown tool: ${toolName}` };
  }
}
