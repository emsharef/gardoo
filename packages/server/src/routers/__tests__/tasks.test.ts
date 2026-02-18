import { describe, it, expect } from "vitest";
import { createTestCaller } from "../../test-utils.js";
import { db } from "../../db/index.js";
import { tasks } from "../../db/schema.js";

describe("tasks router", () => {
  // Use real user IDs from the database (testuser2@gardoo.app and test2@test.com)
  const TEST_USER_ID = "64634a2c-0931-42f9-8b55-a51e610c325b";
  const OTHER_USER_ID = "c9c4a0a7-ee55-4a1f-af32-8bf1c806702f";

  async function createTestTask(gardenId: string, zoneId: string) {
    const [task] = await db
      .insert(tasks)
      .values({
        gardenId,
        zoneId,
        targetType: "zone",
        targetId: zoneId,
        actionType: "water",
        priority: "today",
        status: "pending",
        label: "Water the bed",
        suggestedDate: "2026-02-18",
      })
      .returning();
    return task;
  }

  it("should complete a task and create a care log", async () => {
    const caller = createTestCaller(TEST_USER_ID);
    const garden = await caller.gardens.create({ name: "Task Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Test Bed",
    });
    const task = await createTestTask(garden.id, zone.id);

    const result = await caller.tasks.complete({
      taskId: task.id,
      notes: "Done watering",
    });

    expect(result.task.status).toBe("completed");
    expect(result.task.completedVia).toBe("user");
    expect(result.careLog).toBeDefined();
    expect(result.careLog.actionType).toBe("water");
  });

  it("should snooze a task to a new date", async () => {
    const caller = createTestCaller(TEST_USER_ID);
    const garden = await caller.gardens.create({ name: "Snooze Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Snooze Bed",
    });
    const task = await createTestTask(garden.id, zone.id);

    const result = await caller.tasks.snooze({
      taskId: task.id,
      newDate: "2026-02-25",
    });

    expect(result.suggestedDate).toBe("2026-02-25");
    expect(result.status).toBe("pending");
  });

  it("should dismiss a task", async () => {
    const caller = createTestCaller(TEST_USER_ID);
    const garden = await caller.gardens.create({
      name: "Dismiss Test Garden",
    });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Dismiss Bed",
    });
    const task = await createTestTask(garden.id, zone.id);

    const result = await caller.tasks.dismiss({ taskId: task.id });

    expect(result.status).toBe("cancelled");
  });

  it("should throw when completing another user's task", async () => {
    const caller1 = createTestCaller(TEST_USER_ID);
    const caller2 = createTestCaller(OTHER_USER_ID);
    const garden = await caller1.gardens.create({ name: "Owned Garden" });
    const zone = await caller1.zones.create({
      gardenId: garden.id,
      name: "Owned Bed",
    });
    const task = await createTestTask(garden.id, zone.id);

    await expect(
      caller2.tasks.complete({ taskId: task.id }),
    ).rejects.toThrow();
  });

  it("should throw when completing an already completed task", async () => {
    const caller = createTestCaller(TEST_USER_ID);
    const garden = await caller.gardens.create({
      name: "Double Complete Garden",
    });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Double Bed",
    });
    const task = await createTestTask(garden.id, zone.id);

    await caller.tasks.complete({ taskId: task.id });
    await expect(
      caller.tasks.complete({ taskId: task.id }),
    ).rejects.toThrow();
  });
});
