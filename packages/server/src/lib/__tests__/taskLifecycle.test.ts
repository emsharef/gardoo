import { describe, it, expect } from "vitest";
import { findStaleTasks, enforceBudget } from "../taskLifecycle";

// Minimal task shape for testing
interface MockTask {
  id: string;
  suggestedDate: string;
  priority: string;
  status: string;
}

describe("findStaleTasks", () => {
  it("returns tasks whose suggestedDate is >7 days before currentDate", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-10", priority: "today", status: "pending" },
      { id: "b", suggestedDate: "2026-03-20", priority: "today", status: "pending" },
      { id: "c", suggestedDate: "2026-03-28", priority: "upcoming", status: "pending" },
    ];
    // currentDate is March 28. March 10 is 18 days ago (stale). March 20 is 8 days ago (stale). March 28 is today (not stale).
    const stale = findStaleTasks(tasks, "2026-03-28");
    expect(stale.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("returns empty array when no tasks are stale", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-25", priority: "today", status: "pending" },
    ];
    const stale = findStaleTasks(tasks, "2026-03-28");
    expect(stale).toEqual([]);
  });

  it("treats exactly 7 days ago as not stale", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-21", priority: "today", status: "pending" },
    ];
    const stale = findStaleTasks(tasks, "2026-03-28");
    expect(stale).toEqual([]);
  });
});

describe("enforceBudget", () => {
  it("returns empty array when under budget", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-28", priority: "today", status: "pending" },
      { id: "b", suggestedDate: "2026-03-29", priority: "upcoming", status: "pending" },
    ];
    const toCancel = enforceBudget(tasks, 5);
    expect(toCancel).toEqual([]);
  });

  it("cancels lowest-priority tasks when over budget", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-28", priority: "urgent", status: "pending" },
      { id: "b", suggestedDate: "2026-03-28", priority: "today", status: "pending" },
      { id: "c", suggestedDate: "2026-03-29", priority: "upcoming", status: "pending" },
      { id: "d", suggestedDate: "2026-03-30", priority: "informational", status: "pending" },
    ];
    const toCancel = enforceBudget(tasks, 2);
    // Keep a (urgent) and b (today). Cancel c (upcoming) and d (informational).
    expect(toCancel.map((t) => t.id)).toEqual(["c", "d"]);
  });

  it("breaks priority ties by suggestedDate ascending (sooner = keep)", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-30", priority: "upcoming", status: "pending" },
      { id: "b", suggestedDate: "2026-03-28", priority: "upcoming", status: "pending" },
      { id: "c", suggestedDate: "2026-03-29", priority: "upcoming", status: "pending" },
    ];
    const toCancel = enforceBudget(tasks, 2);
    // Keep b (Mar 28) and c (Mar 29). Cancel a (Mar 30).
    expect(toCancel.map((t) => t.id)).toEqual(["a"]);
  });

  it("returns empty array when exactly at budget", () => {
    const tasks: MockTask[] = [
      { id: "a", suggestedDate: "2026-03-28", priority: "today", status: "pending" },
    ];
    const toCancel = enforceBudget(tasks, 1);
    expect(toCancel).toEqual([]);
  });
});
