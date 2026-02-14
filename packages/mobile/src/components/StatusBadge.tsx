import { StyleSheet, Text, View } from "react-native";

export type HealthStatus =
  | "thriving"
  | "needs attention"
  | "struggling"
  | "dormant";

const STATUS_COLORS: Record<HealthStatus, string> = {
  thriving: "#2D7D46",
  "needs attention": "#E6A817",
  struggling: "#D32F2F",
  dormant: "#9E9E9E",
};

interface StatusBadgeProps {
  status: HealthStatus;
  showLabel?: boolean;
}

export default function StatusBadge({
  status,
  showLabel = false,
}: StatusBadgeProps) {
  const color = STATUS_COLORS[status] ?? "#9E9E9E";

  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {showLabel && <Text style={[styles.label, { color }]}>{status}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
});
