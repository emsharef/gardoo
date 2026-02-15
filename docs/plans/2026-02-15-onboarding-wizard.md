# Onboarding Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a multi-step onboarding wizard that guides first-time users through garden setup, AI API key configuration, and zone creation with photo-based plant identification.

**Architecture:** A dedicated `/onboarding` route that renders outside the normal AppShell. Five steps: Welcome, Location, AI Setup, Add Zones, All Set. State managed with useReducer. Server calls at each step boundary. New server endpoints for API key validation and photo-based plant identification.

**Tech Stack:** Next.js App Router, Tailwind CSS, tRPC mutations, Anthropic/OpenAI SDK (for plant ID), Open-Meteo Geocoding API (client-side), Browser Geolocation API

---

## Task 1: API Key Validation Endpoint

Add a server endpoint that tests whether a provided API key actually works.

**Files:**
- Modify: `packages/server/src/routers/apiKeys.ts`

**Step 1: Add validate mutation to apiKeys router**

Add this to the existing `apiKeysRouter` in `packages/server/src/routers/apiKeys.ts`:

```typescript
validate: protectedProcedure
  .input(
    z.object({
      provider: z.enum(["claude", "kimi"]),
      key: z.string().min(1),
    }),
  )
  .mutation(async ({ input }) => {
    try {
      if (input.provider === "claude") {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey: input.key });
        await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 10,
          messages: [{ role: "user", content: "Say hi" }],
        });
      } else {
        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({
          apiKey: input.key,
          baseURL: "https://api.moonshot.cn/v1",
        });
        await client.chat.completions.create({
          model: "moonshot-v1-8k",
          max_tokens: 10,
          messages: [{ role: "user", content: "Say hi" }],
        });
      }
      return { valid: true as const };
    } catch {
      return { valid: false as const };
    }
  }),
```

**Step 2: Verify server compiles**

Run: `pnpm --filter @gardoo/server typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/server/src/routers/apiKeys.ts
git commit -m "feat: add API key validation endpoint"
```

---

## Task 2: Plant Identification Endpoint

Add a server endpoint that accepts a base64 photo and returns identified plants as structured JSON.

**Files:**
- Modify: `packages/server/src/routers/plants.ts`

**Step 1: Add identify mutation to plants router**

Add this to the existing `plantsRouter` in `packages/server/src/routers/plants.ts`:

```typescript
identify: protectedProcedure
  .input(
    z.object({
      imageBase64: z.string(),
      zoneType: z.string().optional(),
      zoneName: z.string().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // Try Claude first, then Kimi
    const { getApiKey } = await import("../lib/getApiKey.js");
    let apiKey = await getApiKey(ctx.db, ctx.userId, "claude");
    let provider: "claude" | "kimi" = "claude";

    if (!apiKey) {
      apiKey = await getApiKey(ctx.db, ctx.userId, "kimi");
      provider = "kimi";
    }

    if (!apiKey) {
      throw new Error("No AI API key configured");
    }

    const systemPrompt = [
      "You are a plant identification expert.",
      "Analyze the photo and identify all visible plants.",
      "Return ONLY a JSON array of objects with these fields:",
      '  - "name": common plant name (string, required)',
      '  - "variety": specific variety if identifiable (string, optional)',
      "If no plants are visible, return an empty array: []",
      "Do not include any text outside the JSON array.",
      input.zoneType ? `Context: this is a ${input.zoneType} zone called "${input.zoneName ?? "unnamed"}".` : "",
    ].filter(Boolean).join("\n");

    if (provider === "claude") {
      const { ClaudeProvider } = await import("../ai/claude.js");
      const claude = new ClaudeProvider();
      const response = await claude.chat(
        [{ role: "user", content: "Identify the plants in this photo." }],
        systemPrompt,
        apiKey,
        input.imageBase64,
      );

      const jsonStr = response.content.replace(/```(?:json)?\s*([\s\S]*?)```/, "$1").trim();
      const parsed = JSON.parse(jsonStr);
      const plants = z.array(z.object({
        name: z.string(),
        variety: z.string().optional(),
      })).parse(parsed);

      return { plants };
    } else {
      const { KimiProvider } = await import("../ai/kimi.js");
      const kimi = new KimiProvider();
      const response = await kimi.chat(
        [{ role: "user", content: "Identify the plants in this photo." }],
        systemPrompt,
        apiKey,
        input.imageBase64,
      );

      const jsonStr = response.content.replace(/```(?:json)?\s*([\s\S]*?)```/, "$1").trim();
      const parsed = JSON.parse(jsonStr);
      const plants = z.array(z.object({
        name: z.string(),
        variety: z.string().optional(),
      })).parse(parsed);

      return { plants };
    }
  }),
```

**Step 2: Add the z import if not already present**

The file already imports `z` from zod. Verify it's there.

**Step 3: Verify server compiles**

Run: `pnpm --filter @gardoo/server typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/server/src/routers/plants.ts
git commit -m "feat: add photo-based plant identification endpoint"
```

