import { StyleSheet, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";

interface WeatherData {
  temperature?: number;
  highTemp?: number;
  lowTemp?: number;
  condition?: string;
  summary?: string;
}

interface WeatherHeaderProps {
  weather: WeatherData | null;
  hasLocation: boolean;
}

const CONDITION_ICONS: Record<string, string> = {
  sunny: "sun-o",
  clear: "sun-o",
  cloudy: "cloud",
  overcast: "cloud",
  rain: "tint",
  rainy: "tint",
  drizzle: "tint",
  snow: "snowflake-o",
  thunderstorm: "bolt",
  fog: "low-vision",
  windy: "flag",
};

function getWeatherIcon(condition?: string): string {
  if (!condition) return "sun-o";
  const lower = condition.toLowerCase();
  for (const [key, icon] of Object.entries(CONDITION_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "sun-o";
}

export default function WeatherHeader({
  weather,
  hasLocation,
}: WeatherHeaderProps) {
  if (!hasLocation) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholderRow}>
          <FontAwesome name="map-marker" size={16} color="#999" />
          <Text style={styles.placeholderText}>
            Set garden location for weather forecast
          </Text>
        </View>
      </View>
    );
  }

  if (!weather) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholderRow}>
          <FontAwesome name="cloud" size={16} color="#999" />
          <Text style={styles.placeholderText}>Weather data loading...</Text>
        </View>
      </View>
    );
  }

  const iconName = getWeatherIcon(weather.condition);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.tempSection}>
          <FontAwesome
            name={iconName as any}
            size={22}
            color="#2D7D46"
          />
          <Text style={styles.temperature}>
            {weather.temperature != null
              ? `${Math.round(weather.temperature)}°`
              : "--°"}
          </Text>
        </View>
        <View style={styles.detailSection}>
          <Text style={styles.condition} numberOfLines={1}>
            {weather.condition ?? "Unknown"}
          </Text>
          {weather.highTemp != null && weather.lowTemp != null && (
            <Text style={styles.highLow}>
              H: {Math.round(weather.highTemp)}° L:{" "}
              {Math.round(weather.lowTemp)}°
            </Text>
          )}
        </View>
        {weather.summary && (
          <View style={styles.summarySection}>
            <Text style={styles.summary} numberOfLines={1}>
              {weather.summary}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    minHeight: 56,
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  tempSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  temperature: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  detailSection: {
    marginLeft: 16,
  },
  condition: {
    fontSize: 14,
    fontWeight: "600",
    color: "#555",
  },
  highLow: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  summarySection: {
    flex: 1,
    alignItems: "flex-end",
  },
  summary: {
    fontSize: 12,
    color: "#777",
    fontStyle: "italic",
  },
  placeholderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  placeholderText: {
    fontSize: 14,
    color: "#999",
  },
});
