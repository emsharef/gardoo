import { appRouter } from "./router";
import { db } from "./db/index";

export function createTestCaller(
  userId?: string,
): ReturnType<typeof appRouter.createCaller> {
  return appRouter.createCaller({ userId: userId ?? null, db });
}
