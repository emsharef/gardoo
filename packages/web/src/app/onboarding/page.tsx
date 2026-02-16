"use client";

import { useReducer, useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PlantEntry {
  name: string;
  variety?: string;
  selected: boolean;
}

interface ZoneEntry {
  id: string;
  name: string;
  template: string;
  plantCount: number;
}

type WizardStep = 0 | 1 | 2 | 3 | 4;
type ZoneSubStep = "template" | "details" | "plants" | "confirmed";

interface WizardState {
  step: WizardStep;
  /* Step 1 - Location */
  gardenName: string;
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string;
  hardinessZone: string;
  gardenId: string | null;
  /* Step 2 - AI Setup */
  aiProvider: "claude" | "kimi";
  apiKey: string;
  apiKeyValidated: boolean;
  apiKeyStored: boolean;
  /* Step 3 - Add Zones */
  zoneSubStep: ZoneSubStep;
  selectedTemplate: string | null;
  zoneName: string;
  zoneDimensions: string;
  zoneContainerCount: string;
  zoneSoilType: string;
  zoneSunExposure: string;
  zonePhoto: string | null;
  zonePhotoBase64: string | null;
  zonePhotoMediaType: string | null;
  zonePlants: PlantEntry[];
  manualPlantName: string;
  manualPlantVariety: string;
  currentZoneId: string | null;
  completedZones: ZoneEntry[];
}

type WizardAction =
  | { type: "SET_STEP"; step: WizardStep }
  | { type: "SET_GARDEN_NAME"; value: string }
  | { type: "SET_LOCATION"; lat: number; lng: number; label: string; hardinessZone: string }
  | { type: "CLEAR_LOCATION" }
  | { type: "SET_GARDEN_ID"; id: string }
  | { type: "SET_AI_PROVIDER"; provider: "claude" | "kimi" }
  | { type: "SET_API_KEY"; value: string }
  | { type: "SET_API_KEY_VALIDATED"; valid: boolean }
  | { type: "SET_API_KEY_STORED"; stored: boolean }
  | { type: "SET_ZONE_SUB_STEP"; subStep: ZoneSubStep }
  | { type: "SELECT_TEMPLATE"; template: string; defaultName: string }
  | { type: "SET_ZONE_NAME"; value: string }
  | { type: "SET_ZONE_DIMENSIONS"; value: string }
  | { type: "SET_ZONE_CONTAINER_COUNT"; value: string }
  | { type: "SET_ZONE_SOIL_TYPE"; value: string }
  | { type: "SET_ZONE_SUN_EXPOSURE"; value: string }
  | { type: "SET_ZONE_PHOTO"; dataUrl: string; base64: string; mediaType: string }
  | { type: "CLEAR_ZONE_PHOTO" }
  | { type: "SET_ZONE_PLANTS"; plants: PlantEntry[] }
  | { type: "TOGGLE_PLANT"; index: number }
  | { type: "ADD_MANUAL_PLANT"; name: string; variety: string }
  | { type: "REMOVE_PLANT"; index: number }
  | { type: "SET_MANUAL_PLANT_NAME"; value: string }
  | { type: "SET_MANUAL_PLANT_VARIETY"; value: string }
  | { type: "SET_CURRENT_ZONE_ID"; id: string }
  | { type: "ZONE_CONFIRMED"; zone: ZoneEntry }
  | { type: "RESET_ZONE_FORM" };

const initialState: WizardState = {
  step: 0,
  gardenName: "My Garden",
  locationLat: null,
  locationLng: null,
  locationLabel: "",
  hardinessZone: "",
  gardenId: null,
  aiProvider: "claude",
  apiKey: "",
  apiKeyValidated: false,
  apiKeyStored: false,
  zoneSubStep: "template",
  selectedTemplate: null,
  zoneName: "",
  zoneDimensions: "",
  zoneContainerCount: "",
  zoneSoilType: "",
  zoneSunExposure: "",
  zonePhoto: null,
  zonePhotoBase64: null,
  zonePhotoMediaType: null,
  zonePlants: [],
  manualPlantName: "",
  manualPlantVariety: "",
  currentZoneId: null,
  completedZones: [],
};

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step };
    case "SET_GARDEN_NAME":
      return { ...state, gardenName: action.value };
    case "SET_LOCATION":
      return {
        ...state,
        locationLat: action.lat,
        locationLng: action.lng,
        locationLabel: action.label,
        hardinessZone: action.hardinessZone,
      };
    case "CLEAR_LOCATION":
      return {
        ...state,
        locationLat: null,
        locationLng: null,
        locationLabel: "",
        hardinessZone: "",
      };
    case "SET_GARDEN_ID":
      return { ...state, gardenId: action.id };
    case "SET_AI_PROVIDER":
      return {
        ...state,
        aiProvider: action.provider,
        apiKey: "",
        apiKeyValidated: false,
        apiKeyStored: false,
      };
    case "SET_API_KEY":
      return { ...state, apiKey: action.value, apiKeyValidated: false };
    case "SET_API_KEY_VALIDATED":
      return { ...state, apiKeyValidated: action.valid };
    case "SET_API_KEY_STORED":
      return { ...state, apiKeyStored: action.stored };
    case "SET_ZONE_SUB_STEP":
      return { ...state, zoneSubStep: action.subStep };
    case "SELECT_TEMPLATE":
      return {
        ...state,
        selectedTemplate: action.template,
        zoneName: action.defaultName,
        zoneSubStep: "details",
      };
    case "SET_ZONE_NAME":
      return { ...state, zoneName: action.value };
    case "SET_ZONE_DIMENSIONS":
      return { ...state, zoneDimensions: action.value };
    case "SET_ZONE_CONTAINER_COUNT":
      return { ...state, zoneContainerCount: action.value };
    case "SET_ZONE_SOIL_TYPE":
      return { ...state, zoneSoilType: action.value };
    case "SET_ZONE_SUN_EXPOSURE":
      return { ...state, zoneSunExposure: action.value };
    case "SET_ZONE_PHOTO":
      return { ...state, zonePhoto: action.dataUrl, zonePhotoBase64: action.base64, zonePhotoMediaType: action.mediaType };
    case "CLEAR_ZONE_PHOTO":
      return { ...state, zonePhoto: null, zonePhotoBase64: null, zonePhotoMediaType: null };
    case "SET_ZONE_PLANTS":
      return { ...state, zonePlants: action.plants };
    case "TOGGLE_PLANT":
      return {
        ...state,
        zonePlants: state.zonePlants.map((p, i) =>
          i === action.index ? { ...p, selected: !p.selected } : p
        ),
      };
    case "ADD_MANUAL_PLANT":
      return {
        ...state,
        zonePlants: [
          ...state.zonePlants,
          { name: action.name, variety: action.variety || undefined, selected: true },
        ],
        manualPlantName: "",
        manualPlantVariety: "",
      };
    case "REMOVE_PLANT":
      return {
        ...state,
        zonePlants: state.zonePlants.filter((_, i) => i !== action.index),
      };
    case "SET_MANUAL_PLANT_NAME":
      return { ...state, manualPlantName: action.value };
    case "SET_MANUAL_PLANT_VARIETY":
      return { ...state, manualPlantVariety: action.value };
    case "SET_CURRENT_ZONE_ID":
      return { ...state, currentZoneId: action.id };
    case "ZONE_CONFIRMED":
      return {
        ...state,
        completedZones: [...state.completedZones, action.zone],
      };
    case "RESET_ZONE_FORM":
      return {
        ...state,
        zoneSubStep: "template",
        selectedTemplate: null,
        zoneName: "",
        zoneDimensions: "",
        zoneContainerCount: "",
        zoneSoilType: "",
        zoneSunExposure: "",
        zonePhoto: null,
        zonePhotoBase64: null,
        zonePhotoMediaType: null,
        zonePlants: [],
        manualPlantName: "",
        manualPlantVariety: "",
        currentZoneId: null,
      };
    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

