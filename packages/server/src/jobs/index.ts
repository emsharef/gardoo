import PgBoss from "pg-boss";
import {
  handleDailyTrigger,
  handleAnalyzeGarden,
  handleAnalyzeZone,
} from "./dailyAnalysis.js";

let boss: PgBoss;

/**
 * Initializes the pg-boss job queue, schedules recurring jobs,
 * and registers all job handlers.
 */
export async function initJobQueue(): Promise<PgBoss> {
  boss = new PgBoss(process.env.DATABASE_URL!);

  boss.on("error", (err) => {
    console.error("[pg-boss] Error:", err);
  });

  await boss.start();
  console.log("[pg-boss] Job queue started");

  // pg-boss v10 requires explicit queue creation before scheduling/working
  await boss.createQueue("daily-analysis-trigger");
  await boss.createQueue("analyze-garden");
  await boss.createQueue("analyze-zone");

  // Schedule daily analysis trigger — runs every day at 06:00 UTC
  await boss.schedule("daily-analysis-trigger", "0 6 * * *");

  // Register job handlers
  await boss.work("daily-analysis-trigger", handleDailyTrigger);
  await boss.work("analyze-garden", handleAnalyzeGarden);
  await boss.work("analyze-zone", handleAnalyzeZone);

  console.log("[pg-boss] Job handlers registered");

  return boss;
}

/**
 * Returns the singleton pg-boss instance. Must call initJobQueue() first.
 */
export function getJobQueue(): PgBoss {
  if (!boss) {
    throw new Error("Job queue not initialized — call initJobQueue() first");
  }
  return boss;
}

/**
 * Gracefully stops the pg-boss job queue, releasing all worker
 * subscriptions so jobs can be picked up by other instances.
 */
export async function stopJobQueue(): Promise<void> {
  if (boss) {
    await boss.stop();
    console.log("[pg-boss] Job queue stopped gracefully");
  }
}
