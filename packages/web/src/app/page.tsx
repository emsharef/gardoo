"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import { Photo } from "@/components/Photo";
import { resizeImage, uploadToR2 } from "@/lib/photo-upload";
import {
  parseWeatherData,
  weatherCodeToCondition,
  weatherCodeToIcon,
  deriveAlerts,
  fmtTemp,
  fmtWind,
  type Units,
} from "@/lib/weather";

const priorityColors: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 border-red-200",
  today: "bg-amber-100 text-amber-800 border-amber-200",
  upcoming: "bg-blue-100 text-blue-800 border-blue-200",
  informational: "bg-gray-100 text-gray-700 border-gray-200",
};

const actionIcons: Record<string, string> = {
  water: "💧",
  fertilize: "🧪",
  harvest: "🌾",
  prune: "✂️",
  plant: "🌱",
  monitor: "👁️",
  protect: "🛡️",
  other: "📝",
};

// ─── TaskCard ────────────────────────────────────────────────────────────────

interface TaskAction {
  id: string;
  zoneId: string;
  zoneName: string | null;
  targetType: string;
  targetId: string;
  targetName: string | null;
  targetPhotoUrl: string | null;
  actionType: string;
  priority: string;
  label: string;
  suggestedDate: string;
  context: string | null;
  recurrence: string | null;
  photoRequested: boolean;
}

