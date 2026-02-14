import { and, eq } from "drizzle-orm";
import { type DB } from "../db/index.js";
import { gardens, zones, plants } from "../db/schema.js";

/**
 * Validate that a garden belongs to the authenticated user.
 * Throws "Garden not found" if the garden doesn't exist or isn't owned by the user.
 */
export async function assertGardenOwnership(
  db: DB,
  gardenId: string,
  userId: string,
) {
  const garden = await db.query.gardens.findFirst({
    where: and(eq(gardens.id, gardenId), eq(gardens.userId, userId)),
  });
  if (!garden) throw new Error("Garden not found");
  return garden;
}

/**
 * Validate that a zone belongs to the authenticated user (via its parent garden).
 * Throws "Zone not found" if the zone doesn't exist or its garden isn't owned by the user.
 */
export async function assertZoneOwnership(
  db: DB,
  zoneId: string,
  userId: string,
) {
  const zone = await db.query.zones.findFirst({
    where: eq(zones.id, zoneId),
    with: { garden: true },
  });
  if (!zone || zone.garden.userId !== userId) {
    throw new Error("Zone not found");
  }
  return zone;
}

/**
 * Validate that a plant belongs to the authenticated user (via zone -> garden).
 * Throws "Plant not found" if the plant doesn't exist or its garden isn't owned by the user.
 */
export async function assertPlantOwnership(
  db: DB,
  plantId: string,
  userId: string,
) {
  const plant = await db.query.plants.findFirst({
    where: eq(plants.id, plantId),
    with: { zone: { with: { garden: true } } },
  });
  if (!plant || plant.zone.garden.userId !== userId) {
    throw new Error("Plant not found");
  }
  return plant;
}
