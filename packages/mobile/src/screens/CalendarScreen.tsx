import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Calendar, type DateData } from "react-native-calendars";
import type { MarkedDates } from "react-native-calendars/src/types";
import { trpc } from "../lib/trpc";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CalendarEvent {
  id: string;
  type: "action" | "careLog";
  label: string;
  actionType: string;
  priority?: string;
  targetName?: string;
  date: string; // YYYY-MM-DD
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const GARDEN_GREEN = "#2D7D46";

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#D32F2F",
  today: "#E6A817",
  upcoming: "#1976D2",
  informational: "#9E9E9E",
};

const ACTION_ICONS: Record<string, { name: string; color: string }> = {
  water: { name: "tint", color: "#1976D2" },
  fertilize: { name: "flask", color: "#7B1FA2" },
  harvest: { name: "shopping-basket", color: "#E65100" },
  prune: { name: "cut", color: "#2D7D46" },
  plant: { name: "leaf", color: "#388E3C" },
  monitor: { name: "eye", color: "#455A64" },
  protect: { name: "shield", color: "#C62828" },
  other: { name: "ellipsis-h", color: "#777" },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Return { year, month } for a given YYYY-MM-DD string */
function parseMonth(dateStr: string) {
  const [year, month] = dateStr.split("-").map(Number);
  return { year: year!, month: month! };
}

/** First day of a month as YYYY-MM-DD */
function monthStart(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Last day of a month as YYYY-MM-DD */
function monthEnd(year: number, month: number) {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  CalendarScreen                                                     */
/* ------------------------------------------------------------------ */

export default function CalendarScreen() {
  const today = todayString();
  const [selectedDate, setSelectedDate] = useState(today);
  const [visibleMonth, setVisibleMonth] = useState(parseMonth(today));

  // ---- Data fetching ------------------------------------------------

  const gardensQuery = trpc.gardens.list.useQuery();
  const garden = gardensQuery.data?.[0];

  const actionsQuery = trpc.gardens.getActions.useQuery(
    { gardenId: garden?.id ?? "" },
    { enabled: !!garden?.id },
  );

  const careLogsQuery = trpc.careLogs.list.useQuery(
    {
      gardenId: garden?.id ?? "",
      startDate: monthStart(visibleMonth.year, visibleMonth.month),
      endDate: monthEnd(visibleMonth.year, visibleMonth.month) + "T23:59:59",
    },
    { enabled: !!garden?.id },
  );

  // ---- Build name lookup from garden zones/plants -------------------

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (garden?.zones) {
      for (const zone of garden.zones) {
        map.set(zone.id, zone.name);
        if (zone.plants) {
          for (const plant of zone.plants) {
            map.set(plant.id, plant.name);
          }
        }
      }
    }
    return map;
  }, [garden]);

  // ---- Merge actions + care logs into calendar events ----------------

  const events = useMemo<CalendarEvent[]>(() => {
    const list: CalendarEvent[] = [];

    // Actions from analysis
    if (actionsQuery.data) {
      for (const action of actionsQuery.data) {
        const date = action.suggestedDate ?? today;
        list.push({
          id: `action-${action.targetId}-${action.actionType}`,
          type: "action",
          label: action.label,
          actionType: action.actionType,
          priority: action.priority,
          targetName: nameMap.get(action.targetId),
          date,
        });
      }
    }

    // Care logs
    if (careLogsQuery.data) {
      for (const log of careLogsQuery.data) {
        const date =
          typeof log.loggedAt === "string"
            ? log.loggedAt.slice(0, 10)
            : new Date(log.loggedAt).toISOString().slice(0, 10);
        list.push({
          id: `log-${log.id}`,
          type: "careLog",
          label: log.notes ?? `${log.actionType} logged`,
          actionType: log.actionType,
          targetName: nameMap.get(log.targetId),
          date,
        });
      }
    }

    return list;
  }, [actionsQuery.data, careLogsQuery.data, nameMap, today]);

  // ---- Build marked dates for the calendar --------------------------

  const markedDates = useMemo<MarkedDates>(() => {
    const marks: MarkedDates = {};

    for (const event of events) {
      if (!marks[event.date]) {
        marks[event.date] = { dots: [], marked: true };
      }

      const entry = marks[event.date]!;
      const dots = (entry as any).dots ?? [];

      if (event.type === "careLog") {
        if (!dots.some((d: any) => d.key === "completed")) {
          dots.push({ key: "completed", color: "#4CAF50" });
        }
      } else if (event.priority === "urgent") {
        if (!dots.some((d: any) => d.key === "urgent")) {
          dots.push({ key: "urgent", color: "#D32F2F" });
        }
      } else {
        if (!dots.some((d: any) => d.key === "upcoming")) {
          dots.push({ key: "upcoming", color: "#E6A817" });
        }
      }

      (entry as any).dots = dots;
    }

    // Add selected styling
    if (marks[selectedDate]) {
      marks[selectedDate] = {
        ...marks[selectedDate],
        selected: true,
        selectedColor: GARDEN_GREEN,
      };
    } else {
      marks[selectedDate] = {
        selected: true,
        selectedColor: GARDEN_GREEN,
        dots: [],
      };
    }

    return marks;
  }, [events, selectedDate]);

  // ---- Filter events for the selected day ---------------------------

  const dayEvents = useMemo(
    () => events.filter((e) => e.date === selectedDate),
    [events, selectedDate],
  );

  // ---- Handlers -----------------------------------------------------

  const handleDayPress = (day: DateData) => {
    setSelectedDate(day.dateString);
  };

  const handleMonthChange = (month: DateData) => {
    setVisibleMonth({ year: month.year, month: month.month });
  };

  const handleTodayPress = () => {
    const t = todayString();
    setSelectedDate(t);
    setVisibleMonth(parseMonth(t));
  };

  // ---- Loading state ------------------------------------------------

  if (gardensQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GARDEN_GREEN} />
      </View>
    );
  }

  if (!garden) {
    return (
      <View style={styles.centered}>
        <FontAwesome name="calendar" size={48} color="#a8d5ba" />
        <Text style={styles.emptyTitle}>No garden yet</Text>
        <Text style={styles.emptySubtitle}>
          Create a garden first to see your calendar.
        </Text>
      </View>
    );
  }

  // ---- Render -------------------------------------------------------

  return (
    <View style={styles.container}>
      <FlatList
        data={dayEvents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <EventCard event={item} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <Calendar
              current={`${visibleMonth.year}-${String(visibleMonth.month).padStart(2, "0")}-01`}
              key={`${visibleMonth.year}-${visibleMonth.month}`}
              onDayPress={handleDayPress}
              onMonthChange={handleMonthChange}
              markingType="multi-dot"
              markedDates={markedDates}
              theme={{
                todayTextColor: GARDEN_GREEN,
                selectedDayBackgroundColor: GARDEN_GREEN,
                arrowColor: GARDEN_GREEN,
                dotColor: GARDEN_GREEN,
                textDayFontWeight: "500",
                textMonthFontWeight: "bold",
                textDayHeaderFontWeight: "500",
              }}
            />

            {/* Today button */}
            {selectedDate !== today && (
              <TouchableOpacity
                style={styles.todayButton}
                onPress={handleTodayPress}
              >
                <FontAwesome name="calendar-check-o" size={14} color="#fff" />
                <Text style={styles.todayButtonText}>Today</Text>
              </TouchableOpacity>
            )}

            {/* Day detail header */}
            <View style={styles.dayHeader}>
              <Text style={styles.dayHeaderText}>
                {formatDateLabel(selectedDate, today)}
              </Text>
              <Text style={styles.dayHeaderCount}>
                {dayEvents.length} {dayEvents.length === 1 ? "event" : "events"}
              </Text>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyDay}>
            <FontAwesome name="sun-o" size={36} color="#ddd" />
            <Text style={styles.emptyDayText}>No events on this day</Text>
          </View>
        }
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  EventCard                                                          */
/* ------------------------------------------------------------------ */