interface ZoneTemplate {
  key: string;
  label: string;
  emoji: string;
  hasDimensions: boolean;
  hasCount: boolean;
}

const ZONE_TEMPLATES: readonly ZoneTemplate[] = [
  { key: "raised_bed", label: "Raised Bed", emoji: "\uD83C\uDF31", hasDimensions: true, hasCount: false },
  { key: "in_ground", label: "In-Ground Bed", emoji: "\uD83C\uDF3E", hasDimensions: false, hasCount: false },
  { key: "container", label: "Container / Pots", emoji: "\uD83E\uDEB4", hasDimensions: false, hasCount: true },
  { key: "indoor", label: "Indoor / Windowsill", emoji: "\uD83C\uDFE0", hasDimensions: false, hasCount: false },
  { key: "greenhouse", label: "Greenhouse", emoji: "\uD83C\uDFE1", hasDimensions: false, hasCount: false },
  { key: "orchard", label: "Orchard / Fruit Trees", emoji: "\uD83C\uDF33", hasDimensions: false, hasCount: false },
  { key: "herb_garden", label: "Herb Garden", emoji: "\uD83C\uDF3F", hasDimensions: false, hasCount: false },
  { key: "lawn", label: "Lawn / Ground Cover", emoji: "\uD83C\uDFDE\uFE0F", hasDimensions: false, hasCount: false },
];

