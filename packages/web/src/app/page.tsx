"use client";

import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";

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
  const forecast = weather?.forecast as Record<string, unknown> | null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Today</h1>

      {/* Weather Card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Weather
        </h2>
        {!gardenId ? (
          <p className="text-sm text-gray-400">
            No garden found. Create one in settings.
          </p>
        ) : weatherQuery.isLoading ? (
          <div className="h-12 animate-pulse rounded bg-gray-100" />
        ) : forecast ? (
          <div className="flex items-center gap-6">
            <div>
              <p className="text-3xl font-bold text-gray-900">
                {String(forecast.temp_f ?? forecast.temp ?? "--")}
                {forecast.temp_f ? "°F" : forecast.temp ? "°" : ""}
              </p>
              <p className="text-sm text-gray-500">
                {String(forecast.condition ?? forecast.description ?? "No data")}
              </p>
            </div>
            {(forecast.humidity != null || forecast.wind != null) && (
              <div className="border-l border-gray-200 pl-6 text-sm text-gray-500">
                {forecast.humidity != null && (
                  <p>Humidity: {String(forecast.humidity)}%</p>
                )}
                {forecast.wind != null && (
                  <p>Wind: {String(forecast.wind)}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            No weather data available yet.
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