function TaskCard({
  action,
  onCompleted,
}: {
  action: TaskAction;
  onCompleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const completeMutation = trpc.tasks.complete.useMutation();
  const getUploadUrlMutation = trpc.photos.getUploadUrl.useMutation();
  const updateZoneMutation = trpc.zones.update.useMutation();
  const updatePlantMutation = trpc.plants.update.useMutation();

  const handlePhotoSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const { blob, dataUrl } = await resizeImage(file);
        setPhotoPreview(dataUrl);
        const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
          targetType: "careLog",
          targetId: action.targetId,
          contentType: "image/jpeg",
        });
        await uploadToR2(uploadUrl, blob);
        setPhotoKey(key);
      } catch (err) {
        console.error("Photo upload failed:", err);
        setPhotoPreview(null);
        setPhotoKey(null);
      } finally {
        setUploading(false);
      }
    },
    [action.targetId, getUploadUrlMutation],
  );

  const handleComplete = useCallback(async () => {
    try {
      await completeMutation.mutateAsync({
        taskId: action.id,
        notes: notes.trim() || `Completed: ${action.label}`,
        photoUrl: photoKey ?? undefined,
      });

      // If a photo was uploaded and the target doesn't have one, associate it
      if (photoKey && !action.targetPhotoUrl) {
        try {
          if (action.targetType === "plant") {
            await updatePlantMutation.mutateAsync({
              id: action.targetId,
              photoUrl: photoKey,
            });
          } else {
            await updateZoneMutation.mutateAsync({
              id: action.zoneId,
              photoUrl: photoKey,
            });
          }
        } catch {
          // Non-critical — photo was already saved on the care log
        }
      }

      // Animate out
      setDismissing(true);
      setTimeout(() => {
        onCompleted();
      }, 400);
    } catch (err) {
      console.error("Failed to complete task:", err);
    }
  }, [
    action,
    notes,
    photoKey,
    completeMutation,
    updatePlantMutation,
    updateZoneMutation,
    onCompleted,
  ]);

  const targetLink =
    action.targetType === "plant"
      ? `/garden/${action.zoneId}/${action.targetId}`
      : `/garden/${action.zoneId}`;
  const targetLabel =
    action.targetType === "plant" ? action.targetName : action.zoneName;
  const parentLabel =
    action.targetType === "plant" && action.zoneName ? action.zoneName : null;

  return (
    <div
      ref={cardRef}
      className={`overflow-hidden rounded-xl border border-gray-200 bg-white transition-all duration-400 ease-in-out ${
        dismissing
          ? "max-h-0 opacity-0 scale-95 border-transparent -my-1.5"
          : "max-h-96 opacity-100 scale-100"
      }`}
    >
      {/* Main row */}
      <div className="flex items-center gap-4 p-4">
        <span
          className={`inline-flex w-24 shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium ${
            priorityColors[action.priority] ?? priorityColors.informational
          }`}
        >
          {action.priority}
        </span>

        {action.targetPhotoUrl ? (
          <Link href={targetLink} className="shrink-0">
            <Photo
              src={action.targetPhotoUrl}
              alt={targetLabel ?? ""}
              className="h-10 w-10 rounded-lg object-cover"
            />
          </Link>
        ) : (
          <span className="text-lg">
            {actionIcons[action.actionType] ?? "📝"}
          </span>
        )}

        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 truncate">{action.label}</p>
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            {targetLabel && (
              <Link
                href={targetLink}
                className="inline-flex items-center gap-1 font-medium text-[#2D7D46] hover:underline"
              >
                {action.targetType === "plant" ? "🌱" : "📍"}
                {targetLabel}
              </Link>
            )}
            {parentLabel && (
              <>
                <span className="text-gray-300">/</span>
                <Link
                  href={`/garden/${action.zoneId}`}
                  className="text-gray-500 hover:underline"
                >
                  {parentLabel}
                </Link>
              </>
            )}
          </div>
          {action.context && (
            <p className="text-sm text-gray-500 truncate">{action.context}</p>
          )}
        </div>

        {!expanded ? (
          <button
            onClick={() => setExpanded(true)}
            className="shrink-0 rounded-lg bg-[#2D7D46] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
          >
            Done
          </button>
        ) : (
          <button
            onClick={() => {
              setExpanded(false);
              setNotes("");
              setPhotoPreview(null);
              setPhotoKey(null);
            }}
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Expanded completion form */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          expanded ? "max-h-60 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes (optional)..."
            rows={2}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46] resize-none"
          />

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#2D7D46]" />
                    Uploading...
                  </>
                ) : (
                  <>📷 Add photo</>
                )}
              </button>
              {photoPreview && (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoPreview}
                    alt="Preview"
                    className="h-10 w-10 rounded-lg object-cover border border-gray-200"
                  />
                  <button
                    onClick={() => {
                      setPhotoPreview(null);
                      setPhotoKey(null);
                    }}
                    className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gray-600 text-[10px] text-white hover:bg-gray-800"
                  >
                    &times;
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleComplete}
              disabled={completeMutation.isPending || uploading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2D7D46] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
            >
              {completeMutation.isPending ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Saving...
                </>
              ) : (
                "Complete"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── HomePage ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { isAuthenticated } = useAuth();
  const gardensQuery = trpc.gardens.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const router = useRouter();

  useEffect(() => {
    if (!gardensQuery.isLoading && gardensQuery.data && gardensQuery.data.length === 0) {
      router.push("/onboarding");
    }
  }, [gardensQuery.isLoading, gardensQuery.data, router]);

  const gardenId = gardensQuery.data?.[0]?.id;

  const actionsQuery = trpc.gardens.getActions.useQuery(
    { gardenId: gardenId! },
    { enabled: !!gardenId },
  );

  const weatherQuery = trpc.gardens.getWeather.useQuery(
    { gardenId: gardenId! },
    { enabled: !!gardenId },
  );

  const settingsQuery = trpc.users.getSettings.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const units: Units = settingsQuery.data?.units ?? "metric";

  // Track dismissed task IDs locally so the slide-out animation completes
  // before we refetch (which would snap-remove the item).
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const handleTaskCompleted = useCallback(
    (taskId: string) => {
      setDismissedIds((prev) => new Set(prev).add(taskId));
      // Refetch after the animation finishes
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

  const isLoading = gardensQuery.isLoading;
  const actions = (actionsQuery.data ?? []).filter(
    (a) => !dismissedIds.has(a.id),
  );
  const weather = weatherQuery.data;
  const weatherData = parseWeatherData(weather?.forecast);
  const alerts = weatherData ? deriveAlerts(weatherData.daily) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Today</h1>

      {/* Weather Card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Weather
          </h2>
          {weatherData && (
            <a
              href="/weather"
              className="text-sm font-medium text-[#2D7D46] hover:underline"
            >
              Full forecast &rarr;
            </a>
          )}
        </div>
        {!gardenId ? (
          <p className="text-sm text-gray-400">
            No garden found. Create one in settings.
          </p>
        ) : weatherQuery.isLoading ? (
          <div className="h-12 animate-pulse rounded bg-gray-100" />
        ) : weatherData ? (
          <div className="space-y-3">
            {/* Current conditions */}
            <div className="flex items-center gap-4">
              <span className="text-4xl">
                {weatherCodeToIcon(weatherData.current.weatherCode)}
              </span>
              <div>
                <p className="text-3xl font-bold text-gray-900">
                  {fmtTemp(weatherData.current.temperature, units)}
                </p>
                <p className="text-sm text-gray-500">
                  Feels like {fmtTemp(weatherData.current.apparentTemperature, units)}
                  &middot; {weatherCodeToCondition(weatherData.current.weatherCode)}
                </p>
              </div>
              <div className="ml-auto text-right text-sm text-gray-500">
                <p>H: {fmtTemp(weatherData.daily[0]?.tempMax ?? 0, units)} L: {fmtTemp(weatherData.daily[0]?.tempMin ?? 0, units)}</p>
              </div>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-gray-100 pt-3 text-sm text-gray-600 sm:grid-cols-4">
              <p>Humidity: {weatherData.current.humidity}%</p>
              <p>UV: {Math.round(weatherData.current.uvIndex)}</p>
              <p>Wind: {fmtWind(weatherData.current.windSpeed, units)}</p>
              <p>Dew point: {fmtTemp(weatherData.current.dewPoint, units)}</p>
              <p>Soil temp: {fmtTemp(weatherData.current.soilTemperature0cm, units)}</p>
              <p>Soil moisture: {(weatherData.current.soilMoisture * 100).toFixed(0)}%</p>
            </div>

            {/* Alerts */}
            {alerts.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                {alerts.map((alert) => (
                  <span
                    key={alert.type}
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${alert.color}`}
                    title={alert.detail}
                  >
                    {alert.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            No weather data available yet. Run an analysis or wait for the daily job.
          </p>
        )}
      </div>

      {/* Actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Today&apos;s Tasks
        </h2>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl bg-white border border-gray-200"
              />
            ))}
          </div>
        ) : actions.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-400">
              {gardenId
                ? "No actions today. Your garden is in good shape!"
                : "Create a garden to see daily actions."}
            </p>
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
    </div>
  );
}
