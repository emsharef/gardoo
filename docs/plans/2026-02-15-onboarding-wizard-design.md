# Onboarding Wizard Design

## Problem

After login, new users land on an empty home page with "No garden found. Create one in settings." They must manually navigate to Settings to create a garden (entering raw lat/lng), then Garden to add zones via a basic form, then back to Settings to add an API key. This scattered, high-friction flow loses users immediately.

## Solution

A dedicated multi-step onboarding wizard at `/onboarding` that collects garden basics, AI API key, and optionally zone inventory with photo-based plant identification. The wizard renders outside the normal AppShell (no sidebar/nav) and redirects to the home page on completion.

## Flow

```
Welcome → Location → AI Setup → Add Zones → All Set
   1          2          3           4          5
```

Steps 1-3 are required. Step 4 (zones) is skippable. Step 5 is a summary.

## Routing & State

- **Route:** `/onboarding` — renders outside AppShell (no sidebar, no nav)
- **Trigger:** After login, if the user has no garden, redirect to `/onboarding`
- **Progress indicator:** Horizontal step bar at the top showing all 5 steps. Current step highlighted, completed steps show checkmarks.
- **Back navigation:** Users can go back to edit previous steps. Forward requires completing the current step.
- **State:** Single React state object (or useReducer) holds all wizard data. Server calls happen per-step: garden created after step 2, API key stored after step 3, zones/plants created during step 4.
- **After completion:** Redirect to `/` (home). The existing AppShell "no garden" check becomes a redirect to `/onboarding`.

## Step Designs

### Step 1: Welcome

Centered content, no inputs.

- Gardoo logo/wordmark
- Headline: "Let's set up your garden"
- Subtitle: "We'll get your garden inventory and AI assistant configured in a few minutes."
- "Get Started" button

### Step 2: Location

- **Garden name** — text input, pre-filled "My Garden", editable
- **Location** — two paths:
  - Primary: "Use my location" button → browser geolocation → resolves to city/state display, stores lat/lng
  - Fallback: "Or enter your city or zip code" text input → geocode to coordinates (Open-Meteo geocoding API)
- **Hardiness zone** — auto-derived from coordinates, shown as read-only chip ("Zone 7b") with "Edit" link. Falls back to text input if derivation fails.
- **Validation:** Name + location required. "Next" disabled until provided.
- **On "Next":** `trpc.gardens.create` with name, lat, lng, hardiness zone. Store garden ID in wizard state.

### Step 3: AI Setup

- Headline: "Connect your AI assistant"
- Brief explanation of why an API key is needed
- **Provider toggle** — two selectable cards: Claude (default) and Kimi
- **API key input** — password field with show/hide toggle
- **Validate button** — lightweight test call to verify key works. Green checkmark on success, error message on failure.
- Links to provider signup pages for getting API keys
- **On "Next":** `trpc.apiKeys.store`. Only enabled after successful validation.

### Step 4: Add Zones (skippable)

Has sub-states:

**4a: Zone template grid**
- Headline: "What's in your garden?"
- 8 template cards in a responsive grid. Each card: icon + name.
- Templates:
  - Raised Bed (asks for dimensions)
  - In-Ground Bed / Plot
  - Container / Pots (asks for count)
  - Indoor / Windowsill
  - Greenhouse
  - Orchard / Fruit Trees
  - Herb Garden
  - Lawn / Ground Cover
- Tapping a card → advances to 4b
- "Skip for now" link below the grid

**4b: Zone details form**
- Back arrow to template grid
- Template type shown as badge
- **Name** — pre-filled from template (e.g., "Raised Bed 1"), editable
- **Conditional fields:**
  - Raised bed: dimensions (length x width)
  - Container/pots: approximate count
- **Soil type** — dropdown: Garden soil, Potting mix, Clay, Sandy, Amended/compost, Unknown
- **Sun exposure** — dropdown: Full sun (6+ hrs), Partial sun (3-6 hrs), Shade (< 3 hrs)
- **Photo upload** — large dropzone. Drag-and-drop or click-to-browse. Optional.
- "Next" button

**4c: Plant list (always shown)**
- If photo was uploaded: shows thumbnail + "Analyzing your photo..." spinner → AI returns suggested plants as editable checklist
- If no photo: shows empty plant list
- Each plant row: name + variety (editable), delete button
- "Add a plant" button to manually add
- "Confirm" button (works with zero plants — user can add later)
- **AI call:** Uses the API key from step 3. Sends photo + zone context (type, name) to identify visible plants. Returns name + variety suggestions.

**4d: Zone confirmed**
- "Raised Bed 1 added with 4 plants" (or "with no plants")
- Two buttons: "Add another zone" (→ 4a) and "Finish setup" (→ step 5)

### Step 5: All Set

- Headline: "Your garden is ready!"
- Summary: garden name/location, zone count, plant count, AI provider connected
- "Go to your garden" button → navigates to `/`

## Server Requirements

### New endpoint needed

- **Plant identification from photo** — a new tRPC mutation (or extension of the chat router) that accepts a base64 image + zone context and returns an array of `{ name: string, variety?: string }`. Uses the user's stored API key. This is a simpler, more constrained call than the full chat — just plant identification.

### Geocoding

- Use Open-Meteo's geocoding API (`https://geocoding-api.open-meteo.com/v1/search`) to resolve city/zip to lat/lng. Free, no key required. Can be called client-side.

### Hardiness zone derivation

- Use lat/lng to look up USDA hardiness zone. Can use the USDA Plant Hardiness Zone API or a static lookup table. Could also let the AI provider derive it from coordinates as part of the initial garden context.

### API key validation

- A new tRPC mutation that takes provider + key and makes a minimal API call (e.g., a short prompt to Claude/Kimi) to verify the key works. Returns success/failure.

## Existing API endpoints used

- `trpc.gardens.create` — step 2
- `trpc.apiKeys.store` — step 3
- `trpc.zones.create` — step 4
- `trpc.plants.create` — step 4c (called per plant after confirmation)
