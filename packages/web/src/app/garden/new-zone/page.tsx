"use client";

import { useReducer, useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import { resizeImage, uploadToR2 } from "@/lib/photo-upload";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PlantEntry {
  name: string;
  variety?: string;
  selected: boolean;
}

type SubStep = "template" | "details" | "plants" | "confirmed";

interface State {
  subStep: SubStep;
  selectedTemplate: string | null;
  zoneName: string;
  zoneDimensions: string;
  zoneContainerCount: string;
  zoneSoilType: string;
  zoneSunExposure: string;
  zonePhoto: string | null;
  zonePhotoBase64: string | null;
  zonePhotoMediaType: string | null;
  zonePhotoKey: string | null;
  zonePlants: PlantEntry[];
  manualPlantName: string;
  manualPlantVariety: string;
  currentZoneId: string | null;
  savedPlantCount: number;
}

type Action =
  | { type: "SET_SUB_STEP"; subStep: SubStep }
  | { type: "SELECT_TEMPLATE"; template: string; defaultName: string }
  | { type: "SET_ZONE_NAME"; value: string }
  | { type: "SET_ZONE_DIMENSIONS"; value: string }
  | { type: "SET_ZONE_CONTAINER_COUNT"; value: string }
  | { type: "SET_ZONE_SOIL_TYPE"; value: string }
  | { type: "SET_ZONE_SUN_EXPOSURE"; value: string }
  | { type: "SET_ZONE_PHOTO"; dataUrl: string; base64: string; mediaType: string }
  | { type: "SET_ZONE_PHOTO_KEY"; key: string }
  | { type: "CLEAR_ZONE_PHOTO" }
  | { type: "SET_ZONE_PLANTS"; plants: PlantEntry[] }
  | { type: "TOGGLE_PLANT"; index: number }
  | { type: "ADD_MANUAL_PLANT"; name: string; variety: string }
  | { type: "REMOVE_PLANT"; index: number }
  | { type: "SET_MANUAL_PLANT_NAME"; value: string }
  | { type: "SET_MANUAL_PLANT_VARIETY"; value: string }
  | { type: "SET_CURRENT_ZONE_ID"; id: string }
  | { type: "SET_SAVED_PLANT_COUNT"; count: number };

const initialState: State = {
  subStep: "template",
  selectedTemplate: null,
  zoneName: "",
  zoneDimensions: "",
  zoneContainerCount: "",
  zoneSoilType: "",
  zoneSunExposure: "",
  zonePhoto: null,
  zonePhotoBase64: null,
  zonePhotoMediaType: null,
  zonePhotoKey: null,
  zonePlants: [],
  manualPlantName: "",
  manualPlantVariety: "",
  currentZoneId: null,
  savedPlantCount: 0,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_SUB_STEP":
      return { ...state, subStep: action.subStep };
    case "SELECT_TEMPLATE":
      return {
        ...state,
        selectedTemplate: action.template,
        zoneName: action.defaultName,
        subStep: "details",
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
    case "SET_ZONE_PHOTO_KEY":
      return { ...state, zonePhotoKey: action.key };
    case "CLEAR_ZONE_PHOTO":
      return { ...state, zonePhoto: null, zonePhotoBase64: null, zonePhotoMediaType: null, zonePhotoKey: null };
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
    case "SET_SAVED_PLANT_COUNT":
      return { ...state, savedPlantCount: action.count };
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
  "Potting Soil",
  "Mixed / Unknown",
];

const SUN_EXPOSURES = [
  "Full Sun (6+ hrs)",
  "Partial Sun (3-6 hrs)",
  "Partial Shade",
  "Full Shade",
];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function NewZonePage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [state, dispatch] = useReducer(reducer, initialState);

  /* Fetch the user's garden */
  const gardensQuery = trpc.gardens.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const gardenId = gardensQuery.data?.[0]?.id;

  /* tRPC mutations */
  const createZoneMutation = trpc.zones.create.useMutation();
  const createPlantMutation = trpc.plants.create.useMutation();
  const identifyPlantsMutation = trpc.plants.identify.useMutation();
  const getUploadUrlMutation = trpc.photos.getUploadUrl.useMutation();

  /* Refs */
  const photoInputRef = useRef<HTMLInputElement>(null);

  /* Local state */
  const [zoneCreating, setZoneCreating] = useState(false);
  const [plantsSaving, setPlantsSaving] = useState(false);
  const [identifyTriggered, setIdentifyTriggered] = useState(false);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */

  const handlePhotoUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { blob, dataUrl, base64 } = await resizeImage(file);
        dispatch({ type: "SET_ZONE_PHOTO", dataUrl, base64, mediaType: "image/jpeg" });
        const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
          targetType: "zone",
          targetId: crypto.randomUUID(),
          contentType: "image/jpeg",
        });
        await uploadToR2(uploadUrl, blob);
        dispatch({ type: "SET_ZONE_PHOTO_KEY", key });
      } catch (err) {
        console.error("Photo upload failed:", err);
        dispatch({ type: "CLEAR_ZONE_PHOTO" });
      }
    },
    [getUploadUrlMutation]
  );

  const handleCreateZone = useCallback(async () => {
    if (!gardenId || !state.zoneName.trim()) return;
    setZoneCreating(true);
    try {
      const template = ZONE_TEMPLATES.find((t) => t.key === state.selectedTemplate);
      const noteParts: string[] = [];
      if (template?.hasCount && state.zoneContainerCount) {
        noteParts.push(`Container count: ${state.zoneContainerCount}`);
      }

      const result = await createZoneMutation.mutateAsync({
        gardenId,
        name: state.zoneName.trim(),
        zoneType: state.selectedTemplate || undefined,
        dimensions: (template?.hasDimensions && state.zoneDimensions) ? state.zoneDimensions : undefined,
        photoUrl: state.zonePhotoKey || undefined,
        soilType: state.zoneSoilType || undefined,
        sunExposure: state.zoneSunExposure || undefined,
        notes: noteParts.length > 0 ? noteParts.join("; ") : undefined,
      });
      dispatch({ type: "SET_CURRENT_ZONE_ID", id: result.id });
      dispatch({ type: "SET_SUB_STEP", subStep: "plants" });

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
    gardenId,
    state.zoneName,
    state.selectedTemplate,
    state.zoneDimensions,
    state.zoneContainerCount,
    state.zoneSoilType,
    state.zoneSunExposure,
    state.zonePhotoKey,
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
      dispatch({ type: "SET_SAVED_PLANT_COUNT", count: plantCount });
      dispatch({ type: "SET_SUB_STEP", subStep: "confirmed" });
    } catch {
      /* error shown via mutation */
    } finally {
      setPlantsSaving(false);
    }
  }, [state.currentZoneId, state.zonePlants, createPlantMutation]);

  const handleGoToGarden = useCallback(async () => {
    await utils.zones.list.invalidate();
    await utils.plants.list.invalidate();
    router.push("/garden");
  }, [utils, router]);

  /* ---------------------------------------------------------------- */
  /*  Guard                                                            */
  /* ---------------------------------------------------------------- */

  if (!isAuthenticated) return null;

  if (gardensQuery.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!gardenId) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <p className="text-gray-500">No garden found. Please create a garden first.</p>
        <Link href="/garden" className="mt-4 inline-block text-sm text-[#2D7D46] hover:underline">
          Back to Garden
        </Link>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="mx-auto max-w-lg space-y-6 py-4">
      {/* Template selection */}
      {state.subStep === "template" && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Link
              href="/garden"
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
            >
              {"\u2190"} Back to Garden
            </Link>
          </div>

          <h2 className="mb-1 text-xl font-semibold text-gray-900">
            Add a Zone
          </h2>
          <p className="mb-6 text-sm text-gray-500">
            Zones are areas in your garden like beds, planters, or
            containers. Pick a template to get started.
          </p>

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
        </div>
      )}

      {/* Zone details form */}
      {state.subStep === "details" && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <button
            onClick={() => dispatch({ type: "SET_SUB_STEP", subStep: "template" })}
            className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            {"\u2190"} Back to templates
          </button>

          <h2 className="mb-1 text-xl font-semibold text-gray-900">
            Zone Details
          </h2>
          <p className="mb-6 text-sm text-gray-500">
            Customize your{" "}
            {ZONE_TEMPLATES.find((t) => t.key === state.selectedTemplate)?.label ?? "zone"}.
          </p>

          {/* Zone name */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">Zone Name</label>
            <input
              value={state.zoneName}
              onChange={(e) => dispatch({ type: "SET_ZONE_NAME", value: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>

          {/* Dimensions (Raised Bed) */}
          {ZONE_TEMPLATES.find((t) => t.key === state.selectedTemplate)?.hasDimensions && (
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">Dimensions</label>
              <input
                value={state.zoneDimensions}
                onChange={(e) => dispatch({ type: "SET_ZONE_DIMENSIONS", value: e.target.value })}
                placeholder="e.g. 4' x 8'"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
              />
            </div>
          )}

          {/* Container count */}
          {ZONE_TEMPLATES.find((t) => t.key === state.selectedTemplate)?.hasCount && (
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">Number of Containers</label>
              <input
                value={state.zoneContainerCount}
                onChange={(e) => dispatch({ type: "SET_ZONE_CONTAINER_COUNT", value: e.target.value })}
                type="number"
                min="1"
                placeholder="e.g. 5"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
              />
            </div>
          )}

          {/* Soil type */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">Soil Type</label>
            <select
              value={state.zoneSoilType}
              onChange={(e) => dispatch({ type: "SET_ZONE_SOIL_TYPE", value: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            >
              <option value="">Select soil type...</option>
              {SOIL_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Sun exposure */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">Sun Exposure</label>
            <select
              value={state.zoneSunExposure}
              onChange={(e) => dispatch({ type: "SET_ZONE_SUN_EXPOSURE", value: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            >
              <option value="">Select sun exposure...</option>
              {SUN_EXPOSURES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Photo upload */}
          <div className="mb-6">
            <label className="mb-1 block text-sm font-medium text-gray-700">Photo (optional)</label>
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
              If you upload a photo, we&apos;ll try to identify plants using AI.
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

      {/* Plant list */}
      {state.subStep === "plants" && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-xl font-semibold text-gray-900">
            Plants in {state.zoneName}
          </h2>
          <p className="mb-6 text-sm text-gray-500">
            {state.zonePhotoBase64
              ? "We\u2019re identifying plants from your photo. You can also add plants manually."
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
                Could not identify plants automatically. You can add them manually below.
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
                    onChange={() => dispatch({ type: "TOGGLE_PLANT", index: idx })}
                    className="h-4 w-4 rounded border-gray-300 text-[#2D7D46] focus:ring-[#2D7D46]"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-900">{plant.name}</span>
                    {plant.variety && (
                      <span className="ml-2 text-sm text-gray-400">({plant.variety})</span>
                    )}
                  </div>
                  <button
                    onClick={() => dispatch({ type: "REMOVE_PLANT", index: idx })}
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
                onChange={(e) => dispatch({ type: "SET_MANUAL_PLANT_NAME", value: e.target.value })}
                placeholder="Plant name"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
              />
              <input
                value={state.manualPlantVariety}
                onChange={(e) => dispatch({ type: "SET_MANUAL_PLANT_VARIETY", value: e.target.value })}
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

      {/* Zone confirmed */}
      {state.subStep === "confirmed" && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm text-center">
          <div className="mb-4 text-4xl">{"\u2705"}</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">
            Zone Added!
          </h2>
          <p className="mb-6 text-sm text-gray-500">
            <strong>{state.zoneName}</strong> has been added with{" "}
            {state.savedPlantCount} plant{state.savedPlantCount !== 1 ? "s" : ""}.
          </p>

          <button
            onClick={handleGoToGarden}
            className="w-full rounded-lg bg-[#2D7D46] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
          >
            Back to Garden
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
