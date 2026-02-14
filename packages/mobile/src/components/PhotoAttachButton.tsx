import { Alert, Image, StyleSheet, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import FontAwesome from "@expo/vector-icons/FontAwesome";

interface PhotoAttachButtonProps {
  imageUri: string | null;
  onImageSelected: (uri: string) => void;
  onImageRemoved: () => void;
}

export default function PhotoAttachButton({
  imageUri,
  onImageSelected,
  onImageRemoved,
}: PhotoAttachButtonProps) {
  const handlePress = () => {
    Alert.alert("Attach Photo", "Choose a source", [
      {
        text: "Camera",
        onPress: openCamera,
      },
      {
        text: "Photo Library",
        onPress: openLibrary,
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const openCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Please allow access to your camera to take photos"
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      onImageSelected(result.assets[0].uri);
    }
  };

  const openLibrary = async () => {
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
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      onImageSelected(result.assets[0].uri);
    }
  };

  return (
    <View style={styles.wrapper}>
      {/* Preview thumbnail */}
      {imageUri && (
        <View style={styles.previewContainer}>
          <Image source={{ uri: imageUri }} style={styles.preview} />
          <TouchableOpacity
            style={styles.removeButton}
            onPress={onImageRemoved}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <FontAwesome name="times-circle" size={18} color="#d32f2f" />
          </TouchableOpacity>
        </View>
      )}

      {/* Camera/photo button */}
      <TouchableOpacity
        style={styles.attachButton}
        onPress={handlePress}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <FontAwesome
          name="camera"
          size={20}
          color={imageUri ? "#2D7D46" : "#888"}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  previewContainer: {
    position: "relative",
  },
  preview: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  removeButton: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#fff",
    borderRadius: 10,
  },
});
