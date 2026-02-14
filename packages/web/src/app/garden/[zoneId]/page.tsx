"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";

export default function ZoneDetailPage() {
  const { zoneId } = useParams<{ zoneId: string }>();
  const { isAuthenticated } = useAuth();

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

  const [showAddPlant, setShowAddPlant] = useState(false);
  const [plantName, setPlantName] = useState("");
  const [plantVariety, setPlantVariety] = useState("");

  const createPlantMutation = trpc.plants.create.useMutation({
    onSuccess() {
      zoneQuery.refetch();
      setShowAddPlant(false);
      setPlantName("");
      setPlantVariety("");
    },
  });

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
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex h-40 items-center justify-center rounded-t-xl bg-gradient-to-br from-green-50 to-emerald-100">
          {zone.photoUrl ? (
            <img
              src={zone.photoUrl}
              alt={zone.name}
              className="h-full w-full rounded-t-xl object-cover"
            />
          ) : (
            <span className="text-5xl">🌿</span>
          )}
        </div>
        <div className="p-5">
          <h1 className="text-2xl font-bold text-gray-900">{zone.name}</h1>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
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
        </div>
      </div>

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
              <div
                key={plant.id}
                className="rounded-xl border border-gray-200 bg-white"
              >
                <div className="flex h-28 items-center justify-center rounded-t-xl bg-gradient-to-br from-lime-50 to-green-100">
                  {plant.photoUrl ? (
                    <img
                      src={plant.photoUrl}
                      alt={plant.name}
                      className="h-full w-full rounded-t-xl object-cover"
                    />
                  ) : (
                    <span className="text-3xl">🌱</span>
                  )}
                </div>
                <div className="p-3">
                  <h3 className="font-semibold text-gray-900">{plant.name}</h3>
                  {plant.variety && (
                    <p className="text-xs text-gray-500">{plant.variety}</p>
                  )}
                  {plant.growthStage && (
                    <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      {plant.growthStage}
                    </span>
                  )}
                </div>
              </div>
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
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Recent Care Logs
        </h2>
        {careLogsQuery.isLoading ? (
          <div className="h-16 animate-pulse rounded-xl bg-white border border-gray-200" />
        ) : careLogs.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-sm text-gray-400">No care logs yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {careLogs.slice(0, 10).map((log) => (
              <div
                key={log.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {log.actionType}
                </span>
                <p className="flex-1 text-sm text-gray-700 truncate">
                  {log.notes || "No notes"}
                </p>
                <time className="text-xs text-gray-400">
                  {new Date(log.loggedAt).toLocaleDateString()}
                </time>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
