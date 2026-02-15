import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { appRouter, type AppRouter } from "./router.js";
import { type Context } from "./trpc.js";
import { db } from "./db/index.js";
import { verifyToken } from "./lib/auth.js";
import { initJobQueue } from "./jobs/index.js";
import { existsSync } from "fs";
import "dotenv/config";

// Run database migrations before starting the server
console.log("Running database migrations...");
const migrationsFolder = existsSync("./drizzle") ? "./drizzle" : "./packages/server/drizzle";
await migrate(db, { migrationsFolder });
console.log("Database migrations complete");

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });

server.get("/", async () => ({ status: "ok" }));

await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext: ({ req }): Context => {
      let userId: string | null = null;

      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const token = authHeader.slice(7);
          const payload = verifyToken(token);
          userId = payload.userId;
        } catch {
          // Invalid token — treat as unauthenticated
        }
      }

      return { userId, db };
    },
  },
} satisfies FastifyTRPCPluginOptions<AppRouter>);

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

await server.listen({ port, host });
console.log(`Server listening on ${host}:${port}`);

try {
  await initJobQueue();
} catch (err) {
  console.error("Failed to initialize job queue:", err);
}
