"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import { Photo } from "@/components/Photo";

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
          <Link
            href="/garden/new-zone"
            className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
          >
            Add Zone
          </Link>
        )}
      </div>

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
                  <Photo
                    src={zone.photoUrl}
                    alt={zone.name}
                    className="h-full w-full rounded-t-xl object-cover"
                  />
                ) : (
                  <span className="text-4xl">{"\uD83C\uDF3F"}</span>
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
