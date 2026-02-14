"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";

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

  // Fetch actions for the garden
  const actionsQuery = trpc.gardens.getActions.useQuery(
    { gardenId: gardenId! },
    { enabled: !!gardenId },
  );

  const careLogs = careLogsQuery.data ?? [];
  const actions = actionsQuery.data ?? [];

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
                {selectedLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm"
                  >
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      {log.actionType}
                    </span>
                    <span className="flex-1 text-gray-700 truncate">
                      {log.notes || "No notes"}
                    </span>
                    <time className="text-xs text-gray-400">
                      {new Date(log.loggedAt).toLocaleTimeString()}
                    </time>
                  </div>
                ))}
              </div>
            </div>
          ) : selectedActions.length === 0 ? (
            <p className="text-sm text-gray-400">
              No events on this day.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