---

## Task 3: Bypass AppShell for Onboarding Route

Make the `/onboarding` route render without sidebar/navigation.

**Files:**
- Modify: `packages/web/src/components/AppShell.tsx`

**Step 1: Add onboarding path check**

In `AppShell.tsx`, find the line:

```typescript
const isLoginPage = pathname === "/login";
```

Change the early-return condition to also cover onboarding:

```typescript
const isLoginPage = pathname === "/login";
const isOnboardingPage = pathname === "/onboarding";

if (!isAuthenticated || isLoginPage || isOnboardingPage) {
  return <>{children}</>;
}
```

**Step 2: Verify web builds**

Run: `pnpm --filter @gardoo/web build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/web/src/components/AppShell.tsx
git commit -m "feat: bypass AppShell for onboarding route"
```

---

## Task 4: Onboarding Wizard — Shell and Navigation

Create the onboarding page with step progress bar and navigation state.

**Files:**
- Create: `packages/web/src/app/onboarding/page.tsx`

**Step 1: Create the wizard shell**

```typescript
"use client";

import { useReducer, useCallback } from "react";
import { useRouter } from "next/navigation";

// -- Types ------------------------------------------------------------------

interface PlantEntry {
  name: string;
  variety: string;
}

interface ZoneEntry {
  template: string;
  name: string;
  soilType: string;
  sunExposure: string;
  dimensions: string;
  count: string;
  photoBase64: string | null;
  plants: PlantEntry[];
}

interface WizardState {
  step: number;
  gardenName: string;
  locationMethod: "geo" | "search" | null;
  locationDisplay: string;
  lat: number | null;
  lng: number | null;
  hardinessZone: string;
  aiProvider: "claude" | "kimi";
  apiKey: string;
  apiKeyValid: boolean;
  gardenId: string | null;
  zones: ZoneEntry[];
  // Zone sub-step: "templates" | "details" | "plants" | "confirmed"
  zoneSubStep: "templates" | "details" | "plants" | "confirmed";
  currentZone: ZoneEntry | null;
  identifyingPlants: boolean;
}

type WizardAction =
  | { type: "SET_STEP"; step: number }
  | { type: "SET_FIELD"; field: keyof WizardState; value: unknown }
  | { type: "SET_GARDEN_ID"; id: string }
  | { type: "SET_LOCATION"; lat: number; lng: number; display: string }
  | { type: "START_ZONE"; template: string }
  | { type: "SET_CURRENT_ZONE"; field: keyof ZoneEntry; value: unknown }
  | { type: "SET_ZONE_PLANTS"; plants: PlantEntry[] }
  | { type: "CONFIRM_ZONE" }
  | { type: "RESET_ZONE_SUB_STEP" };

const STEPS = ["Welcome", "Location", "AI Setup", "Add Zones", "All Set"];

const ZONE_TEMPLATES = [
  { id: "raised-bed", label: "Raised Bed", icon: "🌱", hasDimensions: true },
  { id: "in-ground", label: "In-Ground Bed", icon: "🌾", hasDimensions: false },
  { id: "container", label: "Container / Pots", icon: "🪴", hasCount: true },
  { id: "indoor", label: "Indoor / Windowsill", icon: "🏠", hasDimensions: false },
  { id: "greenhouse", label: "Greenhouse", icon: "🏡", hasDimensions: false },
  { id: "orchard", label: "Orchard / Fruit Trees", icon: "🌳", hasDimensions: false },
  { id: "herb-garden", label: "Herb Garden", icon: "🌿", hasDimensions: false },
  { id: "lawn", label: "Lawn / Ground Cover", icon: "🏞️", hasDimensions: false },
];

const initialState: WizardState = {
  step: 0,
  gardenName: "My Garden",
  locationMethod: null,
  locationDisplay: "",
  lat: null,
  lng: null,
  hardinessZone: "",
  aiProvider: "claude",
  apiKey: "",
  apiKeyValid: false,
  gardenId: null,
  zones: [],
  zoneSubStep: "templates",
  currentZone: null,
  identifyingPlants: false,
};

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step };
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "SET_GARDEN_ID":
      return { ...state, gardenId: action.id };
    case "SET_LOCATION":
      return {
        ...state,
        lat: action.lat,
        lng: action.lng,
        locationDisplay: action.display,
      };
    case "START_ZONE": {
      const tpl = ZONE_TEMPLATES.find((t) => t.id === action.template)!;
      return {
        ...state,
        zoneSubStep: "details",
        currentZone: {
          template: action.template,
          name: tpl.label + (state.zones.length > 0 ? ` ${state.zones.length + 1}` : ""),
          soilType: "",
          sunExposure: "",
          dimensions: "",
          count: "",
          photoBase64: null,
          plants: [],
        },
      };
    }
    case "SET_CURRENT_ZONE":
      if (!state.currentZone) return state;
      return {
        ...state,
        currentZone: { ...state.currentZone, [action.field]: action.value },
      };
    case "SET_ZONE_PLANTS":
      if (!state.currentZone) return state;
      return {
        ...state,
        currentZone: { ...state.currentZone, plants: action.plants },
        identifyingPlants: false,
      };
    case "CONFIRM_ZONE":
      if (!state.currentZone) return state;
      return {
        ...state,
        zones: [...state.zones, state.currentZone],
        zoneSubStep: "confirmed",
      };
    case "RESET_ZONE_SUB_STEP":
      return { ...state, zoneSubStep: "templates", currentZone: null };
    default:
      return state;
  }
}

export default function OnboardingPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(wizardReducer, initialState);

  const goNext = useCallback(() => {
    dispatch({ type: "SET_STEP", step: state.step + 1 });
  }, [state.step]);

  const goBack = useCallback(() => {
    dispatch({ type: "SET_STEP", step: state.step - 1 });
  }, [state.step]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Progress bar */}
      {state.step > 0 && state.step < 4 && (
        <div className="border-b border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            {STEPS.slice(1, 4).map((label, i) => {
              const stepIndex = i + 1;
              const isActive = state.step === stepIndex;
              const isComplete = state.step > stepIndex;
              return (
                <div key={label} className="flex flex-1 items-center gap-2">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isComplete
                        ? "bg-[#2D7D46] text-white"
                        : isActive
                          ? "border-2 border-[#2D7D46] text-[#2D7D46]"
                          : "border-2 border-gray-300 text-gray-400"
                    }`}
                  >
                    {isComplete ? "✓" : stepIndex}
                  </div>
                  <span
                    className={`hidden text-sm sm:inline ${
                      isActive ? "font-medium text-gray-900" : "text-gray-500"
                    }`}
                  >
                    {label}
                  </span>
                  {i < 2 && (
                    <div
                      className={`mx-2 h-0.5 flex-1 ${
                        isComplete ? "bg-[#2D7D46]" : "bg-gray-200"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step content */}
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl">
          {state.step === 0 && <StepWelcome onNext={goNext} />}
          {state.step === 1 && (
            <StepLocation state={state} dispatch={dispatch} onNext={goNext} onBack={goBack} />
          )}
          {state.step === 2 && (
            <StepAISetup state={state} dispatch={dispatch} onNext={goNext} onBack={goBack} />
          )}
          {state.step === 3 && (
            <StepAddZones state={state} dispatch={dispatch} onNext={goNext} onBack={goBack} />
          )}
          {state.step === 4 && <StepAllSet state={state} onFinish={() => router.push("/")} />}
        </div>
      </div>
    </div>
  );
}

// Placeholder components — implemented in subsequent tasks
function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center">
      <h1 className="mb-2 text-3xl font-bold text-[#2D7D46]">Gardoo</h1>
      <h2 className="mb-3 text-xl font-semibold text-gray-900">Let&apos;s set up your garden</h2>
      <p className="mb-8 text-gray-500">
        We&apos;ll get your garden inventory and AI assistant configured in a few minutes.
      </p>
      <button
        onClick={onNext}
        className="rounded-lg bg-[#2D7D46] px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#246838]"
      >
        Get Started
      </button>
    </div>
  );
}

function StepLocation(props: { state: WizardState; dispatch: React.Dispatch<WizardAction>; onNext: () => void; onBack: () => void }) {
  return <div>Step 2: Location (TODO)</div>;
}

function StepAISetup(props: { state: WizardState; dispatch: React.Dispatch<WizardAction>; onNext: () => void; onBack: () => void }) {
  return <div>Step 3: AI Setup (TODO)</div>;
}

function StepAddZones(props: { state: WizardState; dispatch: React.Dispatch<WizardAction>; onNext: () => void; onBack: () => void }) {
  return <div>Step 4: Add Zones (TODO)</div>;
}

function StepAllSet(props: { state: WizardState; onFinish: () => void }) {
  return <div>Step 5: All Set (TODO)</div>;
}
```

**Step 2: Verify web builds**

Run: `pnpm --filter @gardoo/web build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/web/src/app/onboarding/page.tsx
git commit -m "feat: add onboarding wizard shell with step navigation"
```

---

## Task 5: Step 2 — Location

Implement the location step with browser geolocation, city/zip search, and hardiness zone derivation.

**Files:**
- Modify: `packages/web/src/app/onboarding/page.tsx` — replace `StepLocation` placeholder

**Step 1: Implement StepLocation component**

Replace the `StepLocation` placeholder with the full implementation. Key functionality:

- Garden name input (pre-filled "My Garden")
- "Use my location" button → `navigator.geolocation.getCurrentPosition()` → reverse geocode via Open-Meteo geocoding API to get city/state display
- "Or enter your city or zip code" input → forward geocode via `https://geocoding-api.open-meteo.com/v1/search?name={query}&count=1`
- Hardiness zone auto-derived from lat/lng (use a simple lookup: fetch from a hardiness zone API or use a rough lat-based estimate)
- Editable hardiness zone override
- Create garden on "Next" via `trpc.gardens.create`

```typescript
function StepLocation({
  state,
  dispatch,
  onNext,
  onBack,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
  onBack: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [geoLoading, setGeoLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState("");

  const createGarden = trpc.gardens.create.useMutation({
    onSuccess(data) {
      dispatch({ type: "SET_GARDEN_ID", id: data.id });
      onNext();
    },
  });

  const handleGeolocate = async () => {
    setGeoLoading(true);
    setError("");
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 }),
      );
      const { latitude, longitude } = pos.coords;

      // Reverse geocode via Open-Meteo
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${latitude.toFixed(2)},${longitude.toFixed(2)}&count=1`,
      );
      let display = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
      try {
        const data = await res.json();
        if (data.results?.[0]) {
          const r = data.results[0];
          display = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
        }
      } catch {
        // Fallback to coords display
      }

      dispatch({ type: "SET_LOCATION", lat: latitude, lng: longitude, display });
      // Rough hardiness zone from latitude (US approximation)
      dispatch({ type: "SET_FIELD", field: "hardinessZone", value: estimateHardinessZone(latitude) });
    } catch {
      setError("Could not get your location. Try searching instead.");
    } finally {
      setGeoLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setError("");
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchQuery)}&count=1`,
      );
      const data = await res.json();
      if (!data.results?.length) {
        setError("No results found. Try a different search.");
        return;
      }
      const r = data.results[0];
      const display = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
      dispatch({ type: "SET_LOCATION", lat: r.latitude, lng: r.longitude, display });
      dispatch({ type: "SET_FIELD", field: "hardinessZone", value: estimateHardinessZone(r.latitude) });
    } catch {
      setError("Search failed. Please try again.");
    } finally {
      setSearchLoading(false);
    }
  };

  const canProceed = state.gardenName.trim() && state.lat !== null;

  return (
    <div className="space-y-6">
      <div>
        <button onClick={onBack} className="mb-4 text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </button>
        <h2 className="text-xl font-semibold text-gray-900">Where is your garden?</h2>
        <p className="mt-1 text-sm text-gray-500">
          We use your location for weather data and seasonal recommendations.
        </p>
      </div>

      {/* Garden name */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Garden name</label>
        <input
          value={state.gardenName}
          onChange={(e) => dispatch({ type: "SET_FIELD", field: "gardenName", value: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
        />
      </div>

      {/* Location */}
      {state.locationDisplay ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">{state.locationDisplay}</p>
              {state.hardinessZone && (
                <p className="text-sm text-gray-500">Hardiness Zone {state.hardinessZone}</p>
              )}
            </div>
            <button
              onClick={() => {
                dispatch({ type: "SET_LOCATION", lat: 0, lng: 0, display: "" });
                dispatch({ type: "SET_FIELD", field: "lat", value: null });
                dispatch({ type: "SET_FIELD", field: "lng", value: null });
              }}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Change
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={handleGeolocate}
            disabled={geoLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:border-[#2D7D46] hover:text-[#2D7D46] disabled:opacity-50"
          >
            {geoLoading ? "Detecting location..." : "📍 Use my location"}
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <div className="flex gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Enter city or zip code"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
            <button
              onClick={handleSearch}
              disabled={searchLoading || !searchQuery.trim()}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
            >
              {searchLoading ? "..." : "Search"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={() => {
          createGarden.mutate({
            name: state.gardenName.trim(),
            locationLat: state.lat ?? undefined,
            locationLng: state.lng ?? undefined,
            hardinessZone: state.hardinessZone || undefined,
          });
        }}
        disabled={!canProceed || createGarden.isPending}
        className="w-full rounded-lg bg-[#2D7D46] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
      >
        {createGarden.isPending ? "Creating garden..." : "Next"}
      </button>
    </div>
  );
}

function estimateHardinessZone(lat: number): string {
  // Rough US/global estimate based on latitude
  const absLat = Math.abs(lat);
  if (absLat < 10) return "13a";
  if (absLat < 15) return "12b";
  if (absLat < 20) return "11a";
  if (absLat < 25) return "10b";
  if (absLat < 28) return "10a";
  if (absLat < 31) return "9b";
  if (absLat < 33) return "9a";
  if (absLat < 35) return "8b";
  if (absLat < 37) return "8a";
  if (absLat < 39) return "7b";
  if (absLat < 41) return "7a";
  if (absLat < 43) return "6b";
  if (absLat < 45) return "6a";
  if (absLat < 47) return "5b";
  if (absLat < 49) return "5a";
  if (absLat < 52) return "4b";
  if (absLat < 55) return "4a";
  if (absLat < 58) return "3b";
  return "3a";
}
```

