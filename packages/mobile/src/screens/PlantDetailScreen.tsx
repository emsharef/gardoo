import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { trpc } from "../lib/trpc";
import type { CareProfile } from "@gardoo/server/src/db/schema";

export default function PlantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const plantQuery = trpc.plants.get.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  const careLogsQuery = trpc.careLogs.list.useQuery(
    { targetType: "plant", targetId: id! },
    { enabled: !!id }
  );

  if (plantQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2D7D46" />
      </View>
    );
  }

  if (plantQuery.isError || !plantQuery.data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load plant</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => plantQuery.refetch()}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const plant = plantQuery.data;
  const careProfile = plant.careProfile as CareProfile | null | undefined;
  const logs = careLogsQuery.data ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Photo */}
      {plant.photoUrl ? (
        <Image source={{ uri: plant.photoUrl }} style={styles.photo} />
      ) : (
        <View style={styles.photoPlaceholder}>
          <FontAwesome name="pagelines" size={56} color="#a8d5ba" />
        </View>
      )}

      {/* Basic Info */}
      <View style={styles.section}>
        <Text style={styles.plantName}>{plant.name}</Text>
        {plant.variety ? (
          <Text style={styles.variety}>{plant.variety}</Text>
        ) : null}
        {plant.species ? (
          <Text style={styles.species}>{plant.species}</Text>
        ) : null}

        <View style={styles.metaRow}>
          {plant.growthStage ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{plant.growthStage}</Text>
            </View>
          ) : null}
          {plant.datePlanted ? (
            <View style={styles.chip}>
              <FontAwesome name="calendar" size={11} color="#555" />
              <Text style={styles.chipText}>
                Planted {new Date(plant.datePlanted).toLocaleDateString()}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Care Profile */}
      {careProfile && Object.keys(careProfile).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Care Profile</Text>
          <View style={styles.profileCard}>
            {careProfile.waterFrequencyDays != null && (
              <View style={styles.profileRow}>
                <FontAwesome name="tint" size={14} color="#1565C0" />
                <Text style={styles.profileLabel}>Water every</Text>
                <Text style={styles.profileValue}>
                  {careProfile.waterFrequencyDays} days
                </Text>
              </View>
            )}
            {careProfile.sunNeeds && (
              <View style={styles.profileRow}>
                <FontAwesome name="sun-o" size={14} color="#E6A817" />
                <Text style={styles.profileLabel}>Sun</Text>
                <Text style={styles.profileValue}>{careProfile.sunNeeds}</Text>
              </View>
            )}
            {careProfile.fertilizerNotes && (
              <View style={styles.profileRow}>
                <FontAwesome name="flask" size={14} color="#2D7D46" />
                <Text style={styles.profileLabel}>Fertilizer</Text>
                <Text style={styles.profileValue}>
                  {careProfile.fertilizerNotes}
                </Text>
              </View>
            )}
            {careProfile.companionPlants &&
              careProfile.companionPlants.length > 0 && (
                <View style={styles.profileRow}>
                  <FontAwesome name="heart" size={14} color="#E91E63" />
                  <Text style={styles.profileLabel}>Companions</Text>
                  <Text style={styles.profileValue}>
                    {careProfile.companionPlants.join(", ")}
                  </Text>
                </View>
              )}
          </View>
        </View>
      )}

      {/* Care Log Timeline */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Care History</Text>
        {logs.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>No care logs yet</Text>
          </View>
        ) : (
          logs.map((log, index) => (
            <View key={log.id} style={styles.logItem}>
              <View style={styles.timelineCol}>
                <View style={styles.timelineDot} />
                {index < logs.length - 1 && <View style={styles.timelineLine} />}
              </View>
              <View style={styles.logContent}>
                <Text style={styles.logAction}>{log.actionType}</Text>
                {log.notes ? (
                  <Text style={styles.logNotes}>{log.notes}</Text>
                ) : null}
                <Text style={styles.logDate}>
                  {new Date(log.loggedAt).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Chat Button */}
      <TouchableOpacity
        style={styles.chatButton}
        onPress={() => {
          // Navigate to chat with plant context — will be wired in Task 17
          router.push({
            pathname: "/(tabs)/garden/plant/[id]",
            params: { id: plant.id },
          });
        }}
      >
        <FontAwesome name="comments" size={18} color="#2D7D46" />
        <Text style={styles.chatButtonText}>Chat about this plant</Text>
      </TouchableOpacity>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
  },
  errorText: {
    fontSize: 16,
    color: "#d32f2f",
    marginBottom: 12,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#2D7D46",
    borderRadius: 8,
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
  },
  photo: {
    width: "100%",
    height: 260,
    backgroundColor: "#e8f5e9",
  },
  photoPlaceholder: {
    width: "100%",
    height: 260,
    backgroundColor: "#e8f5e9",
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 12,
  },
  plantName: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#1a1a1a",
  },
  variety: {
    fontSize: 16,
    color: "#666",
    marginTop: 2,
  },
  species: {
    fontSize: 14,
    color: "#999",
    fontStyle: "italic",
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 12,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  chipText: {
    fontSize: 13,
    color: "#555",
    textTransform: "capitalize",
  },
  // Care Profile
  profileCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  profileLabel: {
    fontSize: 14,
    color: "#666",
    width: 80,
  },
  profileValue: {
    fontSize: 14,
    color: "#1a1a1a",
    flex: 1,
  },
  // Care Logs
  emptySection: {
    alignItems: "center",
    paddingVertical: 24,
  },
  emptySectionText: {
    color: "#999",
    fontSize: 14,
  },
  logItem: {
    flexDirection: "row",
    marginBottom: 2,
  },
  timelineCol: {
    alignItems: "center",
    width: 20,
    marginRight: 10,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#2D7D46",
    marginTop: 4,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#d0e8d4",
    marginTop: 4,
  },
  logContent: {
    flex: 1,
    paddingBottom: 16,
  },
  logAction: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
    textTransform: "capitalize",
  },
  logNotes: {
    fontSize: 13,
    color: "#666",
    marginTop: 3,
    lineHeight: 18,
  },
  logDate: {
    fontSize: 12,
    color: "#999",
    marginTop: 3,
  },
  // Chat button
  chatButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#2D7D46",
    borderRadius: 8,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 24,
  },
  chatButtonText: {
    color: "#2D7D46",
    fontSize: 16,
    fontWeight: "600",
  },
  bottomSpacer: {
    height: 32,
  },
});
