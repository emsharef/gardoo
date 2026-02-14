import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { trpc } from "../lib/trpc";
import ZoneCard from "../components/ZoneCard";

export default function GardenScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const gardensQuery = trpc.gardens.list.useQuery();
  const garden = gardensQuery.data?.[0];

  const [showCreateGarden, setShowCreateGarden] = useState(false);
  const [gardenName, setGardenName] = useState("");

  const createGardenMutation = trpc.gardens.create.useMutation({
    onSuccess: () => {
      setShowCreateGarden(false);
      setGardenName("");
      utils.gardens.list.invalidate();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to create garden");
    },
  });

  const handleCreateGarden = () => {
    if (!gardenName.trim()) {
      Alert.alert("Error", "Please enter a garden name");
      return;
    }
    createGardenMutation.mutate({ name: gardenName.trim() });
  };

  if (gardensQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2D7D46" />
      </View>
    );
  }

  if (gardensQuery.isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load garden</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => gardensQuery.refetch()}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // No garden exists yet — prompt to create one
  if (!garden) {
    return (
      <View style={styles.centered}>
        {showCreateGarden ? (
          <View style={styles.createForm}>
            <Text style={styles.createTitle}>Name your garden</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., My Backyard Garden"
              value={gardenName}
              onChangeText={setGardenName}
              autoFocus
            />
            <View style={styles.createButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowCreateGarden(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  createGardenMutation.isPending && styles.buttonDisabled,
                ]}
                onPress={handleCreateGarden}
                disabled={createGardenMutation.isPending}
              >
                {createGardenMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <FontAwesome name="leaf" size={48} color="#a8d5ba" />
            <Text style={styles.emptyTitle}>Welcome to Gardoo</Text>
            <Text style={styles.emptySubtitle}>
              Create your garden to get started
            </Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => setShowCreateGarden(true)}
            >
              <Text style={styles.createButtonText}>Create Garden</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  const zones = garden.zones ?? [];

  return (
    <View style={styles.container}>
      <FlatList
        data={zones}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ZoneCard
            id={item.id}
            name={item.name}
            photoUrl={item.photoUrl}
            plantCount={item.plants?.length ?? 0}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshing={gardensQuery.isRefetching}
        onRefresh={() => gardensQuery.refetch()}
        ListEmptyComponent={
          <View style={styles.emptyList}>
            <FontAwesome name="map-o" size={40} color="#ccc" />
            <Text style={styles.emptyListTitle}>No zones yet</Text>
            <Text style={styles.emptyListSubtitle}>
              Add your first zone to start organizing your garden!
            </Text>
          </View>
        }
      />
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() =>
          router.push({
            pathname: "/(tabs)/garden/add-zone",
            params: { gardenId: garden.id },
          })
        }
      >
        <FontAwesome name="plus" size={22} color="#fff" />
      </TouchableOpacity>
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
    paddingTop: 12,
    paddingBottom: 80,
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
  // Empty state
  emptyState: {
    alignItems: "center",
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
    marginBottom: 24,
  },
  createButton: {
    backgroundColor: "#2D7D46",
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  createButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  // Create garden inline form
  createForm: {
    width: "100%",
    maxWidth: 320,
  },
  createTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 12,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#fff",
    marginBottom: 16,
  },
  createButtons: {
    flexDirection: "row",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 15,
    color: "#777",
    fontWeight: "600",
  },
  saveButton: {
    flex: 1,
    backgroundColor: "#2D7D46",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  saveText: {
    fontSize: 15,
    color: "#fff",
    fontWeight: "600",
  },
  // Empty list
  emptyList: {
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyListTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#555",
    marginTop: 16,
  },
  emptyListSubtitle: {
    fontSize: 14,
    color: "#999",
    marginTop: 6,
    textAlign: "center",
  },
  // FAB
  fab: {
    position: "absolute",
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#2D7D46",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