Note: Add `import { useState } from "react"` and `import { trpc } from "@/lib/trpc"` to the file's imports if not already present.

**Step 2: Verify web builds**

Run: `pnpm --filter @gardoo/web build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/web/src/app/onboarding/page.tsx
git commit -m "feat: implement onboarding Step 2 — location with geolocation and search"
```

---

## Task 6: Step 3 — AI Setup

Implement the AI provider selection and API key validation step.

**Files:**
- Modify: `packages/web/src/app/onboarding/page.tsx` — replace `StepAISetup` placeholder

**Step 1: Implement StepAISetup component**

```typescript
function StepAISetup({
  state,
  dispatch,
  onNext,
  onBack,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
  onBack: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState("");

  const validateMutation = trpc.apiKeys.validate.useMutation();
  const storeMutation = trpc.apiKeys.store.useMutation({
    onSuccess() {
      onNext();
    },
  });

  const handleValidateAndContinue = async () => {
    setValidating(true);
    setValidationError("");
    try {
      const result = await validateMutation.mutateAsync({
        provider: state.aiProvider,
        key: state.apiKey,
      });
      if (result.valid) {
        dispatch({ type: "SET_FIELD", field: "apiKeyValid", value: true });
        // Store the key
        storeMutation.mutate({
          provider: state.aiProvider,
          key: state.apiKey,
        });
      } else {
        setValidationError("Invalid API key. Please check and try again.");
      }
    } catch {
      setValidationError("Could not validate key. Please check and try again.");
    } finally {
      setValidating(false);
    }
  };

  const providers = [
    {
      id: "claude" as const,
      name: "Claude",
      company: "Anthropic",
      link: "https://console.anthropic.com/",
    },
    {
      id: "kimi" as const,
      name: "Kimi",
      company: "Moonshot AI",
      link: "https://platform.moonshot.cn/",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <button onClick={onBack} className="mb-4 text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </button>
        <h2 className="text-xl font-semibold text-gray-900">Connect your AI assistant</h2>
        <p className="mt-1 text-sm text-gray-500">
          Gardoo uses AI to analyze your garden and generate daily care recommendations.
          You&apos;ll need an API key from one of these providers.
        </p>
      </div>

      {/* Provider selection */}
      <div className="grid grid-cols-2 gap-3">
        {providers.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              dispatch({ type: "SET_FIELD", field: "aiProvider", value: p.id });
              dispatch({ type: "SET_FIELD", field: "apiKeyValid", value: false });
              setValidationError("");
            }}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${
              state.aiProvider === p.id
                ? "border-[#2D7D46] bg-green-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <p className="font-semibold text-gray-900">{p.name}</p>
            <p className="text-xs text-gray-500">{p.company}</p>
          </button>
        ))}
      </div>

      {/* API key input */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {providers.find((p) => p.id === state.aiProvider)?.name} API Key
        </label>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={state.apiKey}
            onChange={(e) => {
              dispatch({ type: "SET_FIELD", field: "apiKey", value: e.target.value });
              dispatch({ type: "SET_FIELD", field: "apiKeyValid", value: false });
              setValidationError("");
            }}
            placeholder="sk-..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-16 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
          >
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        <a
          href={providers.find((p) => p.id === state.aiProvider)?.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-[#2D7D46] hover:underline"
        >
          Get a {providers.find((p) => p.id === state.aiProvider)?.name} API key →
        </a>
      </div>

      {state.apiKeyValid && (
        <p className="flex items-center gap-1 text-sm text-green-600">
          ✓ API key validated
        </p>
      )}
      {validationError && <p className="text-sm text-red-600">{validationError}</p>}

      <button
        onClick={handleValidateAndContinue}
        disabled={!state.apiKey.trim() || validating || storeMutation.isPending}
        className="w-full rounded-lg bg-[#2D7D46] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
      >
        {validating
          ? "Validating..."
          : storeMutation.isPending
            ? "Saving..."
            : "Validate & Continue"}
      </button>
    </div>
  );
}
```

