import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeProvider } from "../claude.js";
import { KimiProvider } from "../kimi.js";
import { analysisResultSchema } from "../schema.js";
import type { AnalysisContext } from "../provider.js";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ZONE_ID = "00000000-0000-4000-a000-000000000001";
const PLANT_ID = "00000000-0000-4000-a000-000000000002";

const sampleContext: AnalysisContext = {
  garden: {
    name: "Test Garden",
    hardinessZone: "7b",
    location: { lat: 37.7749, lng: -122.4194 },
  },
  zone: {
    id: ZONE_ID,
    name: "Raised Bed A",
    soilType: "loam",
    sunExposure: "full sun",
    plants: [
      {
        id: PLANT_ID,
        name: "Tomato",
        variety: "Roma",
        datePlanted: "2025-04-15",
        growthStage: "fruiting",
        careProfile: { waterFrequencyDays: 2 },
      },
    ],
    recentCareLogs: [
      {
        actionType: "water",
        targetId: PLANT_ID,
        loggedAt: "2025-06-10T08:00:00Z",
        notes: "Deep watering",
      },
    ],
    sensorReadings: [
      {
        sensorType: "soil_moisture",
        value: 35,
        unit: "%",
        recordedAt: "2025-06-11T06:00:00Z",
      },
    ],
  },
  weather: {
    current: { temp: 28, condition: "sunny" },
    forecast: [{ day: "tomorrow", high: 32, low: 18, condition: "clear" }],
  },
  currentDate: "2025-06-11",
  userSkillLevel: "intermediate",
};

const validAnalysisResult = {
  operations: [
    {
      op: "create",
      targetType: "plant",
      targetId: PLANT_ID,
      actionType: "water",
      priority: "today",
      label: "Water tomato — soil moisture is low",
      suggestedDate: "2025-06-11",
      context: "Soil moisture at 35% with hot weather forecast",
      recurrence: "every 2 days",
    },
    {
      op: "create",
      targetType: "zone",
      targetId: ZONE_ID,
      actionType: "monitor",
      priority: "upcoming",
      label: "Check for heat stress signs",
      suggestedDate: "2025-06-13",
      context: "High temperatures expected this week",
    },
  ],
  observations: [
    "Zone is generally healthy, tomato is in active fruiting stage",
  ],
  alerts: ["High heat expected — consider shade cloth for sensitive plants"],
};

// ── Mock Anthropic SDK ────────────────────────────────────────────────────────

const mockAnthropicCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockAnthropicCreate };
      constructor(_opts: unknown) {
        // apiKey captured here but not needed for mock
      }
    },
  };
});

// ── Mock OpenAI SDK ───────────────────────────────────────────────────────────

const mockOpenAICreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: { create: mockOpenAICreate },
      };
      constructor(_opts: unknown) {
        // apiKey + baseURL captured here but not needed for mock
      }
    },
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ClaudeProvider", () => {
  const provider = new ClaudeProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("correctly parses a valid analysis response", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: JSON.stringify(validAnalysisResult) },
      ],
      usage: { input_tokens: 1200, output_tokens: 350 },
    });

    const { result, tokensUsed } = await provider.analyzeZone(
      sampleContext,
      "sk-ant-test-key",
    );

    expect(result.operations).toHaveLength(2);
    const firstOp = result.operations[0];
    expect(firstOp.op).toBe("create");
    if (firstOp.op === "create") {
      expect(firstOp.actionType).toBe("water");
      expect(firstOp.targetId).toBe(PLANT_ID);
    }
    expect(result.observations).toHaveLength(1);
    expect(result.alerts).toHaveLength(1);
    expect(tokensUsed).toEqual({ input: 1200, output: 350 });

    // Validate against schema
    const parsed = analysisResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("handles JSON wrapped in markdown code fences", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: "```json\n" + JSON.stringify(validAnalysisResult) + "\n```",
        },
      ],
      usage: { input_tokens: 1000, output_tokens: 300 },
    });

    const { result } = await provider.analyzeZone(
      sampleContext,
      "sk-ant-test-key",
    );

    expect(result.operations).toHaveLength(2);
  });

  it("throws on invalid JSON response", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: "This is not JSON at all" },
      ],
      usage: { input_tokens: 500, output_tokens: 50 },
    });

    await expect(
      provider.analyzeZone(sampleContext, "sk-ant-test-key"),
    ).rejects.toThrow("Claude returned invalid JSON");
  });

  it("throws on valid JSON that does not match schema", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({ operations: [{ op: "create", wrongField: true }] }),
        },
      ],
      usage: { input_tokens: 500, output_tokens: 50 },
    });

    await expect(
      provider.analyzeZone(sampleContext, "sk-ant-test-key"),
    ).rejects.toThrow(); // ZodError
  });

  it("handles API authentication error gracefully", async () => {
    mockAnthropicCreate.mockRejectedValueOnce(
      new Error("401 Unauthorized: Invalid API key"),
    );

    await expect(
      provider.analyzeZone(sampleContext, "bad-key"),
    ).rejects.toThrow("401 Unauthorized");
  });

  it("chat returns text content and token usage", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: "Your tomato plants look healthy!" },
      ],
      usage: { input_tokens: 800, output_tokens: 100 },
    });

    const { content, tokensUsed } = await provider.chat(
      [{ role: "user", content: "How are my tomatoes?" }],
      "You are a helpful garden advisor.",
      "sk-ant-test-key",
    );

    expect(content).toBe("Your tomato plants look healthy!");
    expect(tokensUsed).toEqual({ input: 800, output: 100 });
  });

  it("includes photos from context as base64 image blocks in analyzeZone", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: JSON.stringify(validAnalysisResult) },
      ],
      usage: { input_tokens: 2000, output_tokens: 400 },
    });

    const contextWithPhotos = {
      ...sampleContext,
      photos: [
        {
          dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
          description: "Care log photo: water action on plant 'Tomato'",
        },
      ],
    };

    await provider.analyzeZone(contextWithPhotos, "sk-ant-test-key");

    const callArgs = mockAnthropicCreate.mock.calls[0][0];
    const userMessage = callArgs.messages[0];
    expect(userMessage.content).toHaveLength(2); // 1 image + 1 text
    expect(userMessage.content[0].type).toBe("image");
    expect(userMessage.content[0].source.type).toBe("base64");
    expect(userMessage.content[0].source.data).toBe("/9j/4AAQSkZJRg==");
  });

  it("includes base64 image in chat when provided", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I can see leaf damage." }],
      usage: { input_tokens: 1500, output_tokens: 200 },
    });

    await provider.chat(
      [{ role: "user", content: "What's wrong with this leaf?" }],
      "You are a helpful garden advisor.",
      "sk-ant-test-key",
      "base64encodeddata",
    );

    const callArgs = mockAnthropicCreate.mock.calls[0][0];
    const lastMsg = callArgs.messages[0];
    expect(lastMsg.content).toHaveLength(2);
    expect(lastMsg.content[0].type).toBe("image");
    expect(lastMsg.content[0].source.data).toBe("base64encodeddata");
  });
});

