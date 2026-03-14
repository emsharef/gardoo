import { db } from "@gardoo/server/src/db/index";
import { gardens, sensors, sensorReadings } from "@gardoo/server/src/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";

const payloadSchema = z.array(
  z.object({
    entity_id: z.string(),
    state: z.string(),
    attributes: z.object({
      unit_of_measurement: z.string().optional(),
    }).passthrough().optional(),
  }),
);

const SENSOR_TYPE_PATTERNS: [RegExp, string][] = [
  [/soil_moisture|moisture/, "Soil Moisture"],
  [/soil_temp|soil_temperature/, "Soil Temperature"],
  [/temperature|temp/, "Temperature"],
  [/light|lux|illuminance/, "Light"],
];

function inferSensorType(entityId: string): string {
  for (const [pattern, type] of SENSOR_TYPE_PATTERNS) {
    if (pattern.test(entityId)) return type;
  }
  return "Unknown";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Look up garden by webhook token
  const garden = await db.query.gardens.findFirst({
    where: eq(gardens.webhookToken, token),
  });

  if (!garden) {
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }

  // 2. Parse and validate payload
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  // 3. Process each entity
  let received = 0;

  for (const entity of parsed.data) {
    const numericValue = parseFloat(entity.state);
    if (isNaN(numericValue)) continue;

    const unit = entity.attributes?.unit_of_measurement ?? "";

    // Find or create sensor for this entity
    let sensor = await db.query.sensors.findFirst({
      where: and(
        eq(sensors.haEntityId, entity.entity_id),
        eq(sensors.gardenId, garden.id),
      ),
    });

    if (!sensor) {
      const [created] = await db
        .insert(sensors)
        .values({
          gardenId: garden.id,
          haEntityId: entity.entity_id,
          sensorType: inferSensorType(entity.entity_id),
        })
        .returning();
      sensor = created;
    }

    // Insert reading
    await db.insert(sensorReadings).values({
      sensorId: sensor.id,
      value: numericValue,
      unit,
    });

    // Update last reading on sensor
    await db
      .update(sensors)
      .set({
        lastReading: { value: numericValue, unit },
        lastReadAt: new Date(),
      })
      .where(eq(sensors.id, sensor.id));

    received++;
  }

  return Response.json({ received });
}