**Step 2: Verify web builds**

Run: `pnpm --filter @gardoo/web build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/web/src/app/onboarding/page.tsx
git commit -m "feat: implement onboarding Step 3 — AI provider selection and key validation"
```

---

## Task 7: Step 4 — Add Zones (Template Grid + Details + Plant List)

Implement the zone creation flow with templates, details form, photo upload, and plant identification.

**Files:**
- Modify: `packages/web/src/app/onboarding/page.tsx` — replace `StepAddZones` placeholder

**Step 1: Implement StepAddZones component**

This is the most complex step with four sub-states. The component manages transitions between template grid → zone details → plant list → confirmation.

```typescript
function StepAddZones({
  state,
  dispatch,
  onNext,
  onBack,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
  onBack: () => void;
}) {
  const createZone = trpc.zones.create.useMutation();
  const createPlant = trpc.plants.create.useMutation();
  const identifyPlants = trpc.plants.identify.useMutation();

  const [newPlantName, setNewPlantName] = useState("");
  const [newPlantVariety, setNewPlantVariety] = useState("");

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      dispatch({ type: "SET_CURRENT_ZONE", field: "photoBase64", value: base64 });
    };
    reader.readAsDataURL(file);
  };

  const handleGoToPlants = async () => {
    dispatch({ type: "SET_FIELD", field: "zoneSubStep" as keyof WizardState, value: "plants" });

    if (state.currentZone?.photoBase64) {
      dispatch({ type: "SET_FIELD", field: "identifyingPlants", value: true });
      try {
        const result = await identifyPlants.mutateAsync({
          imageBase64: state.currentZone.photoBase64,
          zoneType: state.currentZone.template,
          zoneName: state.currentZone.name,
        });
        dispatch({ type: "SET_ZONE_PLANTS", plants: result.plants.map((p) => ({ name: p.name, variety: p.variety ?? "" })) });
      } catch {
        dispatch({ type: "SET_FIELD", field: "identifyingPlants", value: false });
      }
    }
  };

  const handleConfirmZone = async () => {
    if (!state.currentZone || !state.gardenId) return;

    const zone = state.currentZone;
    const notes = [
      zone.template !== "other" ? `Type: ${zone.template}` : "",
      zone.dimensions ? `Size: ${zone.dimensions}` : "",
      zone.count ? `Count: ${zone.count}` : "",
    ].filter(Boolean).join(". ");

    const created = await createZone.mutateAsync({
      gardenId: state.gardenId,
      name: zone.name,
      soilType: zone.soilType || undefined,
      sunExposure: zone.sunExposure || undefined,
      notes: notes || undefined,
    });

    // Create plants
    for (const plant of zone.plants) {
      if (plant.name.trim()) {
        await createPlant.mutateAsync({
          zoneId: created.id,
          name: plant.name.trim(),
          variety: plant.variety.trim() || undefined,
        });
      }
    }

    dispatch({ type: "CONFIRM_ZONE" });
  };

  const handleAddPlant = () => {
    if (!newPlantName.trim() || !state.currentZone) return;
    dispatch({
      type: "SET_ZONE_PLANTS",
      plants: [...state.currentZone.plants, { name: newPlantName.trim(), variety: newPlantVariety.trim() }],
    });
    setNewPlantName("");
    setNewPlantVariety("");
  };

  const handleRemovePlant = (index: number) => {
    if (!state.currentZone) return;
    dispatch({
      type: "SET_ZONE_PLANTS",
      plants: state.currentZone.plants.filter((_, i) => i !== index),
    });
  };

  const handleEditPlant = (index: number, field: "name" | "variety", value: string) => {
    if (!state.currentZone) return;
    const updated = [...state.currentZone.plants];
    updated[index] = { ...updated[index], [field]: value };
    dispatch({ type: "SET_ZONE_PLANTS", plants: updated });
  };

  // Sub-step: Template grid
  if (state.zoneSubStep === "templates") {
    return (
      <div className="space-y-6">
        <div>
          <button onClick={onBack} className="mb-4 text-sm text-gray-500 hover:text-gray-700">
            ← Back
          </button>
          <h2 className="text-xl font-semibold text-gray-900">What&apos;s in your garden?</h2>
          <p className="mt-1 text-sm text-gray-500">
            Pick a zone type to add. You can add as many as you like.
          </p>
          {state.zones.length > 0 && (
            <p className="mt-2 text-sm text-green-600">
              ✓ {state.zones.length} zone{state.zones.length > 1 ? "s" : ""} added
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ZONE_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => dispatch({ type: "START_ZONE", template: tpl.id })}
              className="flex flex-col items-center gap-2 rounded-lg border-2 border-gray-200 p-4 transition-colors hover:border-[#2D7D46] hover:bg-green-50"
            >
              <span className="text-3xl">{tpl.icon}</span>
              <span className="text-center text-sm font-medium text-gray-700">{tpl.label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={onNext}
          className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
        >
          {state.zones.length > 0 ? "Done adding zones" : "Skip for now"}
        </button>
      </div>
    );
  }

  // Sub-step: Zone details form
  if (state.zoneSubStep === "details" && state.currentZone) {
    const tpl = ZONE_TEMPLATES.find((t) => t.id === state.currentZone!.template);
    return (
      <div className="space-y-5">
        <div>
          <button
            onClick={() => dispatch({ type: "RESET_ZONE_SUB_STEP" })}
            className="mb-4 text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to templates
          </button>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{tpl?.icon}</span>
            <h2 className="text-xl font-semibold text-gray-900">New {tpl?.label}</h2>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
          <input
            value={state.currentZone.name}
            onChange={(e) => dispatch({ type: "SET_CURRENT_ZONE", field: "name", value: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
          />
        </div>

        {tpl?.hasDimensions && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Dimensions</label>
            <input
              value={state.currentZone.dimensions}
              onChange={(e) => dispatch({ type: "SET_CURRENT_ZONE", field: "dimensions", value: e.target.value })}
              placeholder="e.g. 4x8 ft"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>
        )}

        {(tpl as typeof ZONE_TEMPLATES[number] & { hasCount?: boolean })?.hasCount && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Approximate count</label>
            <input
              value={state.currentZone.count}
              onChange={(e) => dispatch({ type: "SET_CURRENT_ZONE", field: "count", value: e.target.value })}
              placeholder="e.g. 6 pots"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Soil type</label>
            <select
              value={state.currentZone.soilType}
              onChange={(e) => dispatch({ type: "SET_CURRENT_ZONE", field: "soilType", value: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            >
              <option value="">Select...</option>
              <option value="Garden soil">Garden soil</option>
              <option value="Potting mix">Potting mix</option>
              <option value="Clay">Clay</option>
              <option value="Sandy">Sandy</option>
              <option value="Amended/compost">Amended/compost</option>
              <option value="Unknown">Unknown</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Sun exposure</label>
            <select
              value={state.currentZone.sunExposure}
              onChange={(e) => dispatch({ type: "SET_CURRENT_ZONE", field: "sunExposure", value: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            >
              <option value="">Select...</option>
              <option value="Full sun (6+ hrs)">Full sun (6+ hrs)</option>
              <option value="Partial sun (3-6 hrs)">Partial sun (3-6 hrs)</option>
              <option value="Shade (< 3 hrs)">Shade (&lt; 3 hrs)</option>
            </select>
          </div>
        </div>

        {/* Photo upload */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Photo (optional)</label>
          {state.currentZone.photoBase64 ? (
            <div className="relative">
              <img
                src={`data:image/jpeg;base64,${state.currentZone.photoBase64}`}
                alt="Zone"
                className="h-48 w-full rounded-lg object-cover"
              />
              <button
                onClick={() => dispatch({ type: "SET_CURRENT_ZONE", field: "photoBase64", value: null })}
                className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-1 text-xs text-white hover:bg-black/70"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 transition-colors hover:border-[#2D7D46] hover:bg-green-50">
              <span className="text-2xl">📷</span>
              <span className="mt-1 text-sm text-gray-500">Upload a photo of this zone</span>
              <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
            </label>
          )}
        </div>

        <button
          onClick={handleGoToPlants}
          disabled={!state.currentZone.name.trim()}
          className="w-full rounded-lg bg-[#2D7D46] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
        >
          Next
        </button>
      </div>
    );
  }

  // Sub-step: Plant list
  if (state.zoneSubStep === "plants" && state.currentZone) {
    return (
      <div className="space-y-5">
        <div>
          <button
            onClick={() => dispatch({ type: "SET_FIELD", field: "zoneSubStep" as keyof WizardState, value: "details" })}
            className="mb-4 text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to details
          </button>
          <h2 className="text-xl font-semibold text-gray-900">Plants in {state.currentZone.name}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {state.currentZone.photoBase64
              ? "We identified these plants from your photo. Edit or add more."
              : "Add the plants in this zone, or skip and add them later."}
          </p>
        </div>

        {state.identifyingPlants && (
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-[#2D7D46]" />
            <span className="text-sm text-gray-600">Analyzing your photo...</span>
          </div>
        )}

        {/* Plant list */}
        {state.currentZone.plants.length > 0 && (
          <div className="space-y-2">
            {state.currentZone.plants.map((plant, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
                <span className="text-lg">🌱</span>
                <input
                  value={plant.name}
                  onChange={(e) => handleEditPlant(i, "name", e.target.value)}
                  className="flex-1 border-none bg-transparent text-sm font-medium text-gray-900 focus:outline-none"
                  placeholder="Plant name"
                />
                <input
                  value={plant.variety}
                  onChange={(e) => handleEditPlant(i, "variety", e.target.value)}
                  className="w-32 border-none bg-transparent text-sm text-gray-500 focus:outline-none"
                  placeholder="Variety"
                />
                <button
                  onClick={() => handleRemovePlant(i)}
                  className="text-gray-400 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add plant form */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <input
              value={newPlantName}
              onChange={(e) => setNewPlantName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddPlant()}
              placeholder="Plant name"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>
          <div className="w-32">
            <input
              value={newPlantVariety}
              onChange={(e) => setNewPlantVariety(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddPlant()}
              placeholder="Variety"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>
          <button
            onClick={handleAddPlant}
            disabled={!newPlantName.trim()}
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        <button
          onClick={handleConfirmZone}
          disabled={createZone.isPending || createPlant.isPending}
          className="w-full rounded-lg bg-[#2D7D46] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
        >
          {createZone.isPending || createPlant.isPending
            ? "Saving..."
            : `Confirm${state.currentZone.plants.length > 0 ? ` with ${state.currentZone.plants.length} plant${state.currentZone.plants.length > 1 ? "s" : ""}` : ""}`}
        </button>
      </div>
    );
  }

  // Sub-step: Zone confirmed
  if (state.zoneSubStep === "confirmed") {
    const lastZone = state.zones[state.zones.length - 1];
    return (
      <div className="space-y-6 text-center">
        <div className="text-4xl">✓</div>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            {lastZone?.name} added
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {lastZone?.plants.length
              ? `with ${lastZone.plants.length} plant${lastZone.plants.length > 1 ? "s" : ""}`
              : "with no plants yet"}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => dispatch({ type: "RESET_ZONE_SUB_STEP" })}
            className="flex-1 rounded-lg border-2 border-[#2D7D46] px-4 py-3 text-sm font-semibold text-[#2D7D46] transition-colors hover:bg-green-50"
          >
            Add another zone
          </button>
          <button
            onClick={onNext}
            className="flex-1 rounded-lg bg-[#2D7D46] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#246838]"
          >
            Finish setup
          </button>
        </div>
      </div>
    );
  }

  return null;
}
```

