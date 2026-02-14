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
import ActionTypeSelector, {
  type ActionType,
} from "../components/ActionTypeSelector";

export default function LogActionScreen() {
  const params = useLocalSearchParams<{
    targetType: "zone" | "plant";
    targetId: string;
    targetName: string;
    gardenId: string;
  }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [notes, setNotes] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const createCareLogMutation = trpc.careLogs.create.useMutation();
  const getUploadUrlMutation = trpc.photos.getUploadUrl.useMutation();

  const targetLabel =
    params.targetType === "zone" ? "Zone" : "Plant";

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Please allow access to your photo library"
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Please allow access to your camera"
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const showPhotoOptions = () => {
    Alert.alert("Add Photo", "Choose a source", [
      { text: "Camera", onPress: takePhoto },
      { text: "Photo Library", onPress: pickImage },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleSave = async () => {
    if (!actionType) {
      Alert.alert("Required", "Please select an action type");
      return;
    }
    if (!params.targetId || !params.targetType) {
      Alert.alert("Error", "Missing target information");
      return;
    }

    setSaving(true);
    try {
      let photoUrl: string | undefined;

      // Upload photo if selected
      if (imageUri) {
        try {
          const { uploadUrl, key } = await getUploadUrlMutation.mutateAsync({
            targetType: params.targetType,
            targetId: params.targetId,
            contentType: "image/jpeg",
          });

          const response = await fetch(imageUri);
          const blob = await response.blob();
          await fetch(uploadUrl, {
            method: "PUT",
            body: blob,
            headers: { "Content-Type": "image/jpeg" },
          });

          photoUrl = key;
        } catch {
          console.warn("Photo upload failed, saving log without photo");
        }
      }

      await createCareLogMutation.mutateAsync({
        targetType: params.targetType,
        targetId: params.targetId,
        actionType,
        notes: notes.trim() || undefined,
        photoUrl,
      });

      // Invalidate relevant queries
      utils.careLogs.list.invalidate();
      if (params.targetType === "zone") {
        utils.zones.get.invalidate();
      } else {
        utils.plants.get.invalidate();
      }

      router.back();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save care log");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Target Display */}
        <View style={styles.targetCard}>
          <FontAwesome
            name={params.targetType === "zone" ? "map-marker" : "pagelines"}
            size={18}
            color="#2D7D46"
          />
          <View style={styles.targetInfo}>
            <Text style={styles.targetLabel}>{targetLabel}</Text>
            <Text style={styles.targetName}>
              {params.targetName || "Unknown"}
            </Text>
          </View>
        </View>

        {/* Action Type Selector */}
        <Text style={styles.sectionTitle}>What did you do? *</Text>
        <ActionTypeSelector
          selectedType={actionType}
          onSelect={setActionType}
        />

        {/* Notes */}
        <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
          Notes
        </Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Add any notes about this action..."
          placeholderTextColor="#aaa"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* Photo */}
        <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
          Photo
        </Text>
        {imageUri ? (
          <View style={styles.photoPreviewContainer}>
            <Image source={{ uri: imageUri }} style={styles.photoPreview} />
            <TouchableOpacity
              style={styles.removePhotoButton}
              onPress={() => setImageUri(null)}
            >
              <FontAwesome name="times-circle" size={24} color="#d32f2f" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.photoButton}
            onPress={showPhotoOptions}
          >
            <FontAwesome name="camera" size={20} color="#2D7D46" />
            <Text style={styles.photoButtonText}>Add Photo</Text>
          </TouchableOpacity>
        )}

        {/* Save Button */}
        <TouchableOpacity
          style={[
            styles.saveButton,
            (!actionType || saving) && styles.saveButtonDisabled,
          ]}
          onPress={handleSave}
          disabled={!actionType || saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <FontAwesome name="check" size={16} color="#fff" />
              <Text style={styles.saveButtonText}>Save Care Log</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.bottomSpacer} />
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
  // Target Card
  targetCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  targetInfo: {
    flex: 1,
  },
  targetLabel: {
    fontSize: 12,
    color: "#999",
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  targetName: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 2,
  },
  // Section titles
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    marginBottom: 10,
  },
  sectionSpacing: {
    marginTop: 20,
  },
  // Notes
  notesInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    minHeight: 100,
    lineHeight: 22,
  },
  // Photo
  photoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#d0d0d0",
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 24,
  },
  photoButtonText: {
    fontSize: 15,
    color: "#2D7D46",
    fontWeight: "600",
  },
  photoPreviewContainer: {
    position: "relative",
  },
  photoPreview: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    backgroundColor: "#e8e8e8",
  },
  removePhotoButton: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#fff",
    borderRadius: 14,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  // Save
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#2D7D46",
    borderRadius: 10,
    paddingVertical: 16,
    marginTop: 28,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  bottomSpacer: {
    height: 32,
  },
});