const SOIL_TYPES = [
  "Sandy",
  "Loamy",
  "Clay",
  "Silty",
  "Peaty",
  "Chalky",
  "Mixed / Unknown",
];

const SUN_EXPOSURES = [
  "Full Sun (6+ hrs)",
  "Partial Sun (3-6 hrs)",
  "Partial Shade",
  "Full Shade",
];

function estimateHardinessZone(lat: number): string {
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

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function OnboardingPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [state, dispatch] = useReducer(wizardReducer, initialState);

  /* tRPC mutations */
  const createGardenMutation = trpc.gardens.create.useMutation();
  const validateKeyMutation = trpc.apiKeys.validate.useMutation();
  const storeKeyMutation = trpc.apiKeys.store.useMutation();
  const createZoneMutation = trpc.zones.create.useMutation();
  const createPlantMutation = trpc.plants.create.useMutation();
  const identifyPlantsMutation = trpc.plants.identify.useMutation();

  /* Refs */
  const photoInputRef = useRef<HTMLInputElement>(null);

  /* Geo search state (local to Step 1) */
  const [geoQuery, setGeoQuery] = useState("");
  const [geoSearching, setGeoSearching] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [geoLocating, setGeoLocating] = useState(false);

  /* API key validation error */
  const [keyError, setKeyError] = useState("");

  /* Zone creation loading */
  const [zoneCreating, setZoneCreating] = useState(false);
  const [plantsSaving, setPlantsSaving] = useState(false);

  /* Identification triggered flag */
  const [identifyTriggered, setIdentifyTriggered] = useState(false);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by your browser.");
      return;
    }
    setGeoLocating(true);
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const hz = estimateHardinessZone(latitude);
        dispatch({
          type: "SET_LOCATION",
          lat: latitude,
          lng: longitude,
          label: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
          hardinessZone: hz,
        });
        setGeoLocating(false);
      },
      (err) => {
        setGeoError(err.message);
        setGeoLocating(false);
      }
    );
  }, []);

  const handleGeoSearch = useCallback(async () => {
    if (!geoQuery.trim()) return;
    setGeoSearching(true);
    setGeoError("");
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(geoQuery.trim())}&count=1`
      );
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const r = data.results[0];
        const hz = estimateHardinessZone(r.latitude);
        dispatch({
          type: "SET_LOCATION",
          lat: r.latitude,
          lng: r.longitude,
          label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
          hardinessZone: hz,
        });
      } else {
        setGeoError("No results found. Try a different search.");
      }
    } catch {
      setGeoError("Search failed. Please try again.");
    } finally {
      setGeoSearching(false);
    }
  }, [geoQuery]);

  const handleCreateGarden = useCallback(async () => {
    try {
      const result = await createGardenMutation.mutateAsync({
        name: state.gardenName || "My Garden",
        locationLat: state.locationLat ?? undefined,
        locationLng: state.locationLng ?? undefined,
        hardinessZone: state.hardinessZone || undefined,
      });
      dispatch({ type: "SET_GARDEN_ID", id: result.id });
      dispatch({ type: "SET_STEP", step: 2 });
    } catch {
      /* mutation error is shown via mutation state */
    }
  }, [createGardenMutation, state.gardenName, state.locationLat, state.locationLng, state.hardinessZone]);

  const handleValidateKey = useCallback(async () => {
    setKeyError("");
    try {
      const result = await validateKeyMutation.mutateAsync({
        provider: state.aiProvider,
        key: state.apiKey,
      });
      if (result.valid) {
        dispatch({ type: "SET_API_KEY_VALIDATED", valid: true });
        /* Auto-store on validation success */
        try {
          await storeKeyMutation.mutateAsync({
            provider: state.aiProvider,
            key: state.apiKey,
          });
          dispatch({ type: "SET_API_KEY_STORED", stored: true });
        } catch (storeErr) {
          console.error("Store key failed:", storeErr);
          setKeyError("Key is valid but failed to save. Please try again.");
        }
      } else {
        setKeyError("Invalid API key. Please check and try again.");
      }
    } catch (err) {
      console.error("Validate key failed:", err);
      setKeyError("Failed to validate key. Please try again.");
    }
  }, [validateKeyMutation, storeKeyMutation, state.aiProvider, state.apiKey]);

  const handlePhotoUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        /* Extract MIME type from the data URL */
        const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
        const mediaType = mimeMatch?.[1] ?? "image/jpeg";
        /* Strip the data:...;base64, prefix to get raw base64 */
        const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
        dispatch({ type: "SET_ZONE_PHOTO", dataUrl, base64, mediaType });
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const handleCreateZone = useCallback(async () => {
    if (!state.gardenId || !state.zoneName.trim()) return;
    setZoneCreating(true);
    try {
      const template = ZONE_TEMPLATES.find((t) => t.key === state.selectedTemplate);
      const noteParts: string[] = [];
      if (template?.hasDimensions && state.zoneDimensions) {
        noteParts.push(`Dimensions: ${state.zoneDimensions}`);
      }
      if (template?.hasCount && state.zoneContainerCount) {
        noteParts.push(`Container count: ${state.zoneContainerCount}`);
      }
      if (state.selectedTemplate) {
        noteParts.push(`Type: ${state.selectedTemplate}`);
      }

      const result = await createZoneMutation.mutateAsync({
        gardenId: state.gardenId,
        name: state.zoneName.trim(),
        soilType: state.zoneSoilType || undefined,
        sunExposure: state.zoneSunExposure || undefined,
        notes: noteParts.length > 0 ? noteParts.join("; ") : undefined,
      });
      dispatch({ type: "SET_CURRENT_ZONE_ID", id: result.id });
      dispatch({ type: "SET_ZONE_SUB_STEP", subStep: "plants" });

      /* If photo was uploaded, kick off identification in background */
      if (state.zonePhotoBase64) {
        setIdentifyTriggered(true);
        identifyPlantsMutation.mutate({
          imageBase64: state.zonePhotoBase64,
          mediaType: (state.zonePhotoMediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp") ?? undefined,
          zoneType: state.selectedTemplate ?? undefined,
          zoneName: state.zoneName.trim(),
        });
      }
    } catch {
      /* error shown via mutation state */
    } finally {
      setZoneCreating(false);
    }
  }, [
    state.gardenId,
    state.zoneName,
    state.selectedTemplate,
    state.zoneDimensions,
    state.zoneContainerCount,
    state.zoneSoilType,
    state.zoneSunExposure,
    state.zonePhotoBase64,
    state.zonePhotoMediaType,
    createZoneMutation,
    identifyPlantsMutation,
  ]);

  /* When identification results come in, merge them into the plant list */
  useEffect(() => {
    if (identifyPlantsMutation.isSuccess && identifyPlantsMutation.data && identifyTriggered) {
      const identified = identifyPlantsMutation.data.plants.map((p) => ({
        name: p.name,
        variety: p.variety,
        selected: true,
      }));
      dispatch({ type: "SET_ZONE_PLANTS", plants: [...state.zonePlants, ...identified] });
      setIdentifyTriggered(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifyPlantsMutation.isSuccess, identifyPlantsMutation.data, identifyTriggered]);

  const handleSavePlantsAndConfirm = useCallback(async () => {
    if (!state.currentZoneId) return;
    setPlantsSaving(true);
    try {
      const selectedPlants = state.zonePlants.filter((p) => p.selected);
      let plantCount = 0;
      for (const plant of selectedPlants) {
        await createPlantMutation.mutateAsync({
          zoneId: state.currentZoneId,
          name: plant.name,
          variety: plant.variety,
        });
        plantCount++;
      }
      dispatch({
        type: "ZONE_CONFIRMED",
        zone: {
          id: state.currentZoneId,
          name: state.zoneName,
          template: state.selectedTemplate ?? "",
          plantCount,
        },
      });
      dispatch({ type: "SET_ZONE_SUB_STEP", subStep: "confirmed" });
    } catch {
      /* error shown via mutation */
    } finally {
      setPlantsSaving(false);
    }
  }, [state.currentZoneId, state.zonePlants, state.zoneName, state.selectedTemplate, createPlantMutation]);

  const handleAddAnotherZone = useCallback(() => {
    dispatch({ type: "RESET_ZONE_FORM" });
    setIdentifyTriggered(false);
    identifyPlantsMutation.reset();
  }, [identifyPlantsMutation]);

  const handleFinishSetup = useCallback(() => {
    dispatch({ type: "SET_STEP", step: 4 });
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Guard                                                            */
  /* ---------------------------------------------------------------- */

  if (!isAuthenticated) return null;

  /* ---------------------------------------------------------------- */
  /*  Progress bar                                                     */
  /* ---------------------------------------------------------------- */

  const showProgress = state.step >= 1 && state.step <= 3;
  const stepLabels = ["Location", "AI Setup", "Add Zones"];

  /* ---------------------------------------------------------------- */
  /*  Total plants across all zones for summary                        */
  /* ---------------------------------------------------------------- */

  const totalPlants = state.completedZones.reduce((sum, z) => sum + z.plantCount, 0);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex min-h-screen flex-col items-center bg-gray-50 px-4 py-8">
      {/* Progress bar */}
      {showProgress && (
        <div className="mb-8 w-full max-w-lg">
          <div className="flex items-center justify-between">
            {stepLabels.map((label, idx) => {
              const stepNum = idx + 1;
              const isActive = state.step === stepNum;
              const isComplete = state.step > stepNum;
              return (
                <div key={label} className="flex flex-1 flex-col items-center">
                  <div className="flex w-full items-center">
                    {idx > 0 && (
                      <div
                        className={`h-0.5 flex-1 ${
                          state.step > idx ? "bg-[#2D7D46]" : "bg-gray-200"
                        }`}
                      />
                    )}
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        isComplete
                          ? "bg-[#2D7D46] text-white"
                          : isActive
                            ? "border-2 border-[#2D7D46] text-[#2D7D46]"
                            : "border-2 border-gray-300 text-gray-400"
                      }`}
                    >
                      {isComplete ? "\u2713" : stepNum}
                    </div>
                    {idx < stepLabels.length - 1 && (
                      <div
                        className={`h-0.5 flex-1 ${
                          state.step > idx + 1 ? "bg-[#2D7D46]" : "bg-gray-200"
                        }`}
                      />
                    )}
                  </div>
                  <span
                    className={`mt-1 text-xs ${
                      isActive || isComplete ? "font-medium text-[#2D7D46]" : "text-gray-400"
                    }`}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 0: Welcome */}
      {state.step === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-6 text-6xl">{"\uD83C\uDF31"}</div>
          <h1 className="text-3xl font-bold text-[#2D7D46]">Gardoo</h1>
          <h2 className="mt-4 text-2xl font-semibold text-gray-900">
            Let&apos;s set up your garden
          </h2>
          <p className="mt-2 max-w-md text-gray-500">
            We&apos;ll walk you through a few quick steps to get your garden
            inventory ready and connect an AI assistant for smart care
            recommendations.
          </p>
          <button
            onClick={() => dispatch({ type: "SET_STEP", step: 1 })}
            className="mt-8 rounded-lg bg-[#2D7D46] px-8 py-3 text-lg font-medium text-white transition-colors hover:bg-[#246838]"
          >
            Get Started
          </button>
        </div>
      )}

      {/* Step 1: Location */}
      {state.step === 1 && (
        <div className="w-full max-w-lg">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-1 text-xl font-semibold text-gray-900">
              Name &amp; Location
            </h2>
            <p className="mb-6 text-sm text-gray-500">
              Tell us about your garden so we can provide weather-aware
              recommendations.
            </p>

            {/* Garden name */}
            <div className="mb-5">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Garden Name
              </label>
              <input
                value={state.gardenName}
                onChange={(e) =>
                  dispatch({ type: "SET_GARDEN_NAME", value: e.target.value })
                }
                placeholder="My Garden"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
              />
            </div>

            {/* Location */}
            <div className="mb-5">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Location
              </label>

              {state.locationLat !== null ? (
                <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                  <span className="text-sm text-green-800">
                    {"\uD83D\uDCCD"} {state.locationLabel}
                  </span>
                  {state.hardinessZone && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Zone {state.hardinessZone}
                    </span>
                  )}
                  <button
                    onClick={() => dispatch({ type: "CLEAR_LOCATION" })}
                    className="ml-auto text-sm text-gray-500 hover:text-gray-700"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Geolocate */}
                  <button
                    onClick={handleGeolocate}
                    disabled={geoLocating}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    {geoLocating ? (
                      <>
                        <Spinner />
                        Locating...
                      </>
                    ) : (
                      <>
                        {"\uD83D\uDCCD"} Use my current location
                      </>
                    )}
                  </button>

                  {/* Or search */}
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-gray-200" />
                    <span className="text-xs text-gray-400">or</span>
                    <div className="h-px flex-1 bg-gray-200" />
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={geoQuery}
                      onChange={(e) => setGeoQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleGeoSearch();
                      }}
                      placeholder="Search city or zip code"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                    />
                    <button
                      onClick={handleGeoSearch}
                      disabled={geoSearching || !geoQuery.trim()}
                      className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
                    >
                      {geoSearching ? <Spinner /> : "Search"}
                    </button>
                  </div>
                </div>
              )}

              {geoError && (
                <p className="mt-2 text-sm text-red-600">{geoError}</p>
              )}
            </div>

            {/* Next */}
            <button
              onClick={handleCreateGarden}
              disabled={
                createGardenMutation.isPending || !state.gardenName.trim()
              }
              className="w-full rounded-lg bg-[#2D7D46] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
            >
              {createGardenMutation.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner /> Creating garden...
                </span>
              ) : (
                "Next"
              )}
            </button>

            {createGardenMutation.isError && (
              <p className="mt-2 text-sm text-red-600">
                Failed to create garden. Please try again.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 2: AI Setup */}
      {state.step === 2 && (
        <div className="w-full max-w-lg">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-1 text-xl font-semibold text-gray-900">
              AI Assistant Setup
            </h2>
            <p className="mb-6 text-sm text-gray-500">
              Connect an AI provider to get smart care recommendations.
              Your API key is encrypted and stored securely.
            </p>

            {/* Provider toggle */}
            <div className="mb-5">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Choose Provider
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(["claude", "kimi"] as const).map((provider) => (
                  <button
                    key={provider}
                    onClick={() =>
                      dispatch({ type: "SET_AI_PROVIDER", provider })
                    }
                    className={`rounded-lg border-2 px-4 py-3 text-left transition-colors ${
                      state.aiProvider === provider
                        ? "border-[#2D7D46] bg-green-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <p className="text-sm font-semibold text-gray-900">
                      {provider === "claude" ? "Claude" : "Kimi"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {provider === "claude"
                        ? "By Anthropic"
                        : "By Moonshot AI"}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* API Key */}
            <div className="mb-5">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                API Key
              </label>
              <div className="relative">
                <input
                  value={state.apiKey}
                  onChange={(e) =>
                    dispatch({ type: "SET_API_KEY", value: e.target.value })
                  }
                  type="password"
                  placeholder={
                    state.aiProvider === "claude"
                      ? "sk-ant-..."
                      : "sk-..."
                  }
                  disabled={state.apiKeyStored}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46] disabled:bg-gray-50"
                />
              </div>
            </div>

            {/* Validate & Store */}
            {state.apiKeyStored ? (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <span className="text-green-600">{"\u2713"}</span>
                <span className="text-sm font-medium text-green-800">
                  API key validated and saved
                </span>
              </div>
            ) : (
              <button
                onClick={handleValidateKey}
                disabled={
                  !state.apiKey.trim() ||
                  validateKeyMutation.isPending ||
                  storeKeyMutation.isPending
                }
                className="w-full rounded-lg bg-[#2D7D46] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
              >
                {validateKeyMutation.isPending || storeKeyMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner />
                    {validateKeyMutation.isPending
                      ? "Validating..."
                      : "Saving..."}
                  </span>
                ) : (
                  "Validate & Save Key"
                )}
              </button>
            )}

            {keyError && (
              <p className="mt-2 text-sm text-red-600">{keyError}</p>
            )}

            {/* Navigation */}
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => dispatch({ type: "SET_STEP", step: 3 })}
                className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  state.apiKeyStored
                    ? "bg-[#2D7D46] text-white hover:bg-[#246838]"
                    : "border border-gray-300 text-gray-500 hover:bg-gray-50"
                }`}
              >
                {state.apiKeyStored ? "Next" : "Skip for now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Add Zones */}
      {state.step === 3 && (
        <div className="w-full max-w-lg">
          {/* 3a: Template grid */}
          {state.zoneSubStep === "template" && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-1 text-xl font-semibold text-gray-900">
                Add a Zone
              </h2>
              <p className="mb-6 text-sm text-gray-500">
                Zones are areas in your garden like beds, planters, or
                containers. Pick a template to get started.
              </p>

              {state.completedZones.length > 0 && (
                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Zones added
                  </p>
                  <div className="mt-2 space-y-1">
                    {state.completedZones.map((z) => (
                      <div
                        key={z.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-gray-700">{z.name}</span>
                        <span className="text-gray-400">
                          {z.plantCount} plant{z.plantCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {ZONE_TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() =>
                      dispatch({
                        type: "SELECT_TEMPLATE",
                        template: t.key,
                        defaultName: t.label,
                      })
                    }
                    className="flex flex-col items-center rounded-lg border-2 border-gray-200 px-4 py-4 transition-colors hover:border-[#2D7D46] hover:bg-green-50"
                  >
                    <span className="text-2xl">{t.emoji}</span>
                    <span className="mt-1 text-sm font-medium text-gray-700">
                      {t.label}
                    </span>
                  </button>
                ))}
              </div>

              {state.completedZones.length > 0 && (
                <button
                  onClick={handleFinishSetup}
                  className="mt-6 w-full rounded-lg bg-[#2D7D46] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
                >
                  Finish Setup
                </button>
              )}
            </div>
          )}

          {/* 3b: Zone details form */}
          {state.zoneSubStep === "details" && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <button
                onClick={() =>
                  dispatch({ type: "SET_ZONE_SUB_STEP", subStep: "template" })
                }
                className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              >
                {"\u2190"} Back to templates
              </button>

              <h2 className="mb-1 text-xl font-semibold text-gray-900">
                Zone Details
              </h2>
              <p className="mb-6 text-sm text-gray-500">
                Customize your{" "}
                {ZONE_TEMPLATES.find((t) => t.key === state.selectedTemplate)
                  ?.label ?? "zone"}
                .
              </p>

              {/* Zone name */}
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Zone Name
                </label>
                <input
                  value={state.zoneName}
                  onChange={(e) =>
                    dispatch({ type: "SET_ZONE_NAME", value: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                />
              </div>

              {/* Dimensions (Raised Bed) */}
              {ZONE_TEMPLATES.find((t) => t.key === state.selectedTemplate)
                ?.hasDimensions === true && (
                <div className="mb-4">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Dimensions
                  </label>
                  <input
                    value={state.zoneDimensions}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_ZONE_DIMENSIONS",
                        value: e.target.value,
                      })
                    }
                    placeholder='e.g. 4&apos; x 8&apos;'
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                  />
                </div>
              )}

              {/* Container count */}
              {ZONE_TEMPLATES.find((t) => t.key === state.selectedTemplate)
                ?.hasCount === true && (
                <div className="mb-4">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Number of Containers
                  </label>
                  <input
                    value={state.zoneContainerCount}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_ZONE_CONTAINER_COUNT",
                        value: e.target.value,
                      })
                    }
                    type="number"
                    min="1"
                    placeholder="e.g. 5"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                  />
                </div>
              )}

              {/* Soil type */}
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Soil Type
                </label>
                <select
                  value={state.zoneSoilType}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_ZONE_SOIL_TYPE",
                      value: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                >
                  <option value="">Select soil type...</option>
                  {SOIL_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sun exposure */}
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Sun Exposure
                </label>
                <select
                  value={state.zoneSunExposure}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_ZONE_SUN_EXPOSURE",
                      value: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                >
                  <option value="">Select sun exposure...</option>
                  {SUN_EXPOSURES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Photo upload */}
              <div className="mb-6">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Photo (optional)
                </label>
                {state.zonePhoto ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={state.zonePhoto}
                      alt="Zone preview"
                      className="h-40 w-full rounded-lg border border-gray-200 object-cover"
                    />
                    <button
                      onClick={() => dispatch({ type: "CLEAR_ZONE_PHOTO" })}
                      className="absolute right-2 top-2 rounded-full bg-white/80 px-2 py-0.5 text-xs text-gray-600 hover:bg-white"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 transition-colors hover:border-[#2D7D46] hover:text-[#2D7D46]"
                  >
                    {"\uD83D\uDCF7"} Upload a photo of this zone
                  </button>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <p className="mt-1 text-xs text-gray-400">
                  If you upload a photo, we&apos;ll try to identify plants
                  using AI.
                </p>
              </div>

              {/* Next */}
              <button
                onClick={handleCreateZone}
                disabled={zoneCreating || !state.zoneName.trim()}
                className="w-full rounded-lg bg-[#2D7D46] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
              >
                {zoneCreating ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner /> Creating zone...
                  </span>
                ) : (
                  "Next"
                )}
              </button>

              {createZoneMutation.isError && (
                <p className="mt-2 text-sm text-red-600">
                  Failed to create zone. Please try again.
                </p>
              )}
            </div>
          )}

          {/* 3c: Plant list */}
          {state.zoneSubStep === "plants" && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-1 text-xl font-semibold text-gray-900">
                Plants in {state.zoneName}
              </h2>
              <p className="mb-6 text-sm text-gray-500">
                {state.zonePhotoBase64
                  ? "We&apos;re identifying plants from your photo. You can also add plants manually."
                  : "Add the plants growing in this zone."}
              </p>

              {/* AI identification loading */}
              {identifyPlantsMutation.isPending && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                  <Spinner />
                  <span className="text-sm text-blue-700">
                    Identifying plants from photo...
                  </span>
                </div>
              )}

              {identifyPlantsMutation.isError && (
                <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
                  <p className="text-sm text-amber-700">
                    Could not identify plants automatically. You can add them
                    manually below.
                  </p>
                </div>
              )}

              {/* Plant checklist */}
              {state.zonePlants.length > 0 && (
                <div className="mb-4 space-y-2">
                  {state.zonePlants.map((plant, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={plant.selected}
                        onChange={() =>
                          dispatch({ type: "TOGGLE_PLANT", index: idx })
                        }
                        className="h-4 w-4 rounded border-gray-300 text-[#2D7D46] focus:ring-[#2D7D46]"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-900">
                          {plant.name}
                        </span>
                        {plant.variety && (
                          <span className="ml-2 text-sm text-gray-400">
                            ({plant.variety})
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          dispatch({ type: "REMOVE_PLANT", index: idx })
                        }
                        className="text-xs text-gray-400 hover:text-red-500"
                      >
                        {"\u2715"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Manual add */}
              <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Add a plant
                </p>
                <div className="flex gap-2">
                  <input
                    value={state.manualPlantName}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_MANUAL_PLANT_NAME",
                        value: e.target.value,
                      })
                    }
                    placeholder="Plant name"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                  />
                  <input
                    value={state.manualPlantVariety}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_MANUAL_PLANT_VARIETY",
                        value: e.target.value,
                      })
                    }
                    placeholder="Variety (optional)"
                    className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                  />
                  <button
                    onClick={() => {
                      if (!state.manualPlantName.trim()) return;
                      dispatch({
                        type: "ADD_MANUAL_PLANT",
                        name: state.manualPlantName.trim(),
                        variety: state.manualPlantVariety.trim(),
                      });
                    }}
                    disabled={!state.manualPlantName.trim()}
                    className="rounded-lg bg-[#2D7D46] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Save plants and confirm */}
              <button
                onClick={handleSavePlantsAndConfirm}
                disabled={plantsSaving}
                className="w-full rounded-lg bg-[#2D7D46] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
              >
                {plantsSaving ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner /> Saving plants...
                  </span>
                ) : (
                  "Confirm Zone"
                )}
              </button>
            </div>
          )}

          {/* 3d: Zone confirmed */}
          {state.zoneSubStep === "confirmed" && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm text-center">
              <div className="mb-4 text-4xl">{"\u2705"}</div>
              <h2 className="mb-2 text-xl font-semibold text-gray-900">
                Zone Added!
              </h2>
              <p className="mb-6 text-sm text-gray-500">
                <strong>{state.zoneName}</strong> has been added with{" "}
                {state.completedZones[state.completedZones.length - 1]
                  ?.plantCount ?? 0}{" "}
                plant
                {(state.completedZones[state.completedZones.length - 1]
                  ?.plantCount ?? 0) !== 1
                  ? "s"
                  : ""}
                .
              </p>

              <div className="flex gap-3">
                <button
                  onClick={handleAddAnotherZone}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Add Another Zone
                </button>
                <button
                  onClick={handleFinishSetup}
                  className="flex-1 rounded-lg bg-[#2D7D46] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
                >
                  Finish Setup
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 4: All Set */}
      {state.step === 4 && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-6 text-6xl">{"\uD83C\uDF89"}</div>
          <h1 className="text-2xl font-bold text-gray-900">
            You&apos;re all set!
          </h1>
          <p className="mt-2 max-w-md text-gray-500">
            Your garden is ready. Here&apos;s a summary of what we set up.
          </p>

          <div className="mt-6 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Garden</span>
                <span className="text-sm font-medium text-gray-900">
                  {state.gardenName}
                </span>
              </div>
              {state.locationLabel && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Location</span>
                  <span className="text-sm font-medium text-gray-900">
                    {state.locationLabel}
                  </span>
                </div>
              )}
              {state.hardinessZone && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    Hardiness Zone
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {state.hardinessZone}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">AI Provider</span>
                <span className="text-sm font-medium text-gray-900">
                  {state.apiKeyStored
                    ? state.aiProvider === "claude"
                      ? "Claude"
                      : "Kimi"
                    : "Not configured"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Zones</span>
                <span className="text-sm font-medium text-gray-900">
                  {state.completedZones.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Plants</span>
                <span className="text-sm font-medium text-gray-900">
                  {totalPlants}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={async () => {
              await utils.gardens.list.invalidate();
              router.push("/");
            }}
            className="mt-8 rounded-lg bg-[#2D7D46] px-8 py-3 text-lg font-medium text-white transition-colors hover:bg-[#246838]"
          >
            Go to your garden
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tiny spinner component                                             */
/* ------------------------------------------------------------------ */

function Spinner() {
  return (
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-white" />
  );
}