**Step 2: Verify web builds**

Run: `pnpm --filter @gardoo/web build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/web/src/app/onboarding/page.tsx
git commit -m "feat: implement onboarding Step 4 — zone templates, details, photo plant ID"
```

---

## Task 8: Step 5 — All Set + Redirect Logic

Implement the final summary step and add redirect-to-onboarding logic for new users.

**Files:**
- Modify: `packages/web/src/app/onboarding/page.tsx` — replace `StepAllSet` placeholder
- Modify: `packages/web/src/lib/auth-context.tsx` — add redirect to onboarding for new users

**Step 1: Implement StepAllSet component**

```typescript
function StepAllSet({
  state,
  onFinish,
}: {
  state: WizardState;
  onFinish: () => void;
}) {
  const totalPlants = state.zones.reduce((sum, z) => sum + z.plants.length, 0);

  return (
    <div className="space-y-6 text-center">
      <div className="text-5xl">🌿</div>
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Your garden is ready!</h2>
        <p className="mt-2 text-gray-500">Here&apos;s what we set up:</p>
      </div>

      <div className="space-y-3 text-left">
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <span className="text-lg">📍</span>
          <div>
            <p className="font-medium text-gray-900">{state.gardenName}</p>
            <p className="text-sm text-gray-500">
              {state.locationDisplay}
              {state.hardinessZone ? ` · Zone ${state.hardinessZone}` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <span className="text-lg">🤖</span>
          <div>
            <p className="font-medium text-gray-900">
              {state.aiProvider === "claude" ? "Claude" : "Kimi"} connected
            </p>
            <p className="text-sm text-gray-500">AI assistant ready</p>
          </div>
        </div>

        {state.zones.length > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
            <span className="text-lg">🏡</span>
            <div>
              <p className="font-medium text-gray-900">
                {state.zones.length} zone{state.zones.length > 1 ? "s" : ""}
                {totalPlants > 0 ? ` · ${totalPlants} plant${totalPlants > 1 ? "s" : ""}` : ""}
              </p>
              <p className="text-sm text-gray-500">
                {state.zones.map((z) => z.name).join(", ")}
              </p>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onFinish}
        className="w-full rounded-lg bg-[#2D7D46] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#246838]"
      >
        Go to your garden
      </button>
    </div>
  );
}
```

