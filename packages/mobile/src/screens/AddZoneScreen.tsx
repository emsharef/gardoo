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

const SOIL_TYPES = ["clay", "sand", "loam", "silt", "peat", "chalk"] as const;
const SUN_EXPOSURES = ["full sun", "partial shade", "full shade"] as const;

export default function AddZoneScreen() {
  const { gardenId } = useLocalSearchParams<{ gardenId: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [soilType, setSoilType] = useState<string>("");
  const [sunExposure, setSunExposure] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const createZoneMutation = trpc.zones.create.useMutation();
  const updateZoneMutation = trpc.zones.update.useMutation();
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
      aspect: [16, 9],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Zone name is required");
      return;
    }
    if (!gardenId) {
      Alert.alert("Error", "No garden selected");
      return;
    }

    setSaving(true);
    try {
      // 1) Create the zone
      const zone = await createZoneMutation.mutateAsync({
        gardenId,
        name: name.trim(),
        soilType: soilType || undefined,
        sunExposure: sunExposure || undefined,
        notes: notes.trim() || undefined,
      });

      // 2) Upload photo if selected
      if (imageUri && zone.id) {
        try {
          const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
            targetType: "zone",
            targetId: zone.id,
            contentType: "image/jpeg",
          });

          // Upload the image to R2
          const response = await fetch(imageUri);
          const blob = await response.blob();
          await fetch(uploadUrl, {
            method: "PUT",
            body: blob,
            headers: { "Content-Type": "image/jpeg" },
          });

          // Update zone with photo URL
          await updateZoneMutation.mutateAsync({
            id: zone.id,
            photoUrl: key,
          });
        } catch {
          // Photo upload failed, but zone was created — that's ok
          console.warn("Photo upload failed, zone created without photo");
        }
      }

      utils.gardens.list.invalidate();
      utils.zones.list.invalidate();
      router.back();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to create zone");
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
          placeholder="e.g., Front Raised Bed"
          value={name}
          onChangeText={setName}
          autoFocus
        />

        {/* Soil Type */}
        <Text style={styles.label}>Soil Type</Text>
        <View style={styles.chipRow}>
          {SOIL_TYPES.map((type) => (
            <TouchableOpacity
              key={type}
              style={[
                styles.chip,
                soilType === type && styles.chipSelected,
              ]}
              onPress={() => setSoilType(soilType === type ? "" : type)}
            >
              <Text
                style={[
                  styles.chipText,
                  soilType === type && styles.chipTextSelected,
                ]}
              >
                {type}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Sun Exposure */}
        <Text style={styles.label}>Sun Exposure</Text>
        <View style={styles.chipRow}>
          {SUN_EXPOSURES.map((exp) => (
            <TouchableOpacity
              key={exp}
              style={[
                styles.chip,
                sunExposure === exp && styles.chipSelected,
              ]}
              onPress={() => setSunExposure(sunExposure === exp ? "" : exp)}
            >
              <Text
                style={[
                  styles.chipText,
                  sunExposure === exp && styles.chipTextSelected,
                ]}
              >
                {exp}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Notes */}
        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Any notes about this zone..."
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
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
            <Text style={styles.saveText}>Save Zone</Text>
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
  textArea: {
    minHeight: 100,
    paddingTop: 14,
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
