import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions.js";
import { analysisResultSchema, type AnalysisResult } from "./schema";
import {
  type AIProvider,
  type AnalysisContext,
  type ChatToolDefinition,
  type ToolExecutor,
  buildAnalysisSystemPrompt,
} from "./provider";

const BASE_URL = "https://api.moonshot.ai/v1";
const MODEL = "kimi-k2.5";

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return text.trim();
}

export class KimiProvider implements AIProvider {
  async analyzeZone(
    context: AnalysisContext,
    apiKey: string,
  ): Promise<{
    result: AnalysisResult;
    tokensUsed: { input: number; output: number };
  }> {
    const client = new OpenAI({ apiKey, baseURL: BASE_URL });
    const systemPrompt = buildAnalysisSystemPrompt(context);

    const userParts: ChatCompletionContentPart[] = [];

    if (context.photos && context.photos.length > 0) {
      for (const photo of context.photos) {
        userParts.push({
          type: "image_url",
          image_url: { url: photo.dataUrl },
        });
      }
    }

    userParts.push({
      type: "text",
      text: "Analyze this garden zone. Review existing tasks and provide your operations (create/update/complete/cancel) as JSON.",
    });

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userParts },
    ];

    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error("Kimi returned no content in analysis response");
    }

    const jsonStr = extractJson(choice.message.content);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(
        `Kimi returned invalid JSON: ${jsonStr.slice(0, 200)}`,
      );
    }

    const validated = analysisResultSchema.parse(parsed);

    return {
      result: validated,
      tokensUsed: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  async chat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    systemPrompt: string,
    apiKey: string,
    imageBase64?: string,
    imageMediaType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
    tools?: ChatToolDefinition[],
    onToolCall?: ToolExecutor,
  ): Promise<{
    content: string;
    tokensUsed: { input: number; output: number };
  }> {
    const client = new OpenAI({ apiKey, baseURL: BASE_URL });

    const openaiMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (
        imageBase64 &&
        msg.role === "user" &&
        i === messages.length - 1
      ) {
        openaiMessages.push({
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${imageMediaType ?? "image/jpeg"};base64,${imageBase64}`,
              },
            },
            { type: "text", text: msg.content },
          ],
        });
      } else {
        openaiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const openaiTools = tools && tools.length > 0
      ? tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        }))
      : undefined;

    let totalInput = 0;
    let totalOutput = 0;
    const MAX_TOOL_ITERATIONS = 10;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: openaiMessages,
        ...(openaiTools ? { tools: openaiTools } : {}),
      });

      totalInput += response.usage?.prompt_tokens ?? 0;
      totalOutput += response.usage?.completion_tokens ?? 0;

      const choice = response.choices[0];
      if (
        choice?.finish_reason === "tool_calls" &&
        choice.message.tool_calls &&
        onToolCall
      ) {
        // Push the assistant message with tool calls
        openaiMessages.push(choice.message as any);

        // Process each tool call
        const pendingImages: string[] = [];
        for (const toolCall of choice.message.tool_calls) {
          const tc = toolCall as any;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch (e) {
            console.warn(`[KimiProvider] Failed to parse tool arguments for ${tc.function.name}:`, tc.function.arguments);
          }

          const result = await onToolCall(tc.function.name, args);

          if (
            result.type === "image" &&
            result.imageBase64 &&
            !result.error
          ) {
            pendingImages.push(
              `data:${(result.mediaType as string) ?? "image/jpeg"};base64,${result.imageBase64 as string}`,
            );
            openaiMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ type: "image", status: "loaded" }),
            } as any);
          } else {
            openaiMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result),
            } as any);
          }
        }

        if (pendingImages.length > 0) {
          const parts: ChatCompletionContentPart[] = pendingImages.map(
            (dataUrl) => ({
              type: "image_url" as const,
              image_url: { url: dataUrl },
            }),
          );
          parts.push({
            type: "text" as const,
            text: "Here are the requested photos. Describe what you see and provide your analysis.",
          });
          openaiMessages.push({ role: "user", content: parts });
        }

        // Continue the loop for next iteration
        continue;
      }

      // No more tool calls — extract content and return
      const content = choice?.message?.content;
      if (!content) {
        throw new Error("Kimi returned no content in chat response");
      }

      return {
        content,
        tokensUsed: {
          input: totalInput,
          output: totalOutput,
        },
      };
    }

    throw new Error("Kimi tool-use loop exceeded maximum iterations");
  }

  async chatStream(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    systemPrompt: string,
    apiKey: string,
    onChunk: (text: string) => void,
    imageBase64?: string,
    imageMediaType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
    tools?: ChatToolDefinition[],
    onToolCall?: ToolExecutor,
  ): Promise<{
    content: string;
    tokensUsed: { input: number; output: number };
  }> {
    const client = new OpenAI({ apiKey, baseURL: BASE_URL });

    const openaiMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (
        imageBase64 &&
        msg.role === "user" &&
        i === messages.length - 1
      ) {
        openaiMessages.push({
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${imageMediaType ?? "image/jpeg"};base64,${imageBase64}`,
              },
            },
            { type: "text", text: msg.content },
          ],
        });
      } else {
        openaiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const openaiTools = tools && tools.length > 0
      ? tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        }))
      : undefined;

    const hasTools = openaiTools && openaiTools.length > 0 && onToolCall;

    // If no tools, use real streaming for best UX
    if (!hasTools) {
      const stream = await client.chat.completions.create({
        model: MODEL,
        messages: openaiMessages,
        stream: true,
      });

      let fullContent = "";
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          onChunk(delta);
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
      }

      return {
        content: fullContent,
        tokensUsed: {
          input: inputTokens,
          output: outputTokens,
        },
      };
    }

    // With tools: use non-streaming for tool-use iterations, emit final text as chunk
    let totalInput = 0;
    let totalOutput = 0;
    const MAX_TOOL_ITERATIONS = 10;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: openaiMessages,
        tools: openaiTools,
      });

      totalInput += response.usage?.prompt_tokens ?? 0;
      totalOutput += response.usage?.completion_tokens ?? 0;

      const choice = response.choices[0];
      if (
        choice?.finish_reason === "tool_calls" &&
        choice.message.tool_calls
      ) {
        // Push the assistant message with tool calls
        openaiMessages.push(choice.message as any);

        // Process each tool call
        const pendingImages: string[] = [];
        for (const toolCall of choice.message.tool_calls) {
          const tc = toolCall as any;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch (e) {
            console.warn(`[KimiProvider] Failed to parse tool arguments for ${tc.function.name}:`, tc.function.arguments);
          }

          const result = await onToolCall(tc.function.name, args);

          // For image results, strip base64 from tool response and queue as follow-up image
          if (
            result.type === "image" &&
            result.imageBase64 &&
            !result.error
          ) {
            pendingImages.push(
              `data:${(result.mediaType as string) ?? "image/jpeg"};base64,${result.imageBase64 as string}`,
            );
            openaiMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ type: "image", status: "loaded" }),
            } as any);
          } else {
            openaiMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result),
            } as any);
          }
        }

        // Inject images as a user message so the model can "see" them
        if (pendingImages.length > 0) {
          const parts: ChatCompletionContentPart[] = pendingImages.map(
            (dataUrl) => ({
              type: "image_url" as const,
              image_url: { url: dataUrl },
            }),
          );
          parts.push({
            type: "text" as const,
            text: "Here are the requested photos. Describe what you see and provide your analysis.",
          });
          openaiMessages.push({ role: "user", content: parts });
        }

        // Continue the loop for next iteration
        continue;
      }

      // No more tool calls — emit text via onChunk and return
      const content = choice?.message?.content;
      if (!content) {
        throw new Error("Kimi returned no content in chat response");
      }

      onChunk(content);

      return {
        content,
        tokensUsed: {
          input: totalInput,
          output: totalOutput,
        },
      };
    }

    throw new Error("Kimi tool-use loop exceeded maximum iterations");
  }
}
