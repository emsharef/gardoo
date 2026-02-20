"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import { TaskCard } from "@/components/TaskCard";
import {
  parseWeatherData,
  weatherCodeToCondition,
  weatherCodeToIcon,
  deriveAlerts,
  fmtTemp,
  fmtWind,
  type Units,
} from "@/lib/weather";

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
