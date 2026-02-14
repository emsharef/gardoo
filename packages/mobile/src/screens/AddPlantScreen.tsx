import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { trpc } from "../lib/trpc";

const GROWTH_STAGES = [
  "seed",
  "seedling",
  "vegetative",
  "flowering",
  "fruiting",
  "harvest",
  "dormant",
] as const;

export default function AddPlantScreen() {
  const { zoneId } = useLocalSearchParams<{ zoneId: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [variety, setVariety] = useState("");
  const [species, setSpecies] = useState("");
  const [growthStage, setGrowthStage] = useState<string>("");
  const [datePlanted, setDatePlanted] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const createPlantMutation = trpc.plants.create.useMutation();
  const updatePlantMutation = trpc.plants.update.useMutation();
  const getUploadUrlMutation = trpc.photos.getUploadUrl.useMutation();

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Please allow access to your photo library"
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Plant name is required");
      return;
    }
    if (!zoneId) {
      Alert.alert("Error", "No zone selected");
      return;
    }

    setSaving(true);
    try {
      // 1) Create the plant
      const plant = await createPlantMutation.mutateAsync({
        zoneId,
        name: name.trim(),
        variety: variety.trim() || undefined,
        species: species.trim() || undefined,
        growthStage: growthStage || undefined,
        datePlanted: datePlanted || undefined,
      });

      // 2) Upload photo if selected
      if (imageUri && plant.id) {
        try {
          const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
            targetType: "plant",
            targetId: plant.id,
            contentType: "image/jpeg",
          });

          const response = await fetch(imageUri);
          const blob = await response.blob();
          await fetch(uploadUrl, {
            method: "PUT",
            body: blob,
            headers: { "Content-Type": "image/jpeg" },
          });

          await updatePlantMutation.mutateAsync({
            id: plant.id,
            photoUrl: key,
          });
        } catch {
          console.warn("Photo upload failed, plant created without photo");
        }
      }

      utils.zones.get.invalidate();
      utils.plants.list.invalidate();
      utils.gardens.list.invalidate();
      router.back();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to create plant");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Photo Picker */}
        <TouchableOpacity style={styles.photoPicker} onPress={pickImage}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.photoPreview} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <FontAwesome name="camera" size={28} color="#aaa" />
              <Text style={styles.photoText}>Add Photo</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Name */}
        <Text style={styles.label}>Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Cherry Tomato"
          value={name}
          onChangeText={setName}
          autoFocus
        />

        {/* Variety */}
        <Text style={styles.label}>Variety</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Sun Gold"
          value={variety}
          onChangeText={setVariety}
        />

        {/* Species */}
        <Text style={styles.label}>Species</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Solanum lycopersicum"
          value={species}
          onChangeText={setSpecies}
          autoCapitalize="none"
        />

        {/* Growth Stage */}
        <Text style={styles.label}>Growth Stage</Text>
        <View style={styles.chipRow}>
          {GROWTH_STAGES.map((stage) => (
            <TouchableOpacity
              key={stage}
              style={[
                styles.chip,
                growthStage === stage && styles.chipSelected,
              ]}
              onPress={() =>
                setGrowthStage(growthStage === stage ? "" : stage)
              }
            >
              <Text
                style={[
                  styles.chipText,
                  growthStage === stage && styles.chipTextSelected,
                ]}
              >
                {stage}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Date Planted */}
        <Text style={styles.label}>Date Planted</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          value={datePlanted}
          onChangeText={setDatePlanted}
          keyboardType="numbers-and-punctuation"
        />

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveText}>Save Plant</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  photoPicker: {
    marginBottom: 20,
    borderRadius: 12,
    overflow: "hidden",
  },
  photoPreview: {
    width: "100%",
    height: 180,
    borderRadius: 12,
  },
  photoPlaceholder: {
    width: "100%",
    height: 180,
    backgroundColor: "#e8e8e8",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#d0d0d0",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  photoText: {
    fontSize: 14,
    color: "#aaa",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  chipSelected: {
    backgroundColor: "#2D7D46",
    borderColor: "#2D7D46",
  },
  chipText: {
    fontSize: 14,
    color: "#555",
    textTransform: "capitalize",
  },
  chipTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  saveButton: {
    backgroundColor: "#2D7D46",
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 28,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  saveText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
