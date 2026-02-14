import {
  ActivityIndicator,
  FlatList,
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
import PlantCard from "../components/PlantCard";

export default function ZoneDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const zoneQuery = trpc.zones.get.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  const careLogsQuery = trpc.careLogs.list.useQuery(
    { targetType: "zone", targetId: id! },
    { enabled: !!id }
  );

  if (zoneQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2D7D46" />
      </View>
    );
  }

  if (zoneQuery.isError || !zoneQuery.data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load zone</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => zoneQuery.refetch()}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const zone = zoneQuery.data;
  const plants = zone.plants ?? [];
  const sensors = zone.sensors ?? [];
  const recentLogs = (careLogsQuery.data ?? []).slice(0, 5);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Hero Photo */}
      {zone.photoUrl ? (
        <Image source={{ uri: zone.photoUrl }} style={styles.heroPhoto} />
      ) : (
        <View style={styles.heroPlaceholder}>
          <FontAwesome name="leaf" size={48} color="#a8d5ba" />
        </View>
      )}

      {/* Zone Metadata */}
      <View style={styles.section}>
        <Text style={styles.zoneName}>{zone.name}</Text>
        <View style={styles.metaRow}>
          {zone.soilType ? (
            <View style={styles.metaChip}>
              <FontAwesome name="globe" size={12} color="#666" />
              <Text style={styles.metaChipText}>{zone.soilType}</Text>
            </View>
          ) : null}
          {zone.sunExposure ? (
            <View style={styles.metaChip}>
              <FontAwesome name="sun-o" size={12} color="#666" />
              <Text style={styles.metaChipText}>{zone.sunExposure}</Text>
            </View>
          ) : null}
        </View>
        {zone.notes ? (
          <Text style={styles.notes}>{zone.notes}</Text>
        ) : null}
      </View>

      {/* Plants */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Plants</Text>
          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: "/(tabs)/garden/add-plant",
                params: { zoneId: zone.id },
              })
            }
          >
            <FontAwesome name="plus-circle" size={22} color="#2D7D46" />
          </TouchableOpacity>
        </View>
        {plants.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>
              No plants yet. Add your first plant!
            </Text>
          </View>
        ) : (
          plants.map((plant) => (
            <PlantCard
              key={plant.id}
              id={plant.id}
              name={plant.name}
              variety={plant.variety}
              photoUrl={plant.photoUrl}
              growthStage={plant.growthStage}
            />
          ))
        )}
      </View>

      {/* Recent Care Logs */}
      {recentLogs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Care Logs</Text>
          {recentLogs.map((log) => (
            <View key={log.id} style={styles.logItem}>
              <View style={styles.logDot} />
              <View style={styles.logContent}>
                <Text style={styles.logAction}>{log.actionType}</Text>
                {log.notes ? (
                  <Text style={styles.logNotes} numberOfLines={2}>
                    {log.notes}
                  </Text>
                ) : null}
                <Text style={styles.logDate}>
                  {new Date(log.loggedAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Sensors */}
      {sensors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sensors</Text>
          {sensors.map((sensor) => (
            <View key={sensor.id} style={styles.sensorItem}>
              <FontAwesome name="thermometer" size={16} color="#2D7D46" />
              <View style={styles.sensorInfo}>
                <Text style={styles.sensorType}>{sensor.sensorType}</Text>
                <Text style={styles.sensorEntity}>{sensor.haEntityId}</Text>
                {sensor.lastReading != null ? (
                  <Text style={styles.sensorReading}>
                    Last: {JSON.stringify(sensor.lastReading)}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Log Care Action Button */}
      <TouchableOpacity
        style={styles.logActionButton}
        onPress={() =>
          router.push({
            pathname: "/(tabs)/garden/log-action",
            params: {
              targetType: "zone",
              targetId: zone.id,
              targetName: zone.name,
              gardenId: zone.gardenId,
            },
          })
        }
      >
        <FontAwesome name="pencil-square-o" size={16} color="#2D7D46" />
        <Text style={styles.logActionButtonText}>Log Care Action</Text>
      </TouchableOpacity>

      {/* Add Plant Button */}
      <TouchableOpacity
        style={styles.addButton}
        onPress={() =>
          router.push({
            pathname: "/(tabs)/garden/add-plant",
            params: { zoneId: zone.id },
          })
        }
      >
        <FontAwesome name="plus" size={16} color="#fff" />
        <Text style={styles.addButtonText}>Add Plant</Text>
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
  heroPhoto: {
    width: "100%",
    height: 200,
    backgroundColor: "#e8f5e9",
  },
  heroPlaceholder: {
    width: "100%",
    height: 200,
    backgroundColor: "#e8f5e9",
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 12,
  },
  zoneName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 8,
  },
  metaChip: {
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
  metaChipText: {
    fontSize: 13,
    color: "#555",
    textTransform: "capitalize",
  },
  notes: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginTop: 4,
  },
  emptySection: {
    alignItems: "center",
    paddingVertical: 24,
  },
  emptySectionText: {
    color: "#999",
    fontSize: 14,
  },
  // Care Logs
  logItem: {
    flexDirection: "row",
    marginBottom: 12,
    alignItems: "flex-start",
  },
  logDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2D7D46",
    marginTop: 6,
    marginRight: 10,
  },
  logContent: {
    flex: 1,
  },
  logAction: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
    textTransform: "capitalize",
  },
  logNotes: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  logDate: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  // Sensors
  sensorItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  sensorInfo: {
    flex: 1,
  },
  sensorType: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
    textTransform: "capitalize",
  },
  sensorEntity: {
    fontSize: 12,
    color: "#999",
  },
  sensorReading: {
    fontSize: 12,
    color: "#2D7D46",
    marginTop: 2,
  },
  // Log Care Action button
  logActionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#2D7D46",
    borderRadius: 8,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 24,
  },
  logActionButtonText: {
    color: "#2D7D46",
    fontSize: 16,
    fontWeight: "600",
  },
  // Add Plant button
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#2D7D46",
    borderRadius: 8,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 24,
  },
  addButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  bottomSpacer: {
    height: 32,
  },
});