function EventCard({ event }: { event: CalendarEvent }) {
  const isCareLog = event.type === "careLog";
  const iconInfo = ACTION_ICONS[event.actionType] ?? ACTION_ICONS.other;
  const priorityColor = event.priority
    ? PRIORITY_COLORS[event.priority] ?? "#9E9E9E"
    : undefined;

  const barColor = isCareLog ? "#4CAF50" : priorityColor ?? "#9E9E9E";

  return (
    <View style={styles.card}>
      <View style={[styles.priorityBar, { backgroundColor: barColor }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardIcon}>
          {isCareLog ? (
            <FontAwesome name="check-circle" size={18} color="#4CAF50" />
          ) : (
            <FontAwesome
              name={iconInfo!.name as any}
              size={18}
              color={iconInfo!.color}
            />
          )}
        </View>
        <View style={styles.cardTextSection}>
          <View style={styles.cardTopRow}>
            <Text style={styles.cardLabel} numberOfLines={2}>
              {event.label}
            </Text>
            {isCareLog ? (
              <View
                style={[styles.typeBadge, { backgroundColor: "#4CAF5018" }]}
              >
                <Text style={[styles.typeBadgeText, { color: "#4CAF50" }]}>
                  Done
                </Text>
              </View>
            ) : event.priority ? (
              <View
                style={[
                  styles.typeBadge,
                  { backgroundColor: (priorityColor ?? "#9E9E9E") + "18" },
                ]}
              >
                <Text
                  style={[
                    styles.typeBadgeText,
                    { color: priorityColor ?? "#9E9E9E" },
                  ]}
                >
                  {event.priority.charAt(0).toUpperCase() +
                    event.priority.slice(1)}
                </Text>
              </View>
            ) : null}
          </View>
          {event.targetName && (
            <Text style={styles.cardTarget} numberOfLines={1}>
              {event.targetName}
            </Text>
          )}
          <Text style={styles.cardType}>
            {event.actionType.charAt(0).toUpperCase() +
              event.actionType.slice(1)}
          </Text>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Date label helper                                                  */
/* ------------------------------------------------------------------ */

function formatDateLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "Today";

  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 32,
  },
  listContent: {
    paddingBottom: 32,
  },

  // Empty garden state
  emptyTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 15,
    color: "#777",
    marginTop: 6,
    textAlign: "center",
  },

  // Today button
  todayButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: GARDEN_GREEN,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 12,
    gap: 6,
  },
  todayButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },

  // Day header
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 12,
  },
  dayHeaderText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  dayHeaderCount: {
    fontSize: 13,
    color: "#999",
  },

  // Empty day state
  emptyDay: {
    alignItems: "center",
    paddingTop: 48,
    paddingHorizontal: 32,
  },
  emptyDayText: {
    fontSize: 15,
    color: "#bbb",
    marginTop: 12,
  },

  // Event card (matches ActionCard style)
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: "hidden",
    flexDirection: "row",
  },
  priorityBar: {
    width: 4,
  },
  cardContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardTextSection: {
    flex: 1,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  cardLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
    flex: 1,
  },
  typeBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  cardTarget: {
    fontSize: 13,
    color: "#777",
    marginTop: 2,
  },
  cardType: {
    fontSize: 12,
    color: "#aaa",
    marginTop: 2,
  },
});