describe("KimiProvider", () => {
  const provider = new KimiProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("correctly parses a valid analysis response", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: { content: JSON.stringify(validAnalysisResult) },
        },
      ],
      usage: { prompt_tokens: 1100, completion_tokens: 400 },
    });

    const { result, tokensUsed } = await provider.analyzeZone(
      sampleContext,
      "kimi-test-key",
    );

    expect(result.operations).toHaveLength(2);
    const firstOp = result.operations[0];
    expect(firstOp.op).toBe("create");
    if (firstOp.op === "create") {
      expect(firstOp.actionType).toBe("water");
      expect(firstOp.targetId).toBe(PLANT_ID);
    }
    expect(result.observations).toHaveLength(1);
    expect(result.alerts).toHaveLength(1);
    expect(tokensUsed).toEqual({ input: 1100, output: 400 });

    // Validate against schema
    const parsed = analysisResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("handles JSON wrapped in markdown code fences", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content:
              "```json\n" + JSON.stringify(validAnalysisResult) + "\n```",
          },
        },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 350 },
    });

    const { result } = await provider.analyzeZone(
      sampleContext,
      "kimi-test-key",
    );

    expect(result.operations).toHaveLength(2);
  });

  it("throws on invalid JSON response", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        { message: { content: "Not valid JSON content" } },
      ],
      usage: { prompt_tokens: 500, completion_tokens: 50 },
    });

    await expect(
      provider.analyzeZone(sampleContext, "kimi-test-key"),
    ).rejects.toThrow("Kimi returned invalid JSON");
  });

  it("throws on valid JSON that does not match schema", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({ operations: [{ op: "create", badField: 123 }] }),
          },
        },
      ],
      usage: { prompt_tokens: 500, completion_tokens: 50 },
    });

    await expect(
      provider.analyzeZone(sampleContext, "kimi-test-key"),
    ).rejects.toThrow(); // ZodError
  });

  it("handles API authentication error gracefully", async () => {
    mockOpenAICreate.mockRejectedValueOnce(
      new Error("401 Unauthorized: Invalid API key"),
    );

    await expect(
      provider.analyzeZone(sampleContext, "bad-key"),
    ).rejects.toThrow("401 Unauthorized");
  });

  it("chat returns text content and token usage", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        { message: { content: "Your garden looks great!" } },
      ],
      usage: { prompt_tokens: 700, completion_tokens: 80 },
    });

    const { content, tokensUsed } = await provider.chat(
      [{ role: "user", content: "How does my garden look?" }],
      "You are a helpful garden advisor.",
      "kimi-test-key",
    );

    expect(content).toBe("Your garden looks great!");
    expect(tokensUsed).toEqual({ input: 700, output: 80 });
  });

  it("sends response_format json_object for analysis", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        { message: { content: JSON.stringify(validAnalysisResult) } },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 300 },
    });

    await provider.analyzeZone(sampleContext, "kimi-test-key");

    const callArgs = mockOpenAICreate.mock.calls[0][0];
    expect(callArgs.response_format).toEqual({ type: "json_object" });
  });

  it("includes photos from context as data URL image parts in analyzeZone", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        { message: { content: JSON.stringify(validAnalysisResult) } },
      ],
      usage: { prompt_tokens: 2000, completion_tokens: 400 },
    });

    const contextWithPhotos = {
      ...sampleContext,
      photos: [
        {
          dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
          description: "Care log photo: water action on plant 'Tomato'",
        },
      ],
    };

    await provider.analyzeZone(contextWithPhotos, "kimi-test-key");

    const callArgs = mockOpenAICreate.mock.calls[0][0];
    const userMessage = callArgs.messages[1]; // index 1, system is 0
    expect(userMessage.content).toHaveLength(2); // 1 image + 1 text
    expect(userMessage.content[0].type).toBe("image_url");
    expect(userMessage.content[0].image_url.url).toBe(
      "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    );
  });

  it("includes base64 image in chat when provided", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Looks like leaf spot." } }],
      usage: { prompt_tokens: 1200, completion_tokens: 150 },
    });

    await provider.chat(
      [{ role: "user", content: "What's wrong here?" }],
      "You are a helpful garden advisor.",
      "kimi-test-key",
      "base64data",
    );

    const callArgs = mockOpenAICreate.mock.calls[0][0];
    const lastMsg = callArgs.messages[1]; // index 1 (0 is system)
    expect(lastMsg.content).toHaveLength(2);
    expect(lastMsg.content[0].type).toBe("image_url");
    expect(lastMsg.content[0].image_url.url).toBe(
      "data:image/jpeg;base64,base64data",
    );
  });

  it("handles empty usage gracefully", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        { message: { content: JSON.stringify(validAnalysisResult) } },
      ],
      usage: undefined,
    });

    const { tokensUsed } = await provider.analyzeZone(
      sampleContext,
      "kimi-test-key",
    );

    expect(tokensUsed).toEqual({ input: 0, output: 0 });
  });
});

describe("analysisResultSchema", () => {
  it("validates a correct analysis result", () => {
    const parsed = analysisResultSchema.safeParse(validAnalysisResult);
    expect(parsed.success).toBe(true);
  });

  it("rejects operations with invalid actionType", () => {
    const invalid = {
      ...validAnalysisResult,
      operations: [
        {
          ...validAnalysisResult.operations[0],
          actionType: "dance",
        },
      ],
    };
    const parsed = analysisResultSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it("rejects operations with invalid priority", () => {
    const invalid = {
      ...validAnalysisResult,
      operations: [
        {
          ...validAnalysisResult.operations[0],
          priority: "whenever",
        },
      ],
    };
    const parsed = analysisResultSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it("rejects operations missing required fields", () => {
    const invalid = {
      operations: [{ op: "create", targetType: "zone" }], // missing most fields
    };
    const parsed = analysisResultSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it("allows optional observations and alerts to be omitted", () => {
    const minimal = {
      operations: [],
    };
    const parsed = analysisResultSchema.safeParse(minimal);
    expect(parsed.success).toBe(true);
  });

  it("rejects label exceeding 60 characters", () => {
    const invalid = {
      operations: [
        {
          ...validAnalysisResult.operations[0],
          label: "A".repeat(61),
        },
      ],
    };
    const parsed = analysisResultSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it("rejects context exceeding 200 characters", () => {
    const invalid = {
      operations: [
        {
          ...validAnalysisResult.operations[0],
          context: "B".repeat(201),
        },
      ],
    };
    const parsed = analysisResultSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });
});
