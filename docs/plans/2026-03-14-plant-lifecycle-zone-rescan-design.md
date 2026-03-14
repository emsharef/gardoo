# Plant Lifecycle & Zone Re-scan Design

## Goal

Enable plant retirement (harvested, died, removed, relocated) that preserves history, and zone photo re-scanning to detect bulk changes (new plants, removed plants, growth stage updates).

## Feature 1: Plant Retirement

### Schema

Add three columns to the `plants` table:

| Column | Type | Default |
|--------|------|---------|
| `status` | `text` | `'active'` |
| `retired_at` | `timestamp` | `null` |
| `retired_reason` | `text` | `null` |

`status`: `'active'` or `'retired'`.
`retired_reason`: `harvested`, `died`, `removed`, or `relocated`.

### Server

- **`plants.retire`** mutation: `{ id, reason }` — sets status to retired, records reason and timestamp. Auto-creates a care log entry (`actionType: 'other'`, notes: "Plant retired: [reason]").
- **Existing queries** (zone detail, plant list) filter to `status = 'active'` by default.
- **`plants.listRetired`** query: returns retired plants for a zone, ordered by `retiredAt` desc.
- **`plants.delete`** stays as hard delete — works on both active and retired plants.
- **AI context builder** filters out retired plants so analysis doesn't generate tasks for them.
- **Tasks** for retired plants: cancel any pending tasks when a plant is retired.

### Web UI

- **Plant detail page**: "Retire" button alongside existing "Delete" button. Opens a modal with four reason choices (Harvested, Died, Removed, Relocated). Confirms and navigates back to zone.
- **Zone detail page**: new "History" tab. Shows retired plants with reason badge, retirement date, and link to view full care log/photo history (read-only).

## Feature 2: Zone Re-scan

### Server

- **`zones.rescan`** mutation: `{ zoneId, imageBase64, mediaType }`.
  - Fetches the zone's current active plants (name, variety, growth stage, id).
  - Builds an AI prompt including the current plant list and the new photo.
  - AI returns structured JSON diff:
    ```json
    {
      "newPlants": [{ "name": "...", "variety": "..." }],
      "missingPlants": [{ "plantId": "...", "name": "...", "suggestedReason": "..." }],
      "growthUpdates": [{ "plantId": "...", "name": "...", "currentStage": "...", "newStage": "..." }]
    }
    ```
  - Returns the diff to the client without applying any changes.

- **`zones.applyRescan`** mutation: `{ zoneId, photoUrl?, newPlants, retirePlants, growthUpdates }`.
  - Creates new plants from `newPlants` array.
  - Retires plants from `retirePlants` array (calls retire logic with provided reason).
  - Updates growth stages from `growthUpdates` array.
  - Optionally updates the zone photo to the new scan photo.
  - All changes in a single transaction.

### AI Prompt Design

The rescan prompt includes the current plant inventory so the AI can match identified plants to existing records. Key instruction: return `plantId` for matches so the server can reliably apply updates. Plants the AI sees but aren't in the list go into `newPlants`. Plants in the list but not visible go into `missingPlants`.

### Web UI

- **Zone detail page**: "Re-scan Zone" button (camera icon) in the Plants tab header area.
- Click opens a photo upload flow.
- Loading state while AI analyzes.
- Results as a diff review:
  - **New plants** (green badges): checkboxes, pre-checked.
  - **Missing plants** (amber badges): checkboxes, pre-checked, with retirement reason dropdown (AI suggests default).
  - **Growth updates** (blue badges): checkboxes showing "Plant: Stage A → Stage B".
- "Apply Changes" button sends confirmed changes to `zones.applyRescan`.
- "Cancel" discards the diff.

## Out of Scope

- Plant relocation tracking (linking retired plant to new location)
- Before/after photo comparison UI
- Automatic scheduled re-scans
- Un-retiring a plant (can be added later if needed)
