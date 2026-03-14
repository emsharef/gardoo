"use client";

import { useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import { Photo } from "@/components/Photo";
import { TaskCard } from "@/components/TaskCard";
import { resizeImage, uploadToR2 } from "@/lib/photo-upload";

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

const GROWTH_STAGES = [
  "Seed",
  "Seedling",
  "Vegetative",
  "Budding",
  "Flowering",
  "Fruiting",
  "Harvest",
  "Dormant",
];

const ZONE_TYPES = [
  { key: "raised_bed", label: "Raised Bed" },
  { key: "in_ground", label: "In-Ground Bed" },
  { key: "container", label: "Container / Pots" },
  { key: "indoor", label: "Indoor / Windowsill" },
  { key: "greenhouse", label: "Greenhouse" },
  { key: "orchard", label: "Orchard / Fruit Trees" },
  { key: "herb_garden", label: "Herb Garden" },
  { key: "lawn", label: "Lawn / Ground Cover" },
];

const ACTION_TYPES = [
  { value: "water", label: "Water", emoji: "\uD83D\uDCA7" },
  { value: "fertilize", label: "Fertilize", emoji: "\uD83E\uDEB4" },
  { value: "harvest", label: "Harvest", emoji: "\uD83E\uDE78" },
  { value: "prune", label: "Prune", emoji: "\u2702\uFE0F" },
  { value: "plant", label: "Plant", emoji: "\uD83C\uDF31" },
  { value: "monitor", label: "Monitor", emoji: "\uD83D\uDD0D" },
  { value: "protect", label: "Protect", emoji: "\uD83D\uDEE1\uFE0F" },
  { value: "other", label: "Other", emoji: "\uD83D\uDCDD" },
] as const;

type Tab = "plants" | "careLogs" | "tasks" | "photos" | "history";

const TABS: { key: Tab; label: string }[] = [
  { key: "plants", label: "Plants" },
  { key: "tasks", label: "Tasks" },
  { key: "careLogs", label: "Care Logs" },
  { key: "photos", label: "Photos" },
  { key: "history", label: "History" },
];

export default function ZoneDetailPage() {
  const { zoneId } = useParams<{ zoneId: string }>();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState<Tab>("plants");

  const zoneQuery = trpc.zones.get.useQuery(
    { id: zoneId },
    { enabled: isAuthenticated && !!zoneId },
  );

  const gardenId = zoneQuery.data?.garden?.id;

  const careLogsQuery = trpc.careLogs.list.useQuery(
    { targetType: "zone", targetId: zoneId },
    { enabled: isAuthenticated && !!zoneId },
  );

  // Also fetch care logs for all plants in this zone (for the Photos tab)
  const plantIds = zoneQuery.data?.plants?.map((p) => p.id) ?? [];

  const sensorsQuery = trpc.sensors.list.useQuery(
    { zoneId },
    { enabled: isAuthenticated && !!zoneId },
  );

  const actionsQuery = trpc.gardens.getActions.useQuery(
    { gardenId: gardenId!, zoneId },
    { enabled: !!gardenId },
  );

  const retiredPlantsQuery = trpc.plants.listRetired.useQuery(
    { zoneId },
    { enabled: !!zoneId },
  );

  /* Add plant state */
  const [showAddPlant, setShowAddPlant] = useState(false);
  const [plantName, setPlantName] = useState("");
  const [plantVariety, setPlantVariety] = useState("");
  const [plantSpecies, setPlantSpecies] = useState("");
  const [plantGrowthStage, setPlantGrowthStage] = useState("");
  const [plantDatePlanted, setPlantDatePlanted] = useState("");
  const [plantPhotoPreview, setPlantPhotoPreview] = useState<string | null>(null);
  const [plantPhotoKey, setPlantPhotoKey] = useState<string | null>(null);

  /* Edit zone state */
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editZoneType, setEditZoneType] = useState("");
  const [editDimensions, setEditDimensions] = useState("");
  const [editSoilType, setEditSoilType] = useState("");
  const [editSunExposure, setEditSunExposure] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null);
  const [editPhotoKey, setEditPhotoKey] = useState<string | null>(null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const editPhotoRef = useRef<HTMLInputElement>(null);

  /* Delete state */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /* Expanded photo overlay */
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);

  /* Care log creation state */
  const [showAddLog, setShowAddLog] = useState(false);
  const [logActionType, setLogActionType] = useState<string>("water");
  const [logNotes, setLogNotes] = useState("");
  const [logPhotoPreview, setLogPhotoPreview] = useState<string | null>(null);
  const [logPhotoKey, setLogPhotoKey] = useState<string | null>(null);
  const logPhotoRef = useRef<HTMLInputElement>(null);

  /* Tasks dismissed IDs for animation */
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  /* Re-scan state */
  const [showRescan, setShowRescan] = useState(false);
  const [rescanPhotoPreview, setRescanPhotoPreview] = useState<string | null>(null);
  const [rescanPhotoBase64, setRescanPhotoBase64] = useState<string | null>(null);
  const [rescanPhotoKey, setRescanPhotoKey] = useState<string | null>(null);
  const [rescanDiff, setRescanDiff] = useState<{
    newPlants: { name: string; variety?: string | null; selected: boolean }[];
    missingPlants: { plantId: string; name: string; suggestedReason?: string; selected: boolean }[];
    growthUpdates: { plantId: string; name: string; currentStage: string; newStage: string; selected: boolean }[];
  } | null>(null);

  /* Mutations */
  const createPlantMutation = trpc.plants.create.useMutation({
    onSuccess() {
      zoneQuery.refetch();
      setShowAddPlant(false);
      setPlantName("");
      setPlantVariety("");
      setPlantSpecies("");
      setPlantGrowthStage("");
      setPlantDatePlanted("");
      setPlantPhotoPreview(null);
      setPlantPhotoKey(null);
    },
  });

  const updateZoneMutation = trpc.zones.update.useMutation({
    onSuccess() {
      zoneQuery.refetch();
      setEditing(false);
      setPhotoChanged(false);
    },
  });

  const deleteZoneMutation = trpc.zones.delete.useMutation({
    async onSuccess() {
      await utils.zones.list.invalidate();
      router.push("/garden");
    },
  });

  const createCareLogMutation = trpc.careLogs.create.useMutation({
    onSuccess() {
      careLogsQuery.refetch();
      setShowAddLog(false);
      setLogNotes("");
      setLogActionType("water");
      setLogPhotoPreview(null);
      setLogPhotoKey(null);
    },
  });

  const getUploadUrlMutation = trpc.photos.getUploadUrl.useMutation();

  const rescanMutation = trpc.zones.rescan.useMutation({
    onSuccess(data) {
      setRescanDiff({
        newPlants: data.newPlants.map((p) => ({ ...p, selected: true })),
        missingPlants: data.missingPlants.map((p) => ({ ...p, selected: true })),
        growthUpdates: data.growthUpdates.map((p) => ({ ...p, selected: true })),
      });
    },
  });

  const applyRescanMutation = trpc.zones.applyRescan.useMutation({
    onSuccess() {
      zoneQuery.refetch();
      retiredPlantsQuery.refetch();
      setShowRescan(false);
      setRescanDiff(null);
      setRescanPhotoPreview(null);
      setRescanPhotoBase64(null);
      setRescanPhotoKey(null);
    },
  });

  const handleLogPhotoUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { blob, dataUrl } = await resizeImage(file);
        setLogPhotoPreview(dataUrl);
        const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
          targetType: "careLog",
          targetId: zoneId,
          contentType: "image/jpeg",
        });
        await uploadToR2(uploadUrl, blob);
        setLogPhotoKey(key);
      } catch (err) {
        console.error("Photo upload failed:", err);
        setLogPhotoPreview(null);
        setLogPhotoKey(null);
      }
    },
    [zoneId, getUploadUrlMutation]
  );

  const startEditing = useCallback(() => {
    if (!zoneQuery.data) return;
    const z = zoneQuery.data;
    setEditName(z.name);
    setEditZoneType(z.zoneType ?? "");
    setEditDimensions(z.dimensions ?? "");
    setEditSoilType(z.soilType ?? "");
    setEditSunExposure(z.sunExposure ?? "");
    setEditNotes(z.notes ?? "");
    setEditPhotoPreview(z.photoUrl ?? null);
    setEditPhotoKey(null);
    setPhotoChanged(false);
    setEditing(true);
  }, [zoneQuery.data]);

  const handleEditPhotoUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { blob, dataUrl } = await resizeImage(file);
        setEditPhotoPreview(dataUrl);
        setPhotoChanged(true);
        const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
          targetType: "zone",
          targetId: zoneId,
          contentType: "image/jpeg",
        });
        await uploadToR2(uploadUrl, blob);
        setEditPhotoKey(key);
      } catch (err) {
        console.error("Photo upload failed:", err);
        setEditPhotoPreview(null);
        setEditPhotoKey(null);
        setPhotoChanged(false);
      }
    },
    [zoneId, getUploadUrlMutation]
  );

  const handleNewPlantPhotoUpload = useCallback(
    async (file: File) => {
      try {
        const { blob, dataUrl } = await resizeImage(file);
        setPlantPhotoPreview(dataUrl);
        const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
          targetType: "plant",
          targetId: zoneId,
          contentType: "image/jpeg",
        });
        await uploadToR2(uploadUrl, blob);
        setPlantPhotoKey(key);
      } catch (err) {
        console.error("Photo upload failed:", err);
        setPlantPhotoPreview(null);
        setPlantPhotoKey(null);
      }
    },
    [zoneId, getUploadUrlMutation]
  );

  const handleRescanPhotoUpload = useCallback(
    async (file: File) => {
      try {
        const { blob, dataUrl, base64 } = await resizeImage(file);
        setRescanPhotoPreview(dataUrl);
        setRescanPhotoBase64(base64);
        // Upload to R2 for zone photo update
        const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
          targetType: "zone",
          targetId: zoneId,
          contentType: "image/jpeg",
        });
        await uploadToR2(uploadUrl, blob);
        setRescanPhotoKey(key);
        // Trigger AI rescan
        rescanMutation.mutate({
          zoneId,
          imageBase64: base64,
          mediaType: "image/jpeg",
        });
      } catch (err) {
        console.error("Rescan photo upload failed:", err);
        setRescanPhotoPreview(null);
        setRescanPhotoBase64(null);
      }
    },
    [zoneId, getUploadUrlMutation, rescanMutation],
  );

  const handleSaveEdit = useCallback(() => {
    const updates: Record<string, string | undefined> = {
      name: editName.trim() || undefined,
      zoneType: editZoneType || undefined,
      dimensions: editDimensions || undefined,
      soilType: editSoilType || undefined,
      sunExposure: editSunExposure || undefined,
      notes: editNotes || undefined,
    };
    if (photoChanged) {
      updates.photoUrl = editPhotoKey || undefined;
    }
    updateZoneMutation.mutate({ id: zoneId, ...updates });
  }, [zoneId, editName, editZoneType, editDimensions, editSoilType, editSunExposure, editNotes, editPhotoKey, photoChanged, updateZoneMutation]);

  const handleDelete = useCallback(() => {
    deleteZoneMutation.mutate({ id: zoneId });
  }, [zoneId, deleteZoneMutation]);

  const handleCreateCareLog = useCallback(() => {
    if (!logActionType) return;
    createCareLogMutation.mutate({
      targetType: "zone",
      targetId: zoneId,
      actionType: logActionType as "water" | "fertilize" | "harvest" | "prune" | "plant" | "monitor" | "protect" | "other",
      notes: logNotes || undefined,
      photoUrl: logPhotoKey || undefined,
    });
  }, [zoneId, logActionType, logNotes, logPhotoKey, createCareLogMutation]);

  const handleTaskCompleted = useCallback(
    (taskId: string) => {
      setDismissedIds((prev) => new Set(prev).add(taskId));
      setTimeout(() => {
        actionsQuery.refetch().then(() => {
          setDismissedIds((prev) => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
        });
      }, 100);
    },
    [actionsQuery],
  );

  if (!isAuthenticated) return null;

  const zone = zoneQuery.data;
  const careLogs = careLogsQuery.data ?? [];
  const sensors = sensorsQuery.data ?? [];
  const actions = (actionsQuery.data ?? []).filter((a) => !dismissedIds.has(a.id));

  // Collect all photos for the Photos tab
  const allPhotos: { url: string; label: string; date?: string }[] = [];
  if (zone?.photoUrl) {
    allPhotos.push({ url: zone.photoUrl, label: `${zone.name} (zone photo)` });
  }
  for (const plant of zone?.plants ?? []) {
    if (plant.photoUrl) {
      allPhotos.push({ url: plant.photoUrl, label: `${plant.name} (profile)` });
    }
  }
  for (const log of careLogs) {
    if (log.photoUrl) {
      const actionInfo = ACTION_TYPES.find((a) => a.value === log.actionType);
      allPhotos.push({
        url: log.photoUrl,
        label: `${actionInfo?.label ?? log.actionType} — ${log.notes || "No notes"}`,
        date: new Date(log.loggedAt).toLocaleDateString(),
      });
    }
  }

  if (zoneQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="h-48 animate-pulse rounded-xl bg-white border border-gray-200" />
      </div>
    );
  }

  if (!zone) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-400">Zone not found.</p>
        <Link href="/garden" className="mt-2 inline-block text-sm text-[#2D7D46] hover:underline">
          Back to garden
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/garden" className="hover:text-[#2D7D46]">
          Garden
        </Link>
        <span>/</span>
        <span className="text-gray-900">{zone.name}</span>
      </div>

      {/* Zone Header */}
      {editing ? (
        /* ---- Edit Mode ---- */
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Edit Zone</h2>
            <button
              onClick={() => setEditing(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>

          {/* Photo */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Photo</label>
            {editPhotoPreview ? (
              <div className="relative">
                <Photo
                  src={editPhotoPreview}
                  alt="Zone preview"
                  className="h-40 w-full rounded-lg border border-gray-200 object-cover"
                />
                <div className="absolute right-2 top-2 flex gap-1">
                  <button
                    onClick={() => editPhotoRef.current?.click()}
                    className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-gray-600 hover:bg-white"
                  >
                    Change
                  </button>
                  <button
                    onClick={() => { setEditPhotoPreview(null); setEditPhotoKey(null); setPhotoChanged(true); }}
                    className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-red-600 hover:bg-white"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => editPhotoRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 transition-colors hover:border-[#2D7D46] hover:text-[#2D7D46]"
              >
                {"\uD83D\uDCF7"} Upload a photo
              </button>
            )}
            <input
              ref={editPhotoRef}
              type="file"
              accept="image/*"
              onChange={handleEditPhotoUpload}
              className="hidden"
            />
          </div>

          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>

          {/* Zone type */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Zone Type</label>
            <select
              value={editZoneType}
              onChange={(e) => setEditZoneType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            >
              <option value="">None</option>
              {ZONE_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Dimensions */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Dimensions</label>
            <input
              value={editDimensions}
              onChange={(e) => setEditDimensions(e.target.value)}
              placeholder="e.g. 4' x 8'"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>

          {/* Soil type */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Soil Type</label>
            <select
              value={editSoilType}
              onChange={(e) => setEditSoilType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            >
              <option value="">None</option>
              {SOIL_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Sun exposure */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Sun Exposure</label>
            <select
              value={editSunExposure}
              onChange={(e) => setEditSunExposure(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            >
              <option value="">None</option>
              {SUN_EXPOSURES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>

          {/* Save / Error */}
          <button
            onClick={handleSaveEdit}
            disabled={updateZoneMutation.isPending || !editName.trim()}
            className="w-full rounded-lg bg-[#2D7D46] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
          >
            {updateZoneMutation.isPending ? "Saving..." : "Save Changes"}
          </button>
          {updateZoneMutation.isError && (
            <p className="text-sm text-red-600">Failed to update zone. Please try again.</p>
          )}
        </div>
      ) : (
        /* ---- View Mode ---- */
        <div className="rounded-xl border border-gray-200 bg-white">
          <div
            className={`flex h-40 items-center justify-center rounded-t-xl bg-gradient-to-br from-green-50 to-emerald-100${zone.photoUrl ? " cursor-pointer" : ""}`}
            onClick={() => zone.photoUrl && setExpandedPhoto(zone.photoUrl)}
          >
            {zone.photoUrl ? (
              <Photo
                src={zone.photoUrl}
                alt={zone.name}
                className="h-full w-full rounded-t-xl object-cover"
              />
            ) : (
              <span className="text-5xl">{"\uD83C\uDF3F"}</span>
            )}
          </div>
          <div className="p-5">
            <div className="flex items-start justify-between">
              <h1 className="text-2xl font-bold text-gray-900">{zone.name}</h1>
              <div className="flex gap-2">
                <button
                  onClick={startEditing}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
              {zone.zoneType && (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                  {ZONE_TYPES.find((t) => t.key === zone.zoneType)?.label ?? zone.zoneType}
                </span>
              )}
              {zone.dimensions && (
                <span className="flex items-center gap-1">
                  <span className="font-medium">Size:</span> {zone.dimensions}
                </span>
              )}
              {zone.soilType && (
                <span className="flex items-center gap-1">
                  <span className="font-medium">Soil:</span> {zone.soilType}
                </span>
              )}
              {zone.sunExposure && (
                <span className="flex items-center gap-1">
                  <span className="font-medium">Sun:</span> {zone.sunExposure}
                </span>
              )}
              <span className="flex items-center gap-1">
                <span className="font-medium">Plants:</span>{" "}
                {zone.plants?.length ?? 0}
              </span>
            </div>
            {zone.notes && (
              <p className="mt-2 text-sm text-gray-600">{zone.notes}</p>
            )}

            {/* Delete confirmation */}
            {confirmingDelete && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-800">
                  Delete &quot;{zone.name}&quot;?
                </p>
                <p className="mt-1 text-sm text-red-600">
                  This will permanently delete this zone and all its plants. This cannot be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleteZoneMutation.isPending}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleteZoneMutation.isPending ? "Deleting..." : "Yes, Delete Zone"}
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
                {deleteZoneMutation.isError && (
                  <p className="mt-2 text-sm text-red-600">Failed to delete zone. Please try again.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sensors (always visible if present) */}
      {sensors.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sensors.map((sensor) => {
            const reading = sensor.lastReading as {
              value: number;
              unit: string;
            } | null;
            return (
              <div
                key={sensor.id}
                className="rounded-xl border border-gray-200 bg-white p-3"
              >
                <p className="text-xs font-medium text-gray-500">
                  {sensor.sensorType}
                </p>
                <p className="mt-0.5 text-xl font-bold text-gray-900">
                  {reading
                    ? `${reading.value}${reading.unit}`
                    : "--"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex border-b border-gray-200">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const taskCount = tab.key === "tasks" ? actions.length : 0;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "text-[#2D7D46]"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
              {taskCount > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#2D7D46] px-1 text-xs text-white">
                  {taskCount}
                </span>
              )}
              {isActive && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[#2D7D46]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div>
        {/* ── Plants Tab ── */}
        {activeTab === "plants" && (
          <div>
            <div className="mb-3 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowRescan(true)}
                className="rounded-lg border border-[#2D7D46] px-3 py-1.5 text-sm font-medium text-[#2D7D46] transition-colors hover:bg-green-50"
              >
                Re-scan Zone
              </button>
              <button
                onClick={() => setShowAddPlant(true)}
                className="rounded-lg bg-[#2D7D46] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
              >
                Add Plant
              </button>
            </div>

            {showAddPlant && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex gap-4">
                  {/* Photo upload */}
                  <label className="flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400 transition-colors hover:border-[#2D7D46] hover:text-[#2D7D46] overflow-hidden">
                    {plantPhotoPreview ? (
                      <img src={plantPhotoPreview} alt="Preview" className="h-full w-full object-cover" />
                    ) : (
                      <div className="text-center text-xs">
                        <span className="block text-2xl">{"\uD83D\uDCF7"}</span>
                        Photo
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleNewPlantPhotoUpload(file);
                      }}
                    />
                  </label>

                  {/* Fields */}
                  <div className="flex-1 space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        placeholder="Plant name *"
                        value={plantName}
                        onChange={(e) => setPlantName(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                      />
                      <input
                        placeholder="Variety (optional)"
                        value={plantVariety}
                        onChange={(e) => setPlantVariety(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                      />
                      <input
                        placeholder="Species (optional)"
                        value={plantSpecies}
                        onChange={(e) => setPlantSpecies(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                      />
                      <select
                        value={plantGrowthStage}
                        onChange={(e) => setPlantGrowthStage(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                      >
                        <option value="">Growth stage (optional)</option>
                        {GROWTH_STAGES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={plantDatePlanted}
                        onChange={(e) => setPlantDatePlanted(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                        title="Date planted"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (!plantName.trim()) return;
                          createPlantMutation.mutate({
                            zoneId,
                            name: plantName.trim(),
                            variety: plantVariety || undefined,
                            species: plantSpecies || undefined,
                            growthStage: plantGrowthStage || undefined,
                            datePlanted: plantDatePlanted || undefined,
                            photoUrl: plantPhotoKey || undefined,
                          });
                        }}
                        disabled={createPlantMutation.isPending || !plantName.trim()}
                        className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
                      >
                        {createPlantMutation.isPending ? "Adding..." : "Add Plant"}
                      </button>
                      <button
                        onClick={() => {
                          setShowAddPlant(false);
                          setPlantPhotoPreview(null);
                          setPlantPhotoKey(null);
                        }}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(zone.plants?.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                <p className="text-gray-400">No plants in this zone yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {zone.plants?.map((plant) => (
                  <Link
                    key={plant.id}
                    href={`/garden/${zoneId}/${plant.id}`}
                    className="group rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-md"
                  >
                    <div className="flex h-28 items-center justify-center rounded-t-xl bg-gradient-to-br from-lime-50 to-green-100">
                      {plant.photoUrl ? (
                        <Photo
                          src={plant.photoUrl}
                          alt={plant.name}
                          className="h-full w-full rounded-t-xl object-cover"
                        />
                      ) : (
                        <span className="text-3xl">{"\uD83C\uDF31"}</span>
                      )}
                    </div>
                    <div className="p-3">
                      <h3 className="font-semibold text-gray-900 group-hover:text-[#2D7D46]">{plant.name}</h3>
                      {plant.variety && (
                        <p className="text-xs text-gray-500">{plant.variety}</p>
                      )}
                      {plant.growthStage && (
                        <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          {plant.growthStage}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tasks Tab ── */}
        {activeTab === "tasks" && (
          <div>
            {actionsQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-white border border-gray-200" />
                ))}
              </div>
            ) : actions.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                <p className="text-gray-400">No pending tasks for this zone.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {actions.map((action) => (
                  <TaskCard
                    key={action.id}
                    action={action}
                    onCompleted={() => handleTaskCompleted(action.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Care Logs Tab ── */}
        {activeTab === "careLogs" && (
          <div>
            <div className="mb-3 flex items-center justify-end">
              <button
                onClick={() => setShowAddLog(true)}
                className="rounded-lg bg-[#2D7D46] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
              >
                Log Care
              </button>
            </div>

            {/* Add care log form */}
            {showAddLog && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Action Type</label>
                  <div className="grid grid-cols-4 gap-2">
                    {ACTION_TYPES.map((a) => (
                      <button
                        key={a.value}
                        onClick={() => setLogActionType(a.value)}
                        className={`flex flex-col items-center rounded-lg border-2 px-2 py-2 text-xs transition-colors ${
                          logActionType === a.value
                            ? "border-[#2D7D46] bg-green-50 font-medium text-[#2D7D46]"
                            : "border-gray-200 text-gray-600 hover:border-gray-300"
                        }`}
                      >
                        <span className="text-lg">{a.emoji}</span>
                        <span className="mt-0.5">{a.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
                  <textarea
                    value={logNotes}
                    onChange={(e) => setLogNotes(e.target.value)}
                    rows={2}
                    placeholder="What did you do?"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Photo (optional)</label>
                  {logPhotoPreview ? (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={logPhotoPreview}
                        alt="Care log photo"
                        className="h-32 w-full rounded-lg border border-gray-200 object-cover"
                      />
                      <button
                        onClick={() => { setLogPhotoPreview(null); setLogPhotoKey(null); }}
                        className="absolute right-2 top-2 rounded-full bg-white/80 px-2 py-0.5 text-xs text-red-600 hover:bg-white"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => logPhotoRef.current?.click()}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-4 text-sm text-gray-500 transition-colors hover:border-[#2D7D46] hover:text-[#2D7D46]"
                    >
                      {"\uD83D\uDCF7"} Add a photo
                    </button>
                  )}
                  <input
                    ref={logPhotoRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogPhotoUpload}
                    className="hidden"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateCareLog}
                    disabled={createCareLogMutation.isPending}
                    className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
                  >
                    {createCareLogMutation.isPending ? "Saving..." : "Save Log"}
                  </button>
                  <button
                    onClick={() => { setShowAddLog(false); setLogNotes(""); setLogPhotoPreview(null); setLogPhotoKey(null); }}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
                {createCareLogMutation.isError && (
                  <p className="text-sm text-red-600">Failed to save care log. Please try again.</p>
                )}
              </div>
            )}

            {careLogsQuery.isLoading ? (
              <div className="h-16 animate-pulse rounded-xl bg-white border border-gray-200" />
            ) : careLogs.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
                <p className="text-sm text-gray-400">No care logs yet. Log your first action above.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {careLogs.slice(0, 20).map((log) => {
                  const actionInfo = ACTION_TYPES.find((a) => a.value === log.actionType);
                  return (
                    <div
                      key={log.id}
                      className="rounded-lg border border-gray-200 bg-white px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{actionInfo?.emoji ?? "\uD83D\uDCDD"}</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {actionInfo?.label ?? log.actionType}
                        </span>
                        <p className="flex-1 text-sm text-gray-700 truncate">
                          {log.notes || "No notes"}
                        </p>
                        <time className="text-xs text-gray-400">
                          {new Date(log.loggedAt).toLocaleDateString()}
                        </time>
                      </div>
                      {log.photoUrl && (
                        <button
                          onClick={() => setExpandedPhoto(log.photoUrl)}
                          className="mt-2 flex-shrink-0"
                        >
                          <Photo
                            src={log.photoUrl}
                            alt="Care log photo"
                            className="h-16 w-16 rounded-lg border border-gray-200 object-cover transition-opacity hover:opacity-80"
                          />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Photos Tab ── */}
        {activeTab === "photos" && (
          <div>
            {allPhotos.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                <p className="text-gray-400">No photos yet. Add photos via care logs or zone/plant editing.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {allPhotos.map((photo, i) => (
                  <button
                    key={i}
                    onClick={() => setExpandedPhoto(photo.url)}
                    className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white"
                  >
                    <Photo
                      src={photo.url}
                      alt={photo.label}
                      className="aspect-square w-full object-cover transition-opacity group-hover:opacity-90"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                      <p className="text-xs text-white truncate">{photo.label}</p>
                      {photo.date && (
                        <p className="text-[10px] text-white/70">{photo.date}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── History Tab ── */}
        {activeTab === "history" && (
          <div>
            {retiredPlantsQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
                ))}
              </div>
            ) : (retiredPlantsQuery.data?.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                <p className="text-gray-400">No retired plants.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {retiredPlantsQuery.data?.map((plant) => (
                  <Link
                    key={plant.id}
                    href={`/garden/${zoneId}/${plant.id}`}
                    className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                      {plant.photoUrl ? (
                        <Photo src={plant.photoUrl} alt={plant.name} className="h-full w-full rounded-lg object-cover" />
                      ) : (
                        <span className="text-xl opacity-50">{"\uD83C\uDF31"}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-600 line-through">{plant.name}</p>
                      {plant.variety && <p className="text-sm text-gray-400">{plant.variety}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        plant.retiredReason === "harvested" ? "bg-green-100 text-green-700" :
                        plant.retiredReason === "died" ? "bg-red-100 text-red-700" :
                        plant.retiredReason === "relocated" ? "bg-blue-100 text-blue-700" :
                        "bg-gray-100 text-gray-600"
                      }`}>
                        {plant.retiredReason ?? "retired"}
                      </span>
                      {plant.retiredAt && (
                        <p className="mt-1 text-xs text-gray-400">{new Date(plant.retiredAt).toLocaleDateString()}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Re-scan Zone modal */}
      {showRescan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Re-scan Zone</h3>
            <p className="mt-1 text-sm text-gray-500">
              Upload a new photo and AI will detect what changed — new plants, removed plants, and growth updates.
            </p>

            {!rescanPhotoPreview ? (
              <label className="mt-4 flex h-40 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-[#2D7D46]">
                <div className="text-center text-gray-400">
                  <span className="block text-3xl">{"\uD83D\uDCF7"}</span>
                  <span className="mt-1 text-sm">Upload zone photo</span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleRescanPhotoUpload(file);
                  }}
                />
              </label>
            ) : (
              <img src={rescanPhotoPreview} alt="Re-scan" className="mt-4 w-full rounded-xl object-cover" />
            )}

            {rescanMutation.isPending && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                <span className="text-sm text-blue-700">Analyzing photo...</span>
              </div>
            )}

            {rescanMutation.isError && (
              <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3">
                <p className="text-sm text-red-700">Analysis failed. Make sure you have an AI API key configured in Settings.</p>
              </div>
            )}

            {rescanDiff && (
              <div className="mt-4 space-y-4">
                {rescanDiff.newPlants.length === 0 && rescanDiff.missingPlants.length === 0 && rescanDiff.growthUpdates.length === 0 && (
                  <p className="text-sm text-gray-500">No changes detected.</p>
                )}

                {rescanDiff.newPlants.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-green-700">New Plants</h4>
                    <div className="mt-1 space-y-1">
                      {rescanDiff.newPlants.map((p, i) => (
                        <label key={i} className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={p.selected}
                            onChange={() => {
                              const updated = [...rescanDiff.newPlants];
                              updated[i] = { ...updated[i], selected: !updated[i].selected };
                              setRescanDiff({ ...rescanDiff, newPlants: updated });
                            }}
                            className="accent-green-600"
                          />
                          <span className="text-sm text-green-900">{p.name}{p.variety ? ` (${p.variety})` : ""}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {rescanDiff.missingPlants.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-amber-700">Missing Plants</h4>
                    <div className="mt-1 space-y-1">
                      {rescanDiff.missingPlants.map((p, i) => (
                        <label key={i} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={p.selected}
                            onChange={() => {
                              const updated = [...rescanDiff.missingPlants];
                              updated[i] = { ...updated[i], selected: !updated[i].selected };
                              setRescanDiff({ ...rescanDiff, missingPlants: updated });
                            }}
                            className="accent-amber-600"
                          />
                          <span className="text-sm text-amber-900">{p.name}</span>
                          <select
                            value={p.suggestedReason ?? "removed"}
                            onChange={(e) => {
                              const updated = [...rescanDiff.missingPlants];
                              updated[i] = { ...updated[i], suggestedReason: e.target.value };
                              setRescanDiff({ ...rescanDiff, missingPlants: updated });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto rounded border border-amber-200 bg-white px-2 py-0.5 text-xs"
                          >
                            <option value="harvested">Harvested</option>
                            <option value="died">Died</option>
                            <option value="removed">Removed</option>
                            <option value="relocated">Relocated</option>
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {rescanDiff.growthUpdates.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-blue-700">Growth Updates</h4>
                    <div className="mt-1 space-y-1">
                      {rescanDiff.growthUpdates.map((p, i) => (
                        <label key={i} className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={p.selected}
                            onChange={() => {
                              const updated = [...rescanDiff.growthUpdates];
                              updated[i] = { ...updated[i], selected: !updated[i].selected };
                              setRescanDiff({ ...rescanDiff, growthUpdates: updated });
                            }}
                            className="accent-blue-600"
                          />
                          <span className="text-sm text-blue-900">
                            {p.name}: {p.currentStage} {"\u2192"} {p.newStage}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    applyRescanMutation.mutate({
                      zoneId,
                      photoUrl: rescanPhotoKey || undefined,
                      newPlants: rescanDiff.newPlants.filter((p) => p.selected).map((p) => ({ name: p.name, variety: p.variety ?? undefined })),
                      retirePlants: rescanDiff.missingPlants.filter((p) => p.selected).map((p) => ({
                        plantId: p.plantId,
                        reason: (p.suggestedReason ?? "removed") as "harvested" | "died" | "removed" | "relocated",
                      })),
                      growthUpdates: rescanDiff.growthUpdates.filter((p) => p.selected).map((p) => ({
                        plantId: p.plantId,
                        newStage: p.newStage,
                      })),
                    });
                  }}
                  disabled={applyRescanMutation.isPending}
                  className="w-full rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white hover:bg-[#246838] disabled:opacity-50"
                >
                  {applyRescanMutation.isPending ? "Applying..." : "Apply Changes"}
                </button>
              </div>
            )}

            <button
              onClick={() => {
                setShowRescan(false);
                setRescanDiff(null);
                setRescanPhotoPreview(null);
                setRescanPhotoBase64(null);
                setRescanPhotoKey(null);
              }}
              className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Expanded photo overlay */}
      {expandedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setExpandedPhoto(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <Photo
              src={expandedPhoto}
              alt="Photo"
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
            />
            <button
              onClick={() => setExpandedPhoto(null)}
              className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-600 shadow-md hover:bg-gray-100"
            >
              {"\u2715"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
