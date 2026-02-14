import { router, publicProcedure } from "./trpc.js";
import { authRouter } from "./routers/auth.js";
import { gardensRouter } from "./routers/gardens.js";
import { zonesRouter } from "./routers/zones.js";
import { plantsRouter } from "./routers/plants.js";
import { careLogsRouter } from "./routers/careLogs.js";
import { apiKeysRouter } from "./routers/apiKeys.js";
import { photosRouter } from "./routers/photos.js";
import { chatRouter } from "./routers/chat.js";
import { usersRouter } from "./routers/users.js";
import { sensorsRouter } from "./routers/sensors.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" })),
  auth: authRouter,
  gardens: gardensRouter,
  zones: zonesRouter,
  plants: plantsRouter,
  careLogs: careLogsRouter,
  apiKeys: apiKeysRouter,
  photos: photosRouter,
  chat: chatRouter,
  users: usersRouter,
  sensors: sensorsRouter,
});

export type AppRouter = typeof appRouter;
