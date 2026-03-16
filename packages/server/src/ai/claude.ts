import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import { analysisResultSchema, type AnalysisResult } from "./schema";
import {
  type AIProvider,
  type AnalysisContext,
  type ChatToolDefinition,
  type ToolExecutor,
  buildAnalysisSystemPrompt,
} from "./provider";

const MODEL = "claude-sonnet-4-6";

function extractJson(text: string): string {
  // Try to extract JSON from markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  // Otherwise assume the entire text is JSON
  return text.trim();
}

export class ClaudeProvider implements AIProvider {
  async analyzeZone(
    context: AnalysisContext,
    apiKey: string,
  ): Promise<{
    result: AnalysisResult;
    tokensUsed: { input: number; output: number };
  }> {
    const client = new Anthropic({ apiKey });
    const systemPrompt = buildAnalysisSystemPrompt(context);

    const userContent: ContentBlockParam[] = [];

    if (context.photos && context.photos.length > 0) {
      for (const photo of context.photos) {
        const match = photo.dataUrl.match(
          /^data:(image\/[a-z+]+);base64,(.+)$/,
        );
        if (match) {
          userContent.push({
            type: "image",
            source: {
              type: "base64",
              media_type: match[1] as
                | "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp",
              data: match[2],
            },
          } as ImageBlockParam);
        }
      }
    }

    userContent.push({
      type: "text",
      text: "Analyze this garden zone. Review existing tasks and provide your operations (create/update/complete/cancel) as JSON.",
    } as TextBlockParam);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude returned no text content in analysis response");
    }

    const jsonStr = extractJson(textBlock.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(
        `Claude returned invalid JSON: ${jsonStr.slice(0, 200)}`,
      );
    }

    const validated = analysisResultSchema.parse(parsed);

    return {
      result: validated,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
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
    const client = new Anthropic({ apiKey });

    const anthropicMessages: MessageParam[] = messages.map((msg, index) => {
      if (
        imageBase64 &&
        msg.role === "user" &&
        index === messages.length - 1
      ) {
        return {
          role: "user" as const,
          content: [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: imageMediaType ?? ("image/jpeg" as const),
                data: imageBase64,
              },
            },
            { type: "text" as const, text: msg.content },
          ],
        };
      }
      return { role: msg.role, content: msg.content };
    });

    let totalInput = 0;
    let totalOutput = 0;
    const MAX_TOOL_ITERATIONS = 10;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: anthropicMessages,
        ...(tools && tools.length > 0 ? { tools: tools as any } : {}),
      });

      totalInput += response.usage.input_tokens;
      totalOutput += response.usage.output_tokens;

      if (response.stop_reason === "tool_use" && onToolCall) {
        // Push the assistant's full response (includes tool_use blocks)
        anthropicMessages.push({
          role: "assistant",
          content: response.content,
        });

        // Process each tool_use block and collect results
        const toolResults: Array<unknown> = [];
        for (const block of response.content) {
          if (block.type === "tool_use") {
            const result = await onToolCall(
              block.name,
              block.input as Record<string, unknown>,
            );

            if (
              result.type === "image" &&
              result.imageBase64 &&
              !result.error
            ) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: result.mediaType ?? "image/jpeg",
                      data: result.imageBase64,
                    },
                  },
                ],
              });
            } else {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result),
              });
            }
          }
        }

        // Push tool results as a user message
        anthropicMessages.push({
          role: "user",
          content: toolResults,
        } as any);

        // Continue the loop for next iteration
        continue;
      }

      // No more tool calls — extract text and return
      const textBlock = response.content.find(
        (block) => block.type === "text",
      );
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Claude returned no text content in chat response");
      }

      return {
        content: textBlock.text,
        tokensUsed: {
          input: totalInput,
          output: totalOutput,
        },
      };
    }

    throw new Error("Claude tool-use loop exceeded maximum iterations");
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
    const client = new Anthropic({ apiKey });

    const anthropicMessages: MessageParam[] = messages.map((msg, index) => {
      if (
        imageBase64 &&
        msg.role === "user" &&
        index === messages.length - 1
      ) {
        return {
          role: "user" as const,
          content: [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: imageMediaType ?? ("image/jpeg" as const),
                data: imageBase64,
              },
            },
            { type: "text" as const, text: msg.content },
          ],
        };
      }
      return { role: msg.role, content: msg.content };
    });

    const hasTools = tools && tools.length > 0 && onToolCall;

    // If no tools, use real streaming for best UX
    if (!hasTools) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: anthropicMessages,
      });

      let fullContent = "";

      stream.on("text", (text) => {
        fullContent += text;
        onChunk(text);
      });

      const finalMessage = await stream.finalMessage();

      return {
        content: fullContent,
        tokensUsed: {
          input: finalMessage.usage.input_tokens,
          output: finalMessage.usage.output_tokens,
        },
      };
    }

    // With tools: use non-streaming for tool-use iterations, emit final text as chunk
    let totalInput = 0;
    let totalOutput = 0;
    const MAX_TOOL_ITERATIONS = 10;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: anthropicMessages,
        tools: tools as any,
      });

      totalInput += response.usage.input_tokens;
      totalOutput += response.usage.output_tokens;

      if (response.stop_reason === "tool_use") {
        // Push the assistant's full response (includes tool_use blocks)
        anthropicMessages.push({
          role: "assistant",
          content: response.content,
        });

        // Process each tool_use block and collect results
        const toolResults: Array<unknown> = [];
        for (const block of response.content) {
          if (block.type === "tool_use") {
            const result = await onToolCall(
              block.name,
              block.input as Record<string, unknown>,
            );

            if (
              result.type === "image" &&
              result.imageBase64 &&
              !result.error
            ) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: result.mediaType ?? "image/jpeg",
                      data: result.imageBase64,
                    },
                  },
                ],
              });
            } else {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result),
              });
            }
          }
        }

        // Push tool results as a user message
        anthropicMessages.push({
          role: "user",
          content: toolResults,
        } as any);

        // Continue the loop for next iteration
        continue;
      }

      // No more tool calls — emit text via onChunk and return
      const textBlock = response.content.find(
        (block) => block.type === "text",
      );
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Claude returned no text content in chat response");
      }

      onChunk(textBlock.text);

      return {
        content: textBlock.text,
        tokensUsed: {
          input: totalInput,
          output: totalOutput,
        },
      };
    }

    throw new Error("Claude tool-use loop exceeded maximum iterations");
  }
}
