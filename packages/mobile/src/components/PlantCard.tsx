import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import StatusBadge, { type HealthStatus } from "./StatusBadge";

interface PlantCardProps {
  id: string;
  name: string;
  variety?: string | null;
  photoUrl?: string | null;
  growthStage?: string | null;
  status?: HealthStatus;
  nextAction?: string | null;
}

export default function PlantCard({
  id,
  name,
  variety,
  photoUrl,
  growthStage,
  status,
  nextAction,
}: PlantCardProps) {
  const router = useRouter();

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/(tabs)/garden/plant/${id}`)}
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.photo} />
      ) : (
        <View style={styles.placeholder}>
          <FontAwesome name="pagelines" size={28} color="#a8d5ba" />
        </View>
      )}
      <View style={styles.info}>
        <View style={styles.topRow}>
          <View style={styles.nameCol}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {variety ? (
              <Text style={styles.variety} numberOfLines={1}>
                {variety}
              </Text>
            ) : null}
          </View>
          {status && <StatusBadge status={status} />}
        </View>
        <View style={styles.meta}>
          {growthStage ? (
            <View style={styles.stageBadge}>
              <Text style={styles.stageText}>{growthStage}</Text>
            </View>
          ) : null}
          {nextAction ? (
            <View style={styles.actionTag}>
              <Text style={styles.actionTagText}>{nextAction}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    flexDirection: "row",
    overflow: "hidden",
  },
  photo: {
    width: 90,
    height: 90,
    backgroundColor: "#e8f5e9",
  },
  placeholder: {
    width: 90,
    height: 90,
    backgroundColor: "#e8f5e9",
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    padding: 12,
    justifyContent: "center",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  nameCol: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  variety: {
    fontSize: 13,
    color: "#777",
    marginTop: 1,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  stageBadge: {
    backgroundColor: "#E8F5E9",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  stageText: {
    fontSize: 11,
    color: "#2D7D46",
    fontWeight: "600",
    textTransform: "capitalize",
  },
  actionTag: {
    backgroundColor: "#E3F2FD",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  actionTagText: {
    fontSize: 11,
    color: "#1565C0",
    fontWeight: "600",
  },
});
