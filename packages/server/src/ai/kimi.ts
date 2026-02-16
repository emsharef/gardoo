import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions.js";
import { analysisResultSchema, type AnalysisResult } from "./schema.js";
import {
  type AIProvider,
  type AnalysisContext,
  buildAnalysisSystemPrompt,
} from "./provider.js";

const BASE_URL = "https://api.moonshot.ai/v1";
const MODEL = "moonshot-v1-8k";

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
    photoUrls?: string[],
  ): Promise<{
    result: AnalysisResult;
    tokensUsed: { input: number; output: number };
  }> {
    const client = new OpenAI({ apiKey, baseURL: BASE_URL });
    const systemPrompt = buildAnalysisSystemPrompt(context);

    const userParts: ChatCompletionContentPart[] = [];

    if (photoUrls && photoUrls.length > 0) {
      for (const url of photoUrls) {
        userParts.push({
          type: "image_url",
          image_url: { url },
        });
      }
    }

    userParts.push({
      type: "text",
      text: "Analyze this garden zone and provide your recommendations as JSON.",
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

    const response = await client.chat.completions.create({
      model: MODEL,
      messages: openaiMessages,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Kimi returned no content in chat response");
    }

    return {
      content,
      tokensUsed: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
