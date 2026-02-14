import { describe, it, expect } from "vitest";
import { createTestCaller } from "../../test-utils.js";

describe("zones router", () => {
  // These tests require a running Postgres database.

  const TEST_USER_ID = "00000000-0000-4000-a000-000000000001";
  const OTHER_USER_ID = "00000000-0000-4000-a000-000000000002";

  it("should create a zone in an owned garden", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Raised Bed #1",
      soilType: "loam",
      sunExposure: "full-sun",
    });

    expect(zone.name).toBe("Raised Bed #1");
    expect(zone.gardenId).toBe(garden.id);
    expect(zone.soilType).toBe("loam");
  });

  it("should reject creating a zone in another user's garden", async () => {
    const caller1 = createTestCaller(TEST_USER_ID);
    const caller2 = createTestCaller(OTHER_USER_ID);

    const garden = await caller1.gardens.create({ name: "User1 Garden" });

    await expect(
      caller2.zones.create({
        gardenId: garden.id,
        name: "Sneaky Zone",
      }),
    ).rejects.toThrow("Garden not found");
  });

  it("should list zones for an owned garden", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "Test Garden" });
    await caller.zones.create({ gardenId: garden.id, name: "Zone A" });
    await caller.zones.create({ gardenId: garden.id, name: "Zone B" });

    const zonesList = await caller.zones.list({ gardenId: garden.id });

    expect(zonesList.length).toBeGreaterThanOrEqual(2);
    expect(zonesList.some((z) => z.name === "Zone A")).toBe(true);
    expect(zonesList.some((z) => z.name === "Zone B")).toBe(true);
  });

  it("should reject listing zones in another user's garden", async () => {
    const caller1 = createTestCaller(TEST_USER_ID);
    const caller2 = createTestCaller(OTHER_USER_ID);

    const garden = await caller1.gardens.create({ name: "User1 Garden" });

    await expect(
      caller2.zones.list({ gardenId: garden.id }),
    ).rejects.toThrow("Garden not found");
  });

  it("should update a zone in an owned garden", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Original",
    });

    const updated = await caller.zones.update({
      id: zone.id,
      name: "Renamed Zone",
    });

    expect(updated.name).toBe("Renamed Zone");
  });

  it("should delete a zone in an owned garden", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "To Delete",
    });

    const result = await caller.zones.delete({ id: zone.id });
    expect(result.success).toBe(true);
  });
});
