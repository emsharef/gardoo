import { z } from "zod";

const baseOperationFields = z.object({
  targetType: z.enum(["zone", "plant"]).optional(),
  targetId: z.string().uuid().optional(),
  actionType: z
    .enum([
      "water",
      "fertilize",
      "harvest",
      "prune",
      "plant",
      "monitor",
      "protect",
      "other",
    ])
    .optional(),
  priority: z.enum(["urgent", "today", "upcoming", "informational"]).optional(),
  label: z.string().max(60).optional(),
  suggestedDate: z.string().optional(),
  context: z.string().max(200).optional(),
  recurrence: z.string().optional(),
  photoRequested: z.boolean().optional(),
});

export const createOperationSchema = baseOperationFields.extend({
  op: z.literal("create"),
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
  priority: z.enum(["urgent", "today", "upcoming", "informational"]),
  label: z.string().max(60),
  suggestedDate: z.string(),
});

export const updateOperationSchema = baseOperationFields.extend({
  op: z.literal("update"),
  taskId: z.string().uuid(),
});

export const completeOperationSchema = z.object({
  op: z.literal("complete"),
  taskId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

export const cancelOperationSchema = z.object({
  op: z.literal("cancel"),
  taskId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

export const analysisOperationSchema = z.discriminatedUnion("op", [
  createOperationSchema,
  updateOperationSchema,
  completeOperationSchema,
  cancelOperationSchema,
]);

export const analysisResultSchema = z.object({
  operations: z.array(analysisOperationSchema),
  observations: z.array(z.string()).optional(),
  alerts: z.array(z.string()).optional(),
});

export type AnalysisOperation = z.infer<typeof analysisOperationSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
