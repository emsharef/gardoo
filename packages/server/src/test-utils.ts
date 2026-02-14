import { appRouter } from "./router.js";
import { db } from "./db/index.js";

export function createTestCaller(
  userId?: string,
): ReturnType<typeof appRouter.createCaller> {
  return appRouter.createCaller({ userId: userId ?? null, db });
}
