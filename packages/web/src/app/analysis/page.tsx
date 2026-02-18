"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";

const priorityColors: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 border-red-200",
  today: "bg-amber-100 text-amber-800 border-amber-200",
  upcoming: "bg-blue-100 text-blue-800 border-blue-200",
  informational: "bg-gray-100 text-gray-700 border-gray-200",
};

const actionIcons: Record<string, string> = {
  water: "\u{1F4A7}",
  fertilize: "\u{1F9EA}",
  harvest: "\u{1F33E}",
  prune: "\u2702\uFE0F",
  plant: "\u{1F331}",
  monitor: "\u{1F441}\uFE0F",
  protect: "\u{1F6E1}\uFE0F",
  other: "\u{1F4DD}",
};

export default function AnalysisPage() {
  const { isAuthenticated } = useAuth();
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [contextZoneId, setContextZoneId] = useState<string | null>(null);
  const prevRunningRef = useRef(false);

  const gardensQuery = trpc.gardens.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const gardenId = gardensQuery.data?.[0]?.id;

  const statusQuery = trpc.gardens.getAnalysisStatus.useQuery(
    { gardenId: gardenId! },
    {
      enabled: !!gardenId,
      refetchInterval: (query) => {
        // Poll every 3s while running, otherwise every 30s
        return query.state.data?.running ? 3000 : 30000;
      },
    },
  );

  const resultsQuery = trpc.gardens.getAnalysisResults.useQuery(
    { gardenId: gardenId! },
    { enabled: !!gardenId },
  );

  // Refetch results when analysis finishes (running transitions to not-running)
  const isRunning = statusQuery.data?.running ?? false;
  useEffect(() => {
    if (prevRunningRef.current && !isRunning) {
      resultsQuery.refetch();
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, resultsQuery]);

  const contextQuery = trpc.gardens.getAnalysisContext.useQuery(
    { gardenId: gardenId!, zoneId: contextZoneId! },
    { enabled: !!gardenId && !!contextZoneId },
  );

  const triggerMutation = trpc.gardens.triggerAnalysis.useMutation({
    onSuccess() {
      // Immediately check status so the banner appears
      statusQuery.refetch();
    },
  });

  if (!isAuthenticated) return null;

  const results = resultsQuery.data ?? [];
  const zones = gardensQuery.data?.[0]?.zones ?? [];
  const zoneMap = new Map(zones.map((z) => [z.id, z.name]));
  const pendingJobs = statusQuery.data?.pendingJobs ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Analysis</h1>
        <button
          onClick={() => {
            if (gardenId) triggerMutation.mutate({ gardenId });
          }}
          disabled={!gardenId || triggerMutation.isPending || isRunning}
          className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
        >
          {triggerMutation.isPending
            ? "Queuing..."
            : isRunning
              ? "Analysis Running..."
              : "Run Analysis Now"}
        </button>
      </div>

      {/* Running banner */}
      {isRunning && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          <div>
            <p className="font-medium text-amber-900">Analysis in progress</p>
            <p className="text-sm text-amber-700">
              {pendingJobs} job{pendingJobs !== 1 ? "s" : ""} remaining. Results
              will appear automatically when complete.
            </p>
          </div>
        </div>
      )}

      {/* Results List */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Recent Results
        </h2>

        {resultsQuery.isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-xl border border-gray-200 bg-white"
              />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-400">
              {gardenId
                ? "No analysis results yet. Click 'Run Analysis Now' to generate."
                : "Create a garden first to run analysis."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {results.map((result) => {
              const isExpanded = expandedResult === result.id;
              const zoneName = result.targetId
                ? zoneMap.get(result.targetId) ?? "Unknown zone"
                : "Garden-level";
              const analysisResult = result.result;
              const tokens = result.tokensUsed as {
                input: number;
                output: number;
              } | null;

              return (
                <div
                  key={result.id}
                  className="rounded-xl border border-gray-200 bg-white"
                >
                  {/* Header — always visible */}
                  <button
                    onClick={() =>
                      setExpandedResult(isExpanded ? null : result.id)
                    }
                    className="flex w-full items-center gap-4 p-4 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {zoneName}
                        </span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {result.scope}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                        {result.modelUsed && <span>{result.modelUsed}</span>}
                        {tokens && (
                          <span>
                            {tokens.input + tokens.output} tokens
                          </span>
                        )}
                        <span>
                          {new Date(result.generatedAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && analysisResult && (
                    <div className="border-t border-gray-100 p-4 space-y-4">
                      {/* Operations */}
                      {analysisResult.operations &&
                        analysisResult.operations.length > 0 && (
                          <div>
                            <h3 className="mb-2 text-sm font-semibold text-gray-700">
                              Operations ({analysisResult.operations.length})
                            </h3>
                            <div className="space-y-2">
                              {analysisResult.operations.map((op: any, i: number) => (
                                <div
                                  key={i}
                                  className="flex items-start gap-3 rounded-lg bg-gray-50 p-3"
                                >
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                    op.op === "create" ? "bg-green-100 text-green-700" :
                                    op.op === "update" ? "bg-blue-100 text-blue-700" :
                                    op.op === "complete" ? "bg-gray-100 text-gray-600" :
                                    "bg-red-100 text-red-700"
                                  }`}>
                                    {op.op}
                                  </span>
                                  {op.priority && (
                                    <span
                                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                                        priorityColors[op.priority] ??
                                        priorityColors.informational
                                      }`}
                                    >
                                      {op.priority}
                                    </span>
                                  )}
                                  {op.actionType && (
                                    <span className="text-lg">
                                      {actionIcons[op.actionType] ?? "\u{1F4DD}"}
                                    </span>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    {op.label && (
                                      <p className="font-medium text-gray-900 truncate">
                                        {op.label}
                                      </p>
                                    )}
                                    {op.context && (
                                      <p className="text-sm text-gray-500 truncate">
                                        {op.context}
                                      </p>
                                    )}
                                    {op.reason && (
                                      <p className="text-sm text-gray-500 italic truncate">
                                        Reason: {op.reason}
                                      </p>
                                    )}
                                    {op.taskId && (
                                      <p className="text-xs text-gray-400 truncate">
                                        Task: {op.taskId}
                                      </p>
                                    )}
                                    {op.suggestedDate && (
                                      <p className="text-xs text-gray-400">
                                        {op.suggestedDate}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      {/* Observations */}
                      {analysisResult.observations &&
                        analysisResult.observations.length > 0 && (
                          <div>
                            <h3 className="mb-2 text-sm font-semibold text-gray-700">
                              Observations
                            </h3>
                            <ul className="space-y-1">
                              {analysisResult.observations.map((obs, idx) => (
                                <li
                                  key={idx}
                                  className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900"
                                >
                                  {obs}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                      {/* Alerts */}
                      {analysisResult.alerts &&
                        analysisResult.alerts.length > 0 && (
                          <div>
                            <h3 className="mb-2 text-sm font-semibold text-gray-700">
                              Alerts
                            </h3>
                            <ul className="space-y-1">
                              {analysisResult.alerts.map((alert, idx) => (
                                <li
                                  key={idx}
                                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900"
                                >
                                  {alert}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                      {/* Context Viewer */}
                      {result.targetId && (
                        <div className="border-t border-gray-100 pt-4">
                          {contextZoneId === result.targetId ? (
                            <div>
                              <h3 className="mb-2 text-sm font-semibold text-gray-700">
                                Analysis Context (what the AI received)
                              </h3>
                              {contextQuery.isLoading ? (
                                <div className="h-32 animate-pulse rounded-lg bg-gray-100" />
                              ) : contextQuery.data ? (
                                <pre className="max-h-96 overflow-auto rounded-lg bg-gray-900 p-4 text-xs text-green-400">
                                  {JSON.stringify(contextQuery.data, null, 2)}
                                </pre>
                              ) : (
                                <p className="text-sm text-gray-400">
                                  Failed to load context.
                                </p>
                              )}
                              <button
                                onClick={() => setContextZoneId(null)}
                                className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                              >
                                Hide context
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() =>
                                setContextZoneId(result.targetId!)
                              }
                              className="text-sm text-[#2D7D46] hover:underline"
                            >
                              View analysis context
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
