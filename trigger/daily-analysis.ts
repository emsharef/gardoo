import { schedules } from "@trigger.dev/sdk/v3";
import { createDb } from "@gardoo/server/src/db/index";
import { gardens } from "@gardoo/server/src/db/schema";
import { analyzeGarden } from "./analyze-garden";

export const dailyAnalysis = schedules.task({
  id: "daily-analysis",
  cron: "0 6 * * *",
  run: async () => {
    const db = createDb(process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!);

    console.log("[daily-analysis] Starting daily analysis run");

    const allGardens = await db.select({ id: gardens.id }).from(gardens);

    console.log(`[daily-analysis] Found ${allGardens.length} gardens to analyze`);

    if (allGardens.length > 0) {
      await analyzeGarden.batchTrigger(
        allGardens.map((g) => ({ payload: { gardenId: g.id } })),
      );
    }

    console.log("[daily-analysis] All garden jobs enqueued");
  },
});
