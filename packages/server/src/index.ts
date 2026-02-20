import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, and } from "drizzle-orm";
import { appRouter, type AppRouter } from "./router.js";
import { type Context } from "./trpc.js";
import { db } from "./db/index.js";
import { conversations, type ChatMessage } from "./db/schema.js";
import { verifyToken } from "./lib/auth.js";
import { initJobQueue, stopJobQueue } from "./jobs/index.js";
import { existsSync } from "fs";
import {
  buildGardenChatContext,
  buildChatSystemPrompt,
  resolveProvider,
} from "./routers/chat.js";
import { parseActions, executeAction } from "./ai/chatActions.js";

// Run database migrations before starting the server
console.log("Running database migrations...");
const migrationsFolder = existsSync("./drizzle") ? "./drizzle" : "./packages/server/drizzle";
await migrate(db, { migrationsFolder });
console.log("Database migrations complete");

const server = Fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024, // 50 MB – base64 photos can be large
});

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

// ─── SSE streaming chat endpoint ─────────────────────────────────────────────

server.post("/api/chat/stream", async (request, reply) => {
  // 1. Auth
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  let userId: string;
  try {
    const payload = verifyToken(authHeader.slice(7));
    userId = payload.userId;
  } catch {
    return reply.status(401).send({ error: "Invalid token" });
  }

  // 2. Parse body
  const body = request.body as {
    conversationId: string;
    content: string;
    imageBase64?: string;
    imageKey?: string;
  };

  if (!body.conversationId || !body.content) {
    return reply.status(400).send({ error: "Missing conversationId or content" });
  }

  // 3. Load conversation
  const conv = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, body.conversationId),
      eq(conversations.userId, userId),
    ),
  });

  if (!conv) {
    return reply.status(404).send({ error: "Conversation not found" });
  }

  // 4. Hijack the response so Fastify doesn't buffer/manage it
  reply.hijack();
  const raw = reply.raw;

  // Disable Nagle's algorithm for immediate chunk delivery
  raw.socket?.setNoDelay(true);

  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  raw.flushHeaders();

  try {
    const existingMessages = conv.messages as ChatMessage[];

    // 5. Append user message
    const userMessage: ChatMessage = {
      role: "user",
      content: body.content,
      timestamp: new Date().toISOString(),
      ...(body.imageKey ? { imageUrl: body.imageKey } : {}),
    };
    const updatedMessages = [...existingMessages, userMessage];

    // Auto-title from first message
    let title = conv.title;
    if (existingMessages.length === 0) {
      title =
        body.content.slice(0, 50) +
        (body.content.length > 50 ? "..." : "");
    }

    // 6. Build context & resolve provider
    const chatContext = await buildGardenChatContext(
      db,
      conv.gardenId,
      userId,
      { includeAnalysis: true },
    );
    const { provider, apiKey } = await resolveProvider(db, userId);
    const systemPrompt = buildChatSystemPrompt(chatContext, true);

    const aiMessages = updatedMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 7. Stream response
    const result = await provider.chatStream(
      aiMessages,
      systemPrompt,
      apiKey,
      (chunk) => {
        raw.write(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
      },
      body.imageBase64,
    );

    // 8. Parse and execute actions
    const { cleanText, parsedActions } = parseActions(result.content);

    const actionResults = [];
    for (const action of parsedActions) {
      const actionResult = await executeAction(
        db,
        conv.gardenId,
        userId,
        action,
      );
      actionResults.push(actionResult);
    }

    // 9. Persist conversation
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: cleanText,
      timestamp: new Date().toISOString(),
      ...(actionResults.length > 0 ? { actions: actionResults } : {}),
    };
    updatedMessages.push(assistantMessage);

    await db
      .update(conversations)
      .set({
        title,
        messages: updatedMessages,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, body.conversationId));

    // 10. Send done event
    raw.write(
      `event: done\ndata: ${JSON.stringify({
        actions: actionResults,
        tokensUsed: result.tokensUsed,
        cleanText,
      })}\n\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[chat-stream] Error:", err);
    raw.write(
      `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`,
    );
  }

  raw.end();
});

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

await server.listen({ port, host });
console.log(`Server listening on ${host}:${port} (hostname: ${process.env.HOSTNAME ?? "unknown"})`);

try {
  await initJobQueue();
} catch (err) {
  console.error("Failed to initialize job queue:", err);
}

// Graceful shutdown — release pg-boss workers so jobs aren't orphaned
// when Render kills this instance during a deploy.
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  await stopJobQueue();
  await server.close();
  process.exit(0);
});
