import { describe, it, expect } from "vitest";
import { analysisResultSchema } from "../schema.js";

describe("analysisResultSchema", () => {
  it("should validate a create operation", () => {
    const input = {
      operations: [
        {
          op: "create",
          targetType: "plant",
          targetId: "00000000-0000-4000-a000-000000000010",
          actionType: "water",
          priority: "today",
          label: "Water the tomatoes",
          suggestedDate: "2026-02-18",
          context: "Soil is dry based on sensor readings",
        },
      ],
      observations: ["Zone looks healthy overall"],
      alerts: [],
    };
    const result = analysisResultSchema.parse(input);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].op).toBe("create");
  });

  it("should validate an update operation with partial fields", () => {
    const input = {
      operations: [
        {
          op: "update",
          taskId: "00000000-0000-4000-a000-000000000020",
          suggestedDate: "2026-02-20",
          priority: "upcoming",
        },
      ],
    };
    const result = analysisResultSchema.parse(input);
    const op = result.operations[0];
    expect(op.op).toBe("update");
    if (op.op === "update") {
      expect(op.taskId).toBeDefined();
    }
  });

  it("should validate a complete operation", () => {
    const input = {
      operations: [
        {
          op: "complete",
          taskId: "00000000-0000-4000-a000-000000000020",
          reason: "Care log shows watering done yesterday",
        },
      ],
    };
    const result = analysisResultSchema.parse(input);
    expect(result.operations[0].op).toBe("complete");
  });

  it("should validate a cancel operation", () => {
    const input = {
      operations: [
        {
          op: "cancel",
          taskId: "00000000-0000-4000-a000-000000000020",
          reason: "Plant was removed from zone",
        },
      ],
    };
    const result = analysisResultSchema.parse(input);
    expect(result.operations[0].op).toBe("cancel");
  });

  it("should validate a create operation with photoRequested", () => {
    const input = {
      operations: [
        {
          op: "create",
          targetType: "plant",
          targetId: "00000000-0000-4000-a000-000000000010",
          actionType: "monitor",
          priority: "today",
          label: "Check tomato leaves for spots",
          suggestedDate: "2026-02-18",
          photoRequested: true,
        },
      ],
    };
    const result = analysisResultSchema.parse(input);
    const op = result.operations[0];
    expect(op.op).toBe("create");
    if (op.op === "create") {
      expect(op.photoRequested).toBe(true);
    }
  });

  it("should validate mixed operations", () => {
    const input = {
      operations: [
        {
          op: "create",
          targetType: "zone",
          targetId: "00000000-0000-4000-a000-000000000001",
          actionType: "fertilize",
          priority: "upcoming",
          label: "Apply compost to bed",
          suggestedDate: "2026-02-22",
        },
        {
          op: "update",
          taskId: "00000000-0000-4000-a000-000000000030",
          suggestedDate: "2026-02-19",
        },
        {
          op: "complete",
          taskId: "00000000-0000-4000-a000-000000000040",
          reason: "Watering completed per care log",
        },
      ],
      observations: ["Soil moisture is good"],
    };
    const result = analysisResultSchema.parse(input);
    expect(result.operations).toHaveLength(3);
  });

  it("should reject create without required fields", () => {
    const input = {
      operations: [
        {
          op: "create",
          targetType: "plant",
          // missing targetId, actionType, priority, label, suggestedDate
        },
      ],
    };
    expect(() => analysisResultSchema.parse(input)).toThrow();
  });

  it("should reject update without taskId", () => {
    const input = {
      operations: [
        {
          op: "update",
          suggestedDate: "2026-02-20",
          // missing taskId
        },
      ],
    };
    expect(() => analysisResultSchema.parse(input)).toThrow();
  });
});
