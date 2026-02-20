"use client";

import { useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import { Photo } from "@/components/Photo";
import { TaskCard } from "@/components/TaskCard";
import { resizeImage, uploadToR2 } from "@/lib/photo-upload";

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

type Tab = "careLogs" | "tasks" | "photos";

const TABS: { key: Tab; label: string }[] = [
  { key: "tasks", label: "Tasks" },
  { key: "careLogs", label: "Care Logs" },
  { key: "photos", label: "Photos" },
];

export default function PlantDetailPage() {
  const { zoneId, plantId } = useParams<{ zoneId: string; plantId: string }>();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState<Tab>("tasks");

  const plantQuery = trpc.plants.get.useQuery(
    { id: plantId },
    { enabled: isAuthenticated && !!plantId },
  );

  const gardenId = plantQuery.data?.zone?.garden?.id;

  const careLogsQuery = trpc.careLogs.list.useQuery(
    { targetType: "plant", targetId: plantId },
    { enabled: isAuthenticated && !!plantId },
  );

  const actionsQuery = trpc.gardens.getActions.useQuery(
    { gardenId: gardenId!, plantId },
    { enabled: !!gardenId },
  );

  /* Edit state */
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editVariety, setEditVariety] = useState("");
  const [editSpecies, setEditSpecies] = useState("");
  const [editGrowthStage, setEditGrowthStage] = useState("");
  const [editDatePlanted, setEditDatePlanted] = useState("");
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

  /* Mutations */
  const updatePlantMutation = trpc.plants.update.useMutation({
    onSuccess() {
      plantQuery.refetch();
      setEditing(false);
      setPhotoChanged(false);
    },
  });

  const deletePlantMutation = trpc.plants.delete.useMutation({
    async onSuccess() {
      await utils.zones.get.invalidate({ id: zoneId });
      await utils.zones.list.invalidate();
      router.push(`/garden/${zoneId}`);
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
          targetId: plantId,
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
    [plantId, getUploadUrlMutation]
  );

  const startEditing = useCallback(() => {
    if (!plantQuery.data) return;
    const p = plantQuery.data;
    setEditName(p.name);
    setEditVariety(p.variety ?? "");
    setEditSpecies(p.species ?? "");
    setEditGrowthStage(p.growthStage ?? "");
    setEditDatePlanted(p.datePlanted ? new Date(p.datePlanted).toISOString().split("T")[0] : "");
    setEditPhotoPreview(p.photoUrl ?? null);
    setEditPhotoKey(null);
    setPhotoChanged(false);
    setEditing(true);
  }, [plantQuery.data]);

  const handleEditPhotoUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { blob, dataUrl } = await resizeImage(file);
        setEditPhotoPreview(dataUrl);
        setPhotoChanged(true);
        const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
          targetType: "plant",
          targetId: plantId,
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
    [plantId, getUploadUrlMutation]
  );

  const handleSaveEdit = useCallback(() => {
    const updates: Record<string, string | undefined> = {
      name: editName.trim() || undefined,
      variety: editVariety || undefined,
      species: editSpecies || undefined,
      growthStage: editGrowthStage || undefined,
      datePlanted: editDatePlanted || undefined,
    };
    if (photoChanged) {
      updates.photoUrl = editPhotoKey || undefined;
    }
    updatePlantMutation.mutate({ id: plantId, ...updates });
  }, [plantId, editName, editVariety, editSpecies, editGrowthStage, editDatePlanted, editPhotoKey, photoChanged, updatePlantMutation]);

  const handleDelete = useCallback(() => {
    deletePlantMutation.mutate({ id: plantId });
  }, [plantId, deletePlantMutation]);

  const handleCreateCareLog = useCallback(() => {
    if (!logActionType) return;
    createCareLogMutation.mutate({
      targetType: "plant",
      targetId: plantId,
      actionType: logActionType as "water" | "fertilize" | "harvest" | "prune" | "plant" | "monitor" | "protect" | "other",
      notes: logNotes || undefined,
      photoUrl: logPhotoKey || undefined,
    });
  }, [plantId, logActionType, logNotes, logPhotoKey, createCareLogMutation]);

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

  const plant = plantQuery.data;
  const careLogs = careLogsQuery.data ?? [];
  const actions = (actionsQuery.data ?? []).filter((a) => !dismissedIds.has(a.id));

  // Collect all photos for the Photos tab
  const allPhotos: { url: string; label: string; date?: string }[] = [];
  if (plant?.photoUrl) {
    allPhotos.push({ url: plant.photoUrl, label: `${plant.name} (profile photo)` });
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

  if (plantQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="h-48 animate-pulse rounded-xl bg-white border border-gray-200" />
      </div>
    );
  }

  if (!plant) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-400">Plant not found.</p>
        <Link href={`/garden/${zoneId}`} className="mt-2 inline-block text-sm text-[#2D7D46] hover:underline">
          Back to zone
        </Link>
      </div>
    );
  }

  const zoneName = plant.zone?.name ?? "Zone";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/garden" className="hover:text-[#2D7D46]">Garden</Link>
        <span>/</span>
        <Link href={`/garden/${zoneId}`} className="hover:text-[#2D7D46]">{zoneName}</Link>
        <span>/</span>
        <span className="text-gray-900">{plant.name}</span>
      </div>

      {/* Plant Header */}
      {editing ? (
        /* ---- Edit Mode ---- */
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Edit Plant</h2>
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
                  alt="Plant preview"
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

          {/* Variety */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Variety</label>
            <input
              value={editVariety}
              onChange={(e) => setEditVariety(e.target.value)}
              placeholder="e.g. Roma, Cherry, Beefsteak"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>

          {/* Species */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Species</label>
            <input
              value={editSpecies}
              onChange={(e) => setEditSpecies(e.target.value)}
              placeholder="e.g. Solanum lycopersicum"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>

          {/* Growth Stage */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Growth Stage</label>
            <select
              value={editGrowthStage}
              onChange={(e) => setEditGrowthStage(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            >
              <option value="">Not set</option>
              {GROWTH_STAGES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Date Planted */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Date Planted</label>
            <input
              type="date"
              value={editDatePlanted}
              onChange={(e) => setEditDatePlanted(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>

          {/* Save */}
          <button
            onClick={handleSaveEdit}
            disabled={updatePlantMutation.isPending || !editName.trim()}
            className="w-full rounded-lg bg-[#2D7D46] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
          >
            {updatePlantMutation.isPending ? "Saving..." : "Save Changes"}
          </button>
          {updatePlantMutation.isError && (
            <p className="text-sm text-red-600">Failed to update plant. Please try again.</p>
          )}
        </div>
      ) : (
        /* ---- View Mode ---- */
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="flex h-40 items-center justify-center rounded-t-xl bg-gradient-to-br from-lime-50 to-green-100">
            {plant.photoUrl ? (
              <Photo
                src={plant.photoUrl}
                alt={plant.name}
                className="h-full w-full rounded-t-xl object-cover"
              />
            ) : (
              <span className="text-5xl">{"\uD83C\uDF31"}</span>
            )}
          </div>
          <div className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{plant.name}</h1>
                {plant.variety && (
                  <p className="text-sm text-gray-500">{plant.variety}</p>
                )}
              </div>
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

            <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-500">
              {plant.species && (
                <span className="flex items-center gap-1">
                  <span className="font-medium">Species:</span> {plant.species}
                </span>
              )}
              {plant.growthStage && (
                <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                  {plant.growthStage}
                </span>
              )}
              {plant.datePlanted && (
                <span className="flex items-center gap-1">
                  <span className="font-medium">Planted:</span>{" "}
                  {new Date(plant.datePlanted).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Delete confirmation */}
            {confirmingDelete && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-800">
                  Delete &quot;{plant.name}&quot;?
                </p>
                <p className="mt-1 text-sm text-red-600">
                  This will permanently remove this plant and all its care logs.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deletePlantMutation.isPending}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    {deletePlantMutation.isPending ? "Deleting..." : "Yes, Delete Plant"}
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
                {deletePlantMutation.isError && (
                  <p className="mt-2 text-sm text-red-600">Failed to delete. Please try again.</p>
                )}
              </div>
            )}
          </div>
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
                <p className="text-gray-400">No pending tasks for this plant.</p>
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
                <p className="text-gray-400">No photos yet. Add photos via care logs or plant editing.</p>
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
