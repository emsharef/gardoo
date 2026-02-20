import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { type DB } from "../db/index.js";
import { tasks, careLogs, zones, plants } from "../db/schema.js";
import type { ChatMessageAction } from "../db/schema.js";

// ─── Zod schemas for action payloads ────────────────────────────────────────

const createTaskPayload = z.object({
  targetType: z.enum(["zone", "plant"]),
  targetId: z.string().uuid(),
  zoneId: z.string().uuid(),
  actionType: z.enum([
    "water",
    "fertilize",
    "harvest",
    "prune",
    "plant",
    "monitor",
    "protect",
    "other",
  ]),
  priority: z.enum(["urgent", "today", "upcoming", "informational"]),
  label: z.string().max(60),
  suggestedDate: z.string(),
  context: z.string().max(200).optional(),
  recurrence: z.string().optional(),
  photoRequested: z.boolean().optional(),
});

const completeTaskPayload = z.object({
  taskId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

const cancelTaskPayload = z.object({
  taskId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

const createCareLogPayload = z.object({
  targetType: z.enum(["zone", "plant"]),
  targetId: z.string().uuid(),
  actionType: z.enum([
    "water",
    "fertilize",
    "harvest",
    "prune",
    "plant",
    "monitor",
    "protect",
    "other",
  ]),
  notes: z.string().optional(),
});

// ─── Parsed action from AI text ─────────────────────────────────────────────

interface ParsedAction {
  type: "create_task" | "complete_task" | "cancel_task" | "create_care_log";
  payload: Record<string, unknown>;
}

// ─── Parse <garden_action> tags from AI response ────────────────────────────

const ACTION_TAG_REGEX =
  /<garden_action\s+type="([^"]+)">([\s\S]*?)<\/garden_action>/g;

export function parseActions(rawText: string): {
  cleanText: string;
  parsedActions: ParsedAction[];
} {
  const parsedActions: ParsedAction[] = [];
  const cleanText = rawText.replace(ACTION_TAG_REGEX, (_, type, jsonStr) => {
    try {
      const payload = JSON.parse(jsonStr.trim());
      parsedActions.push({ type: type as ParsedAction["type"], payload });
    } catch {
      console.warn(`[chat-actions] Failed to parse action payload: ${jsonStr}`);
    }
    return "";
  }).trim();

  return { cleanText, parsedActions };
}

// ─── Execute a single action against the DB ─────────────────────────────────

export async function executeAction(
  db: DB,
  gardenId: string,
  userId: string,
  action: ParsedAction,
): Promise<ChatMessageAction> {
  try {
    switch (action.type) {
      case "create_task": {
        const data = createTaskPayload.parse(action.payload);

        // Validate zone belongs to garden
        const zone = await db.query.zones.findFirst({
          where: and(eq(zones.id, data.zoneId), eq(zones.gardenId, gardenId)),
        });
        if (!zone) {
          return {
            type: "create_task",
            status: "error",
            summary: `Zone not found in this garden`,
            error: `Zone ${data.zoneId} not found`,
          };
        }

        // If target is a plant, validate it exists in the zone
        if (data.targetType === "plant") {
          const plant = await db.query.plants.findFirst({
            where: and(
              eq(plants.id, data.targetId),
              eq(plants.zoneId, data.zoneId),
            ),
          });
          if (!plant) {
            return {
              type: "create_task",
              status: "error",
              summary: `Plant not found in zone`,
              error: `Plant ${data.targetId} not found in zone ${data.zoneId}`,
            };
          }
        }

        const [created] = await db
          .insert(tasks)
          .values({
            gardenId,
            zoneId: data.zoneId,
            targetType: data.targetType,
            targetId: data.targetId,
            actionType: data.actionType,
            priority: data.priority,
            status: "pending",
            label: data.label,
            suggestedDate: data.suggestedDate,
            context: data.context ?? null,
            recurrence: data.recurrence ?? null,
            photoRequested: data.photoRequested ? "true" : "false",
          })
          .returning();

        return {
          type: "create_task",
          status: "success",
          summary: `Created task: ${data.label}`,
          details: { taskId: created.id, priority: data.priority },
        };
      }

      case "complete_task": {
        const data = completeTaskPayload.parse(action.payload);

        const task = await db.query.tasks.findFirst({
          where: and(
            eq(tasks.id, data.taskId),
            eq(tasks.gardenId, gardenId),
            eq(tasks.status, "pending"),
          ),
        });
        if (!task) {
          return {
            type: "complete_task",
            status: "error",
            summary: `Task not found or not pending`,
            error: `Task ${data.taskId} not found or not pending`,
          };
        }

        // Create care log and complete task
        const [careLog] = await db
          .insert(careLogs)
          .values({
            targetType: task.targetType,
            targetId: task.targetId,
            actionType: task.actionType,
            notes: data.reason ?? `Completed: ${task.label}`,
          })
          .returning();

        await db
          .update(tasks)
          .set({
            status: "completed",
            completedAt: new Date(),
            completedVia: "ai_chat",
            careLogId: careLog.id,
            context: data.reason ?? task.context,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, data.taskId));

        return {
          type: "complete_task",
          status: "success",
          summary: `Completed task: ${task.label}`,
          details: { taskId: data.taskId },
        };
      }

      case "cancel_task": {
        const data = cancelTaskPayload.parse(action.payload);

        const task = await db.query.tasks.findFirst({
          where: and(
            eq(tasks.id, data.taskId),
            eq(tasks.gardenId, gardenId),
            eq(tasks.status, "pending"),
          ),
        });
        if (!task) {
          return {
            type: "cancel_task",
            status: "error",
            summary: `Task not found or not pending`,
            error: `Task ${data.taskId} not found or not pending`,
          };
        }

        await db
          .update(tasks)
          .set({
            status: "cancelled",
            completedAt: new Date(),
            completedVia: "ai_chat",
            context: data.reason ?? task.context,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, data.taskId));

        return {
          type: "cancel_task",
          status: "success",
          summary: `Cancelled task: ${task.label}`,
          details: { taskId: data.taskId },
        };
      }

      case "create_care_log": {
        const data = createCareLogPayload.parse(action.payload);

        const [log] = await db
          .insert(careLogs)
          .values({
            targetType: data.targetType,
            targetId: data.targetId,
            actionType: data.actionType,
            notes: data.notes ?? null,
          })
          .returning();

        return {
          type: "create_care_log",
          status: "success",
          summary: `Logged ${data.actionType} for ${data.targetType}`,
          details: { careLogId: log.id },
        };
      }

      default:
        return {
          type: action.type,
          status: "error",
          summary: `Unknown action type: ${action.type}`,
          error: `Unsupported action type`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[chat-actions] Failed to execute ${action.type}:`, err);
    return {
      type: action.type,
      status: "error",
      summary: `Failed to execute ${action.type}`,
      error: message,
    };
  }
}
