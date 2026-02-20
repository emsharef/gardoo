"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { resizeImage, uploadToR2 } from "@/lib/photo-upload";

export const priorityColors: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 border-red-200",
  today: "bg-amber-100 text-amber-800 border-amber-200",
  upcoming: "bg-blue-100 text-blue-800 border-blue-200",
  informational: "bg-gray-100 text-gray-700 border-gray-200",
};

export const actionIcons: Record<string, string> = {
  water: "💧",
  fertilize: "🧪",
  harvest: "🌾",
  prune: "✂️",
  plant: "🌱",
  monitor: "👁️",
  protect: "🛡️",
  other: "📝",
};

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round(
      (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays === -1) return "Yesterday";
    if (diffDays > 1 && diffDays <= 6) {
      return date.toLocaleDateString(undefined, { weekday: "short" });
    }
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// ─── TaskCard ────────────────────────────────────────────────────────────────

export interface TaskAction {
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

export function TaskCard({
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
  const dismissMutation = trpc.tasks.dismiss.useMutation();
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
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 text-xl leading-none shrink-0">
          {actionIcons[action.actionType] ?? "📝"}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-gray-900">{action.label}</p>
            {!expanded ? (
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => {
                    dismissMutation.mutate({ taskId: action.id });
                    setDismissing(true);
                    setTimeout(() => onCompleted(), 400);
                  }}
                  disabled={dismissMutation.isPending}
                  className="rounded-lg border border-gray-300 px-2.5 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  Ignore
                </button>
                <button
                  onClick={() => setExpanded(true)}
                  className="rounded-lg bg-[#2D7D46] px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
                >
                  Done
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setExpanded(false);
                  setNotes("");
                  setPhotoPreview(null);
                  setPhotoKey(null);
                }}
                className="shrink-0 rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                priorityColors[action.priority] ?? priorityColors.informational
              }`}
            >
              {action.priority}
            </span>
            {action.suggestedDate && (
              <span className="text-xs text-gray-400">
                {formatDate(action.suggestedDate)}
              </span>
            )}
            {targetLabel && (
              <Link
                href={targetLink}
                className="inline-flex items-center gap-0.5 font-medium text-[#2D7D46] hover:underline"
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
            <p className="mt-0.5 text-sm text-gray-500 line-clamp-2">{action.context}</p>
          )}
        </div>
      </div>

      {/* Expanded completion form — single row */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          expanded ? "max-h-32 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 pb-3 pt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoSelect}
            className="hidden"
          />
          {photoPreview ? (
            <button
              onClick={() => { setPhotoPreview(null); setPhotoKey(null); }}
              className="relative shrink-0"
              title="Remove photo"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview}
                alt="Preview"
                className="h-9 w-9 rounded-lg object-cover border border-gray-200"
              />
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-600 text-[8px] text-white">
                &times;
              </span>
            </button>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border-2 border-dashed border-[#2D7D46]/40 bg-[#2D7D46]/5 px-3 py-1.5 text-sm font-medium text-[#2D7D46] transition-colors hover:border-[#2D7D46]/60 hover:bg-[#2D7D46]/10 disabled:opacity-50"
              title="Add photo"
            >
              {uploading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#2D7D46]/30 border-t-[#2D7D46]" />
              ) : (
                <>📷 Photo</>
              )}
            </button>
          )}

          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !completeMutation.isPending && !uploading) {
                handleComplete();
              }
            }}
          />

          <button
            onClick={handleComplete}
            disabled={completeMutation.isPending || uploading}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#2D7D46] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
          >
            {completeMutation.isPending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              "Complete"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
