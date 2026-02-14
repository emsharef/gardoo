"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";

export default function GardenPage() {
  const { isAuthenticated } = useAuth();
  const gardensQuery = trpc.gardens.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const garden = gardensQuery.data?.[0];
  const gardenId = garden?.id;

  const zonesQuery = trpc.zones.list.useQuery(
    { gardenId: gardenId! },
    { enabled: !!gardenId },
  );

  const [showAddZone, setShowAddZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneSoil, setNewZoneSoil] = useState("");
  const [newZoneSun, setNewZoneSun] = useState("");

  const createZoneMutation = trpc.zones.create.useMutation({
    onSuccess() {
      zonesQuery.refetch();
      setShowAddZone(false);
      setNewZoneName("");
      setNewZoneSoil("");
      setNewZoneSun("");
    },
  });

  if (!isAuthenticated) return null;

  const zones = zonesQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Garden</h1>
          {garden && (
            <p className="text-sm text-gray-500">{garden.name}</p>
          )}
        </div>
        {gardenId && (
          <button
            onClick={() => setShowAddZone(true)}
            className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
          >
            Add Zone
          </button>
        )}
      </div>

      {/* Add Zone Form */}
      {showAddZone && gardenId && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 font-semibold text-gray-900">New Zone</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              placeholder="Zone name"
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
            <input
              placeholder="Soil type (optional)"
              value={newZoneSoil}
              onChange={(e) => setNewZoneSoil(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
            <input
              placeholder="Sun exposure (optional)"
              value={newZoneSun}
              onChange={(e) => setNewZoneSun(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                if (!newZoneName.trim()) return;
                createZoneMutation.mutate({
                  gardenId,
                  name: newZoneName.trim(),
                  soilType: newZoneSoil || undefined,
                  sunExposure: newZoneSun || undefined,
                });
              }}
              disabled={createZoneMutation.isPending || !newZoneName.trim()}
              className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
            >
              {createZoneMutation.isPending ? "Creating..." : "Create Zone"}
            </button>
            <button
              onClick={() => setShowAddZone(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Zone Grid */}
      {gardensQuery.isLoading || zonesQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl border border-gray-200 bg-white"
            />
          ))}
        </div>
      ) : !gardenId ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-400">
            No garden found. Create one in settings.
          </p>
        </div>
      ) : zones.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-400">
            No zones yet. Add your first zone to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {zones.map((zone) => (
            <Link
              key={zone.id}
              href={`/garden/${zone.id}`}
              className="group rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-md"
            >
              {/* Photo or placeholder */}
              <div className="flex h-32 items-center justify-center rounded-t-xl bg-gradient-to-br from-green-50 to-emerald-100">
                {zone.photoUrl ? (
                  <img
                    src={zone.photoUrl}
                    alt={zone.name}
                    className="h-full w-full rounded-t-xl object-cover"
                  />
                ) : (
                  <span className="text-4xl">🌿</span>
                )}
              </div>

              <div className="p-4">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-gray-900 group-hover:text-[#2D7D46]">
                    {zone.name}
                  </h3>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    {zone.plants?.length ?? 0} plants
                  </span>
                </div>
                <div className="mt-1 flex gap-3 text-xs text-gray-500">
                  {zone.soilType && <span>{zone.soilType}</span>}
                  {zone.sunExposure && <span>{zone.sunExposure}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
