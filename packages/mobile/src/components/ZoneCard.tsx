import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import StatusBadge, { type HealthStatus } from "./StatusBadge";

interface ZoneCardProps {
  id: string;
  name: string;
  photoUrl?: string | null;
  plantCount: number;
  status?: HealthStatus;
  pendingActions?: number;
}

export default function ZoneCard({
  id,
  name,
  photoUrl,
  plantCount,
  status,
  pendingActions,
}: ZoneCardProps) {
  const router = useRouter();

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/(tabs)/garden/zone/${id}`)}
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.photo} />
      ) : (
        <View style={styles.placeholder}>
          <FontAwesome name="leaf" size={32} color="#a8d5ba" />
        </View>
      )}
      <View style={styles.info}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {status && <StatusBadge status={status} />}
        </View>
        <View style={styles.meta}>
          <Text style={styles.metaText}>
            {plantCount} {plantCount === 1 ? "plant" : "plants"}
          </Text>
          {pendingActions != null && pendingActions > 0 && (
            <View style={styles.actionBadge}>
              <Text style={styles.actionBadgeText}>
                {pendingActions} {pendingActions === 1 ? "task" : "tasks"}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: "hidden",
  },
  photo: {
    width: "100%",
    height: 140,
    backgroundColor: "#e8f5e9",
  },
  placeholder: {
    width: "100%",
    height: 140,
    backgroundColor: "#e8f5e9",
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    padding: 14,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  name: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1a1a1a",
    flex: 1,
    marginRight: 8,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  metaText: {
    fontSize: 13,
    color: "#777",
  },
  actionBadge: {
    backgroundColor: "#FFF3E0",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  actionBadgeText: {
    fontSize: 12,
    color: "#E65100",
    fontWeight: "600",
  },
});
