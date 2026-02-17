"use client";

import { useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import { Photo } from "@/components/Photo";
import { resizeImage, uploadToR2 } from "@/lib/photo-upload";

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

export default function ZoneDetailPage() {
  const { zoneId } = useParams<{ zoneId: string }>();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  const zoneQuery = trpc.zones.get.useQuery(
    { id: zoneId },
    { enabled: isAuthenticated && !!zoneId },
  );

  const careLogsQuery = trpc.careLogs.list.useQuery(
    { targetType: "zone", targetId: zoneId },
    { enabled: isAuthenticated && !!zoneId },
  );

  const sensorsQuery = trpc.sensors.list.useQuery(
    { zoneId },
    { enabled: isAuthenticated && !!zoneId },
  );

  /* Add plant state */
  const [showAddPlant, setShowAddPlant] = useState(false);
  const [plantName, setPlantName] = useState("");
  const [plantVariety, setPlantVariety] = useState("");

  /* Edit zone state */
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editZoneType, setEditZoneType] = useState("");
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

  /* Mutations */
  const createPlantMutation = trpc.plants.create.useMutation({
    onSuccess() {
      zoneQuery.refetch();
      setShowAddPlant(false);
      setPlantName("");
      setPlantVariety("");
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

  const handleSaveEdit = useCallback(() => {
    const updates: Record<string, string | undefined> = {
      name: editName.trim() || undefined,
      zoneType: editZoneType || undefined,
      soilType: editSoilType || undefined,
      sunExposure: editSunExposure || undefined,
      notes: editNotes || undefined,
    };
    if (photoChanged) {
      updates.photoUrl = editPhotoKey || undefined;
    }
    updateZoneMutation.mutate({ id: zoneId, ...updates });
  }, [zoneId, editName, editZoneType, editSoilType, editSunExposure, editNotes, editPhotoKey, photoChanged, updateZoneMutation]);

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

  if (!isAuthenticated) return null;

  const zone = zoneQuery.data;
  const careLogs = careLogsQuery.data ?? [];
  const sensors = sensorsQuery.data ?? [];

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
          <div className="flex h-40 items-center justify-center rounded-t-xl bg-gradient-to-br from-green-50 to-emerald-100">
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

      {/* Plants */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Plants
          </h2>
          <button
            onClick={() => setShowAddPlant(true)}
            className="rounded-lg bg-[#2D7D46] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
          >
            Add Plant
          </button>
        </div>

        {showAddPlant && (
          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                placeholder="Plant name"
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
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  if (!plantName.trim()) return;
                  createPlantMutation.mutate({
                    zoneId,
                    name: plantName.trim(),
                    variety: plantVariety || undefined,
                  });
                }}
                disabled={createPlantMutation.isPending || !plantName.trim()}
                className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
              >
                {createPlantMutation.isPending ? "Adding..." : "Add Plant"}
              </button>
              <button
                onClick={() => setShowAddPlant(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
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

      {/* Sensor Readings */}
      {sensors.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Sensors
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sensors.map((sensor) => {
              const reading = sensor.lastReading as {
                value: number;
                unit: string;
              } | null;
              return (
                <div
                  key={sensor.id}
                  className="rounded-xl border border-gray-200 bg-white p-4"
                >
                  <p className="text-sm font-medium text-gray-500">
                    {sensor.sensorType}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {reading
                      ? `${reading.value}${reading.unit}`
                      : "--"}
                  </p>
                  <p className="text-xs text-gray-400">
                    {sensor.haEntityId}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Care Logs */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Recent Care Logs
          </h2>
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
            {careLogs.slice(0, 10).map((log) => {
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

      {/* Expanded photo overlay */}
      {expandedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setExpandedPhoto(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <Photo
              src={expandedPhoto}
              alt="Care log photo"
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
