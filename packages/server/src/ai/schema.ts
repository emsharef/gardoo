import { z } from "zod";

export const analysisActionSchema = z.object({
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
  context: z.string().max(200).optional(),
  recurrence: z.string().optional(),
});

export const analysisResultSchema = z.object({
  actions: z.array(analysisActionSchema),
  observations: z.array(z.string()).optional(),
  alerts: z.array(z.string()).optional(),
});

export type AnalysisAction = z.infer<typeof analysisActionSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
