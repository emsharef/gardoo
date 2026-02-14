import { router, publicProcedure } from "./trpc.js";
import { authRouter } from "./routers/auth.js";
import { gardensRouter } from "./routers/gardens.js";
import { zonesRouter } from "./routers/zones.js";
import { plantsRouter } from "./routers/plants.js";
import { careLogsRouter } from "./routers/careLogs.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" })),
  auth: authRouter,
  gardens: gardensRouter,
  zones: zonesRouter,
  plants: plantsRouter,
  careLogs: careLogsRouter,
});

export type AppRouter = typeof appRouter;
