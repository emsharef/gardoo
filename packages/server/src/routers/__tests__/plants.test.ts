import { describe, it, expect } from "vitest";
import { createTestCaller } from "../../test-utils.js";

describe("plants router", () => {
  // These tests require a running Postgres database.

  const TEST_USER_ID = "00000000-0000-4000-a000-000000000001";
  const OTHER_USER_ID = "00000000-0000-4000-a000-000000000002";

  it("should create a plant in an owned zone", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Herb Bed",
    });
    const plant = await caller.plants.create({
      zoneId: zone.id,
      name: "Basil",
      variety: "Sweet Basil",
      species: "Ocimum basilicum",
      growthStage: "seedling",
    });

    expect(plant.name).toBe("Basil");
    expect(plant.variety).toBe("Sweet Basil");
    expect(plant.zoneId).toBe(zone.id);
  });

  it("should reject creating a plant in another user's zone", async () => {
    const caller1 = createTestCaller(TEST_USER_ID);
    const caller2 = createTestCaller(OTHER_USER_ID);

    const garden = await caller1.gardens.create({ name: "User1 Garden" });
    const zone = await caller1.zones.create({
      gardenId: garden.id,
      name: "User1 Zone",
    });

    await expect(
      caller2.plants.create({
        zoneId: zone.id,
        name: "Sneaky Plant",
      }),
    ).rejects.toThrow("Zone not found");
  });

  it("should list plants for an owned zone", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Veggie Bed",
    });
    await caller.plants.create({ zoneId: zone.id, name: "Tomato" });
    await caller.plants.create({ zoneId: zone.id, name: "Pepper" });

    const plantsList = await caller.plants.list({ zoneId: zone.id });

    expect(plantsList.length).toBeGreaterThanOrEqual(2);
    expect(plantsList.some((p) => p.name === "Tomato")).toBe(true);
    expect(plantsList.some((p) => p.name === "Pepper")).toBe(true);
  });

  it("should update a plant in an owned zone", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Zone",
    });
    const plant = await caller.plants.create({
      zoneId: zone.id,
      name: "Tomato",
    });

    const updated = await caller.plants.update({
      id: plant.id,
      name: "Cherry Tomato",
      growthStage: "fruiting",
    });

    expect(updated.name).toBe("Cherry Tomato");
    expect(updated.growthStage).toBe("fruiting");
  });

  it("should delete a plant in an owned zone", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Zone",
    });
    const plant = await caller.plants.create({
      zoneId: zone.id,
      name: "To Delete",
    });

    const result = await caller.plants.delete({ id: plant.id });
    expect(result.success).toBe(true);
  });

  it("should create a plant with care profile", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const garden = await caller.gardens.create({ name: "Test Garden" });
    const zone = await caller.zones.create({
      gardenId: garden.id,
      name: "Zone",
    });
    const plant = await caller.plants.create({
      zoneId: zone.id,
      name: "Tomato",
      careProfile: {
        waterFrequencyDays: 2,
        sunNeeds: "full-sun",
        fertilizerNotes: "Every 2 weeks",
      },
    });

    expect(plant.careProfile).toBeDefined();
  });
});
