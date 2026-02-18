import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { trpc } from "../lib/trpc";
import WeatherHeader from "../components/WeatherHeader";
import ActionCard, { type ActionItem } from "../components/ActionCard";

/**
 * Map WMO weather codes to human-readable conditions.
 * See: https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM
 */
function weatherCodeToCondition(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly Cloudy";
  if (code <= 49) return "Foggy";
  if (code <= 59) return "Drizzle";
  if (code <= 69) return "Rain";
  if (code <= 79) return "Snow";
  if (code <= 84) return "Rain Showers";
  if (code <= 89) return "Snow Showers";
  if (code <= 99) return "Thunderstorm";
  return "Unknown";
}

/**
 * Generate a brief weather summary from daily forecast data.
 */
function buildWeatherSummary(
  daily: Array<{
    date: string;
    tempMax: number;
    tempMin: number;
    precipitationProbability: number;
    weatherCode: number;
  }>,
): string | undefined {
  if (!daily || daily.length < 2) return undefined;

  // Check tomorrow's forecast
  const tomorrow = daily[1];
  if (tomorrow) {
    if (tomorrow.precipitationProbability > 60) {
      return "Rain expected tomorrow";
    }
    if (tomorrow.weatherCode >= 71 && tomorrow.weatherCode <= 79) {
      return "Snow expected tomorrow";
    }
    if (tomorrow.weatherCode >= 95) {
      return "Storms expected tomorrow";
    }
  }

  // Check if any day in next 3 days has high precip
  for (let i = 2; i < Math.min(daily.length, 4); i++) {
    const day = daily[i];
    if (day && day.precipitationProbability > 70) {
      return `Rain likely in ${i} days`;
    }
  }

  return undefined;
}

export default function HomeScreen() {
  const gardensQuery = trpc.gardens.list.useQuery();
  const garden = gardensQuery.data?.[0];

  const actionsQuery = trpc.gardens.getActions.useQuery(
    { gardenId: garden?.id ?? "" },
    { enabled: !!garden?.id },
  );

  const weatherQuery = trpc.gardens.getWeather.useQuery(
    { gardenId: garden?.id ?? "" },
    { enabled: !!garden?.id },
  );

  const isRefreshing =
    gardensQuery.isRefetching ||
    actionsQuery.isRefetching ||
    weatherQuery.isRefetching;

  const handleRefresh = () => {
    gardensQuery.refetch();
    if (garden?.id) {
      actionsQuery.refetch();
      weatherQuery.refetch();
    }
  };

  // Parse weather data from cache
  const weatherData = (() => {
    const raw = weatherQuery.data?.forecast as any;
    if (!raw?.current) return null;

    const todayDaily = raw.daily?.[0];
    return {
      temperature: raw.current.temperature,
      highTemp: todayDaily?.tempMax,
      lowTemp: todayDaily?.tempMin,
      condition: weatherCodeToCondition(raw.current.weatherCode ?? 0),
      summary: buildWeatherSummary(raw.daily),
    };
  })();

  const hasLocation = !!(garden?.locationLat && garden?.locationLng);

  // Build action items with target names from garden data
  const actions: ActionItem[] = (() => {
    if (!actionsQuery.data) return [];

    // Build a lookup of zone/plant names from the garden data
    const nameMap = new Map<string, string>();
    if (garden?.zones) {
      for (const zone of garden.zones) {
        nameMap.set(zone.id, zone.name);
        if (zone.plants) {
          for (const plant of zone.plants) {
            nameMap.set(plant.id, plant.name);
          }
        }
      }
    }

    return actionsQuery.data.map((action) => ({
      ...action,
      targetName: nameMap.get(action.targetId),
    }));
  })();

  // Loading state
  if (gardensQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2D7D46" />
      </View>
    );
  }

  // Error state
  if (gardensQuery.isError) {
    return (
      <View style={styles.centered}>
        <FontAwesome name="exclamation-circle" size={40} color="#d32f2f" />
        <Text style={styles.errorText}>Failed to load garden data</Text>
      </View>
    );
  }

  // No garden yet
  if (!garden) {
    return (
      <View style={styles.centered}>
        <FontAwesome name="leaf" size={48} color="#a8d5ba" />
        <Text style={styles.emptyTitle}>Welcome to Gardoo</Text>
        <Text style={styles.emptySubtitle}>
          Create a garden in the Garden tab to see your daily tasks here.
        </Text>
      </View>
    );
  }

  const taskCount = actions.length;

  return (
    <View style={styles.container}>
      <FlatList
        data={actions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ActionCard action={item} />}
        contentContainerStyle={styles.listContent}
        refreshing={isRefreshing}
        onRefresh={handleRefresh}
        ListHeaderComponent={
          <>
            <WeatherHeader weather={weatherData} hasLocation={hasLocation} />
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Today's Tasks</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{taskCount}</Text>
              </View>
            </View>
          </>
        }
        ListEmptyComponent={
          actionsQuery.isLoading ? (
            <View style={styles.loadingActions}>
              <ActivityIndicator size="small" color="#2D7D46" />
              <Text style={styles.loadingText}>Loading tasks...</Text>
            </View>
          ) : (
            <View style={styles.emptyActions}>
              <FontAwesome name="check-circle" size={48} color="#a8d5ba" />
              <Text style={styles.emptyActionsTitle}>No tasks for today!</Text>
              <Text style={styles.emptyActionsSubtitle}>
                Your garden is looking good.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

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
  errorText: {
    fontSize: 16,
    color: "#d32f2f",
    marginTop: 12,
  },
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
  // Section header
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  countBadge: {
    backgroundColor: "#2D7D46",
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
    paddingHorizontal: 8,
  },
  countText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  // Loading actions
  loadingActions: {
    alignItems: "center",
    paddingTop: 40,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "#999",
  },
  // Empty actions
  emptyActions: {
    alignItems: "center",
    paddingTop: 48,
    paddingHorizontal: 32,
  },
  emptyActionsTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#555",
    marginTop: 16,
  },
  emptyActionsSubtitle: {
    fontSize: 14,
    color: "#999",
    marginTop: 6,
    textAlign: "center",
  },
});
