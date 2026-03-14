# Home Assistant Webhook Integration Design

## Goal

Replace the broken pull-based HA integration (assumes localhost access) with a webhook-push model where HA automations send sensor data to the Gardoo server on a fixed interval. Auto-discover sensors from incoming data and let users assign them to zones.

## Architecture

HA pushes sensor readings to a webhook endpoint on the Gardoo server every 15-30 minutes via a user-configured HA automation. The server stores readings in the existing `sensor_readings` table. New entity IDs are auto-discovered as unassigned sensors. Users assign sensors to zones in the settings UI. The AI analysis context builder already consumes sensor readings — no changes needed there.

## Feature 1: Webhook Endpoint

### Server

- **Route:** `POST /api/webhook/ha/:token` — raw Fastify route (not tRPC), since HA sends plain HTTP POST.
- **Auth:** The `:token` path parameter is a per-garden secret. The server looks up the garden by token, rejecting unknown tokens with 401.
- **Payload:** JSON array of entity states:
  ```json
  [
    { "entity_id": "sensor.soil_moisture_bed_1", "state": "42.5", "attributes": { "unit_of_measurement": "%" } },
    { "entity_id": "sensor.soil_temp_bed_1", "state": "18.3", "attributes": { "unit_of_measurement": "°C" } }
  ]
  ```
- **Processing per entity:**
  1. Find or create a `sensors` record matching `haEntityId` within the garden's zones (or unassigned).
  2. Parse numeric value from `state` string. Skip non-numeric states.
  3. Insert into `sensor_readings` with value, unit, and current timestamp.
  4. Update `sensors.lastReading` and `sensors.lastReadAt`.
- **Response:** `200 { received: N }` on success, `401` on bad token, `400` on malformed payload.

### Schema

Add to `gardens` table:

| Column | Type | Default |
|--------|------|---------|
| `webhook_token` | `text` | `null` |

Make `sensors.zoneId` nullable (currently `NOT NULL`). Unassigned sensors have `zoneId = NULL`.

### Sensor Type Inference

When auto-creating a sensor from a new entity ID, infer `sensorType` from the entity ID string:

| Pattern in entity ID | Sensor Type |
|---------------------|-------------|
| `soil_moisture`, `moisture` | Soil Moisture |
| `soil_temp`, `soil_temperature` | Soil Temperature |
| `temperature`, `temp` | Temperature |
| `light`, `lux`, `illuminance` | Light |
| anything else | Unknown |

Users can rename the sensor type after discovery.

## Feature 2: Settings UI

### Replace haUrl/haToken with Webhook Setup

- **"Connect Home Assistant" section:**
  - "Generate Webhook URL" button — calls a new `gardens.generateWebhookToken` mutation that creates a `crypto.randomUUID()` token and stores it on the garden.
  - Once generated, display:
    - The full webhook URL (with copy button): `https://gardoo-server.onrender.com/api/webhook/ha/<token>`
    - A YAML snippet for the user's HA `automations.yaml` (with copy button). The snippet includes placeholder entity IDs the user edits to match their sensors.
    - Brief instructions: "Edit the entity IDs, paste into your HA config, restart HA."
  - "Regenerate Token" button — generates a new token (invalidates old one).

### Unassigned Sensors

- Section appears when there are sensors with `zoneId = NULL` for this garden.
- Each unassigned sensor shows: entity ID, sensor type (editable), last reading value, and a zone dropdown.
- Selecting a zone calls `sensors.update` to set the `zoneId`.

### HA YAML Template

```yaml
rest_command:
  gardoo_push:
    url: "https://gardoo-server.onrender.com/api/webhook/ha/YOUR_TOKEN"
    method: POST
    content_type: "application/json"
    payload: >
      [
        {"entity_id": "sensor.soil_moisture_bed_1", "state": "{{ states('sensor.soil_moisture_bed_1') }}", "attributes": {"unit_of_measurement": "{{ state_attr('sensor.soil_moisture_bed_1', 'unit_of_measurement') }}"}},
        {"entity_id": "sensor.soil_temp_bed_1", "state": "{{ states('sensor.soil_temp_bed_1') }}", "attributes": {"unit_of_measurement": "{{ state_attr('sensor.soil_temp_bed_1', 'unit_of_measurement') }}"}}
      ]

automation:
  - alias: "Gardoo Sensor Push"
    trigger:
      - platform: time_pattern
        minutes: "/15"
    action:
      - service: rest_command.gardoo_push
```

## Feature 3: Cleanup & Deprecation

### Remove

- `haUrl` and `haToken` from `UserSettings` interface and settings UI.
- `sensors.read` and `sensors.readAll` mutations (data arrives via webhook).
- `fetchSensorState()` and `fetchWeatherFromHA()` from `lib/homeassistant.ts`.
- Manual "Read" button on sensor cards in zone detail UI.

### Keep

- `sensors` and `sensor_readings` tables.
- `sensors.list`, `sensors.create`, `sensors.delete`, `sensors.getReadings` endpoints.
- Context builder sensor integration (add filter: skip `zoneId IS NULL`).
- AI prompt `## Sensor readings` section.
- Sensor display cards on zone detail page.

### Add

- **Reading retention cleanup:** Delete `sensor_readings` older than 30 days. Run as part of the daily analysis trigger job.

## Feature 4: Context Builder Filter

The context builder (`contextBuilder.ts`) currently fetches all sensors for a zone. Since `zoneId` is now nullable, add a filter to exclude unassigned sensors. This is already implicit (query filters by `sensors.zoneId = zoneId`), but verify it handles the NULL case correctly.

## Out of Scope

- Sensor threshold alerts (trigger analysis when values cross limits)
- Historical sensor charts in the UI
- HA entity discovery via HA API
- Two-way HA communication (sending commands back to HA)
- Sensor data in the weather/watering guidance UI