**Step 2: Add redirect logic in auth context**

In `packages/web/src/lib/auth-context.tsx`, modify the `login` function to accept an optional redirect path, and update the home page to redirect new users.

A simpler approach: modify `packages/web/src/app/page.tsx` to redirect to `/onboarding` when no garden exists. Find the section where `!gardenId` is detected and add:

```typescript
const router = useRouter();

// After gardensQuery loads, if no garden exists, redirect to onboarding
useEffect(() => {
  if (!gardensQuery.isLoading && gardensQuery.data && gardensQuery.data.length === 0) {
    router.push("/onboarding");
  }
}, [gardensQuery.isLoading, gardensQuery.data, router]);
```

Add `import { useRouter } from "next/navigation"` and `import { useEffect } from "react"` to the imports.

**Step 3: Verify web builds**

Run: `pnpm --filter @gardoo/web build`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/web/src/app/onboarding/page.tsx packages/web/src/app/page.tsx
git commit -m "feat: implement onboarding Step 5 and redirect for new users"
```

---

## Task 9: End-to-End Smoke Test

Verify the full onboarding flow works locally.

**Step 1: Start the server**

Run: `pnpm dev:server`
Expected: Server starts on port 3000

**Step 2: Start the web app**

Run: `pnpm dev:web`
Expected: Next.js dev server starts

**Step 3: Test the flow**

1. Register a new account at `/login`
2. Should redirect to `/onboarding`
3. Click "Get Started"
4. Enter a garden name and search for a city — verify location resolves
5. Select Claude, enter an API key, click validate — verify validation works
6. Pick a zone template, fill in details, optionally upload a photo
7. Confirm the zone, click "Finish setup"
8. Should land on home page with the garden created

**Step 4: Verify no console errors**

Check browser console for any React errors or failed API calls.

**Step 5: Commit any fixes if needed**

```bash
git add -u
git commit -m "fix: onboarding flow adjustments from smoke test"
```
