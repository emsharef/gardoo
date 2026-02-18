"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import {
  parseWeatherData,
  weatherCodeToCondition,
  weatherCodeToIcon,
  deriveAlerts,
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

  const logMutation = trpc.careLogs.create.useMutation({
    onSuccess() {
      actionsQuery.refetch();
    },
  });

  if (!isAuthenticated) return null;

  const isLoading = gardensQuery.isLoading;
  const actions = actionsQuery.data ?? [];
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
                  {Math.round(weatherData.current.temperature)}°C
                </p>
                <p className="text-sm text-gray-500">
                  Feels like {Math.round(weatherData.current.apparentTemperature)}°C
                  &middot; {weatherCodeToCondition(weatherData.current.weatherCode)}
                </p>
              </div>
              <div className="ml-auto text-right text-sm text-gray-500">
                <p>H: {Math.round(weatherData.daily[0]?.tempMax ?? 0)}° L: {Math.round(weatherData.daily[0]?.tempMin ?? 0)}°</p>
              </div>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-gray-100 pt-3 text-sm text-gray-600 sm:grid-cols-4">
              <p>Humidity: {weatherData.current.humidity}%</p>
              <p>UV: {Math.round(weatherData.current.uvIndex)}</p>
              <p>Wind: {Math.round(weatherData.current.windSpeed)} km/h</p>
              <p>Dew point: {Math.round(weatherData.current.dewPoint)}°C</p>
              <p>Soil temp: {Math.round(weatherData.current.soilTemperature0cm)}°C</p>
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
            {actions.map((action, idx) => (
              <div
                key={`${action.targetId}-${action.actionType}-${idx}`}
                className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4"
              >
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                    priorityColors[action.priority] ?? priorityColors.informational
                  }`}
                >
                  {action.priority}
                </span>

                <span className="text-lg">
                  {actionIcons[action.actionType] ?? "📝"}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {action.label}
                  </p>
                  {action.context && (
                    <p className="text-sm text-gray-500 truncate">
                      {action.context}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => {
                    logMutation.mutate({
                      targetType: action.targetType as "zone" | "plant",
                      targetId: action.targetId,
                      actionType: action.actionType as
                        | "water"
                        | "fertilize"
                        | "harvest"
                        | "prune"
                        | "plant"
                        | "monitor"
                        | "protect"
                        | "other",
                      notes: `Completed: ${action.label}`,
                    });
                  }}
                  disabled={logMutation.isPending}
                  className="shrink-0 rounded-lg bg-[#2D7D46] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
                >
                  Done
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
