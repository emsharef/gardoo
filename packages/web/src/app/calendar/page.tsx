"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import { Photo } from "@/components/Photo";

const ACTION_TYPES: Record<string, { label: string; emoji: string }> = {
  water: { label: "Water", emoji: "\uD83D\uDCA7" },
  fertilize: { label: "Fertilize", emoji: "\uD83E\uDEB4" },
  harvest: { label: "Harvest", emoji: "\uD83E\uDE78" },
  prune: { label: "Prune", emoji: "\u2702\uFE0F" },
  plant: { label: "Plant", emoji: "\uD83C\uDF31" },
  monitor: { label: "Monitor", emoji: "\uD83D\uDD0D" },
  protect: { label: "Protect", emoji: "\uD83D\uDEE1\uFE0F" },
  other: { label: "Other", emoji: "\uD83D\uDCDD" },
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const { isAuthenticated } = useAuth();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(
    today.getDate(),
  );

  const gardensQuery = trpc.gardens.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const gardenId = gardensQuery.data?.[0]?.id;

  // Fetch care logs for the current month
  const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDaysInMonth = getDaysInMonth(year, month);
  const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(endDaysInMonth).padStart(2, "0")}T23:59:59`;

  const careLogsQuery = trpc.careLogs.list.useQuery(
    {
      gardenId: gardenId!,
      startDate,
      endDate,
    },
    { enabled: !!gardenId },
  );

  // Fetch zones (with plants) for target name resolution
  const zonesQuery = trpc.zones.list.useQuery(
    { gardenId: gardenId! },
    { enabled: !!gardenId },
  );

  // Fetch actions for the garden
  const actionsQuery = trpc.gardens.getActions.useQuery(
    { gardenId: gardenId! },
    { enabled: !!gardenId },
  );

  const careLogs = careLogsQuery.data ?? [];
  const actions = actionsQuery.data ?? [];
  const zonesData = zonesQuery.data ?? [];

  // Build lookup: targetId -> { name, type, zoneId? }
  const targetLookup = useMemo(() => {
    const map: Record<string, { name: string; type: "zone" | "plant"; zoneId?: string }> = {};
    for (const zone of zonesData) {
      map[zone.id] = { name: zone.name, type: "zone" };
      for (const plant of zone.plants ?? []) {
        map[plant.id] = { name: plant.name, type: "plant", zoneId: zone.id };
      }
    }
    return map;
  }, [zonesData]);

  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);

  // Group care logs by day
  const logsByDay = useMemo(() => {
    const grouped: Record<number, typeof careLogs> = {};
    for (const log of careLogs) {
      const d = new Date(log.loggedAt).getDate();
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(log);
    }
    return grouped;
  }, [careLogs]);

  // Group actions by suggested date day
  const actionsByDay = useMemo(() => {
    const grouped: Record<number, typeof actions> = {};
    for (const action of actions) {
      if (action.suggestedDate) {
        const d = new Date(action.suggestedDate);
        if (d.getFullYear() === year && d.getMonth() === month) {
          const day = d.getDate();
          if (!grouped[day]) grouped[day] = [];
          grouped[day].push(action);
        }
      }
    }
    return grouped;
  }, [actions, year, month]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const isToday = (day: number) =>
    year === today.getFullYear() &&
    month === today.getMonth() &&
    day === today.getDate();

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
    setSelectedDay(null);
  };

  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
    setSelectedDay(null);
  };

  if (!isAuthenticated) return null;

  const selectedLogs = selectedDay ? logsByDay[selectedDay] ?? [] : [];
  const selectedActions = selectedDay ? actionsByDay[selectedDay] ?? [] : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>

      {/* Calendar */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        {/* Month navigation */}
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={prevMonth}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-gray-900">
            {MONTH_NAMES[month]} {year}
          </h2>
          <button
            onClick={nextMonth}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-px text-center">
          {DAY_NAMES.map((d) => (
            <div
              key={d}
              className="py-2 text-xs font-medium uppercase text-gray-400"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-px">
          {/* Empty cells for offset */}
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="h-12" />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const hasLogs = !!logsByDay[day];
            const hasActions = !!actionsByDay[day];
            const selected = selectedDay === day;

            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`flex h-12 flex-col items-center justify-center rounded-lg text-sm transition-colors ${
                  selected
                    ? "bg-[#2D7D46] text-white"
                    : isToday(day)
                      ? "bg-[#2D7D46]/10 font-semibold text-[#2D7D46]"
                      : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span>{day}</span>
                {(hasLogs || hasActions) && (
                  <div className="flex gap-0.5 mt-0.5">
                    {hasLogs && (
                      <span
                        className={`h-1 w-1 rounded-full ${
                          selected ? "bg-white" : "bg-[#2D7D46]"
                        }`}
                      />
                    )}
                    {hasActions && (
                      <span
                        className={`h-1 w-1 rounded-full ${
                          selected ? "bg-white" : "bg-amber-500"
                        }`}
                      />
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDay && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 font-semibold text-gray-900">
            {MONTH_NAMES[month]} {selectedDay}, {year}
          </h3>

          {selectedActions.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 text-xs font-semibold uppercase text-gray-400">
                Scheduled Actions
              </h4>
              <div className="space-y-2">
                {selectedActions.map((action, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm"
                  >
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {action.actionType}
                    </span>
                    <span className="text-gray-700">{action.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedLogs.length > 0 ? (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-gray-400">
                Care Logs
              </h4>
              <div className="space-y-2">
                {selectedLogs.map((log) => {
                  const target = targetLookup[log.targetId];
                  const actionInfo = ACTION_TYPES[log.actionType];
                  const targetLink = target
                    ? target.type === "zone"
                      ? `/garden/${log.targetId}`
                      : `/garden/${target.zoneId}/${log.targetId}`
                    : null;

                  return (
                    <div
                      key={log.id}
                      className="rounded-lg bg-gray-50 px-3 py-2.5 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{actionInfo?.emoji ?? "\uD83D\uDCDD"}</span>
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          {actionInfo?.label ?? log.actionType}
                        </span>
                        {target && target.type === "plant" && target.zoneId && targetLookup[target.zoneId] && (
                          <Link
                            href={`/garden/${target.zoneId}`}
                            className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-300 hover:text-gray-900"
                          >
                            {"\uD83C\uDF3F"} {targetLookup[target.zoneId].name}
                          </Link>
                        )}
                        {target && (
                          <Link
                            href={targetLink!}
                            className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-300 hover:text-gray-900"
                          >
                            {target.type === "plant" ? "\uD83C\uDF31" : "\uD83C\uDF3F"} {target.name}
                          </Link>
                        )}
                        <span className="flex-1" />
                        <time className="text-xs text-gray-400">
                          {new Date(log.loggedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </time>
                      </div>
                      {log.notes && (
                        <p className="mt-1 ml-9 text-sm text-gray-600">{log.notes}</p>
                      )}
                      {log.photoUrl && (
                        <button
                          onClick={() => setExpandedPhoto(log.photoUrl)}
                          className="mt-2 ml-9"
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
            </div>
          ) : selectedActions.length === 0 ? (
            <p className="text-sm text-gray-400">
              No events on this day.
            </p>
          ) : null}
        </div>
      )}

      {/* Expanded photo overlay */}
      {expandedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setExpandedPhoto(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <Photo
              src={expandedPhoto}
              alt="Care log photo"
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
