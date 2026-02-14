import { describe, it, expect } from "vitest";
import { createTestCaller } from "../../test-utils.js";

describe("gardens router", () => {
  // These tests require a running Postgres database.
  // They verify the router compiles correctly and demonstrate expected usage.

  const TEST_USER_ID = "00000000-0000-4000-a000-000000000001";
  const OTHER_USER_ID = "00000000-0000-4000-a000-000000000002";

  it("should create a garden and return it", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({
      name: "My Backyard",
      locationLat: 37.7749,
      locationLng: -122.4194,
      hardinessZone: "10a",
    });

    expect(garden.name).toBe("My Backyard");
    expect(garden.locationLat).toBeCloseTo(37.7749, 2);
    expect(garden.locationLng).toBeCloseTo(-122.4194, 2);
    expect(garden.hardinessZone).toBe("10a");
    expect(garden.id).toBeDefined();
    expect(garden.userId).toBe(TEST_USER_ID);
  });

  it("should list only the authenticated user's gardens", async () => {
    const caller1 = createTestCaller(TEST_USER_ID);
    const caller2 = createTestCaller(OTHER_USER_ID);

    await caller1.gardens.create({ name: "User1 Garden" });
    await caller2.gardens.create({ name: "User2 Garden" });

    const user1Gardens = await caller1.gardens.list();
    const user2Gardens = await caller2.gardens.list();

    expect(user1Gardens.every((g) => g.userId === TEST_USER_ID)).toBe(true);
    expect(user2Gardens.every((g) => g.userId === OTHER_USER_ID)).toBe(true);
  });

  it("should update a garden and return the updated version", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "Original Name" });
    const updated = await caller.gardens.update({
      id: garden.id,
      name: "Updated Name",
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.id).toBe(garden.id);
  });

  it("should delete a garden", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "To Delete" });
    const result = await caller.gardens.delete({ id: garden.id });

    expect(result.success).toBe(true);

    await expect(caller.gardens.get({ id: garden.id })).rejects.toThrow(
      "Garden not found",
    );
  });

  it("should throw when updating another user's garden", async () => {
    const caller1 = createTestCaller(TEST_USER_ID);
    const caller2 = createTestCaller(OTHER_USER_ID);

    const garden = await caller1.gardens.create({ name: "User1 Garden" });

    await expect(
      caller2.gardens.update({ id: garden.id, name: "Hacked" }),
    ).rejects.toThrow("Garden not found");
  });

  it("should throw when getting another user's garden", async () => {
    const caller1 = createTestCaller(TEST_USER_ID);
    const caller2 = createTestCaller(OTHER_USER_ID);

    const garden = await caller1.gardens.create({ name: "User1 Garden" });

    await expect(caller2.gardens.get({ id: garden.id })).rejects.toThrow(
      "Garden not found",
    );
  });

  it("should require authentication", async () => {
    const caller = createTestCaller(); // no userId

    await expect(caller.gardens.list()).rejects.toThrow("Unauthorized");
  });
});
