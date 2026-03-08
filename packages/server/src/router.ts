import { router, publicProcedure } from "./trpc";
import { gardensRouter } from "./routers/gardens";
import { zonesRouter } from "./routers/zones";
import { plantsRouter } from "./routers/plants";
import { careLogsRouter } from "./routers/careLogs";
import { apiKeysRouter } from "./routers/apiKeys";
import { photosRouter } from "./routers/photos";
import { chatRouter } from "./routers/chat";
import { usersRouter } from "./routers/users";
import { sensorsRouter } from "./routers/sensors";
import { tasksRouter } from "./routers/tasks";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" })),
  gardens: gardensRouter,
  zones: zonesRouter,
  plants: plantsRouter,
  careLogs: careLogsRouter,
  apiKeys: apiKeysRouter,
  photos: photosRouter,
  chat: chatRouter,
  users: usersRouter,
  sensors: sensorsRouter,
  tasks: tasksRouter,
});

export type AppRouter = typeof appRouter;
