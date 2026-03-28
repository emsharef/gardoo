import { describe, it, expect } from "vitest";
import { computeTaskBudget } from "../taskBudget";

describe("computeTaskBudget", () => {
  it("uses normal ratio (2) and floor (3) by default", () => {
    const result = computeTaskBudget({ plantCount: 8 });
    // ceil(8/2) = 4, max(3, 4) = 4
    expect(result).toEqual({ maxTasks: 4, ratio: 2, floor: 3 });
  });

  it("applies floor when plant count is low", () => {
    const result = computeTaskBudget({ plantCount: 1, taskQuantity: "normal" });
    // ceil(1/2) = 1, max(3, 1) = 3
    expect(result).toEqual({ maxTasks: 3, ratio: 2, floor: 3 });
  });

  it("uses low ratio (4) and floor (2)", () => {
    const result = computeTaskBudget({ plantCount: 20, taskQuantity: "low" });
    // ceil(20/4) = 5, max(2, 5) = 5
    expect(result).toEqual({ maxTasks: 5, ratio: 4, floor: 2 });
  });

  it("applies low floor when plant count is very low", () => {
    const result = computeTaskBudget({ plantCount: 2, taskQuantity: "low" });
    // ceil(2/4) = 1, max(2, 1) = 2
    expect(result).toEqual({ maxTasks: 2, ratio: 4, floor: 2 });
  });

  it("uses high ratio (1) and floor (5)", () => {
    const result = computeTaskBudget({ plantCount: 12, taskQuantity: "high" });
    // ceil(12/1) = 12, max(5, 12) = 12
    expect(result).toEqual({ maxTasks: 12, ratio: 1, floor: 5 });
  });

  it("applies high floor when plant count is low", () => {
    const result = computeTaskBudget({ plantCount: 3, taskQuantity: "high" });
    // ceil(3/1) = 3, max(5, 3) = 5
    expect(result).toEqual({ maxTasks: 5, ratio: 1, floor: 5 });
  });

  it("handles zero plants using the floor", () => {
    const result = computeTaskBudget({ plantCount: 0, taskQuantity: "normal" });
    // ceil(0/2) = 0, max(3, 0) = 3
    expect(result).toEqual({ maxTasks: 3, ratio: 2, floor: 3 });
  });
});
