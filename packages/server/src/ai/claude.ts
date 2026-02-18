import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import { analysisResultSchema, type AnalysisResult } from "./schema.js";
import {
  type AIProvider,
  type AnalysisContext,
  buildAnalysisSystemPrompt,
} from "./provider.js";

const MODEL = "claude-sonnet-4-20250514";

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

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude returned no text content in chat response");
    }

    return {
      content: textBlock.text,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  }
}
