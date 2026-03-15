import { getUserIdFromToken } from "@gardoo/server/src/trpc";
import { db } from "@gardoo/server/src/db/index";
import { conversations, type ChatMessage } from "@gardoo/server/src/db/schema";
import { eq, and } from "drizzle-orm";
import {
  buildGardenChatContext,
  buildChatSystemPrompt,
  resolveProvider,
} from "@gardoo/server/src/routers/chat";
import { parseActions, executeAction } from "@gardoo/server/src/ai/chatActions";
import {
  CHAT_TOOL_DEFINITIONS_CLAUDE,
  executeChatTool,
} from "@gardoo/server/src/ai/chatTools";
import { ensureUser } from "@gardoo/server/src/lib/ensureUser";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  // 1. Auth
  const authHeader = request.headers.get("authorization");
  const userId = await getUserIdFromToken(authHeader);

  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Ensure user row exists (matches tRPC handler behavior)
  await ensureUser(db, userId);

  // 2. Parse body
  const body = await request.json();
  const { conversationId, content, imageBase64, imageKey } = body;

  if (!conversationId || !content) {
    return new Response(JSON.stringify({ error: "Missing conversationId or content" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Load conversation
  const conv = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.userId, userId),
    ),
  });

  if (!conv) {
    return new Response(JSON.stringify({ error: "Conversation not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 4. Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const existingMessages = conv.messages as ChatMessage[];

        // Append user message
        const userMessage: ChatMessage = {
          role: "user",
          content,
          timestamp: new Date().toISOString(),
          ...(imageKey ? { imageUrl: imageKey } : {}),
        };
        const updatedMessages = [...existingMessages, userMessage];

        // Auto-title
        let title = conv.title;
        if (existingMessages.length === 0) {
          title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
        }

        // Build context & resolve provider
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

        // Stream
        const photoViewCount = { count: 0 };
        const toolExecutor = async (
          toolName: string,
          args: Record<string, unknown>,
        ): Promise<{ type: string; [key: string]: unknown }> => {
          return executeChatTool(toolName, args, db, conv.gardenId, photoViewCount) as any;
        };

        const result = await provider.chatStream(
          aiMessages,
          systemPrompt,
          apiKey,
          (chunk) => {
            controller.enqueue(
              encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`),
            );
          },
          imageBase64,
          undefined,
          CHAT_TOOL_DEFINITIONS_CLAUDE,
          toolExecutor,
        );

        // Parse and execute actions
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

        // Persist conversation
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
          .where(eq(conversations.id, conversationId));

        // Done event
        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({
              actions: actionResults,
              tokensUsed: result.tokensUsed,
              cleanText,
            })}\n\n`,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[chat-stream] Error:", err);
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
