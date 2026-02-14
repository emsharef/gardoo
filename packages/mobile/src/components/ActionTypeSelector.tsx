import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";

export type ActionType =
  | "water"
  | "fertilize"
  | "harvest"
  | "prune"
  | "plant"
  | "monitor"
  | "protect"
  | "other";

interface ActionOption {
  type: ActionType;
  label: string;
  icon: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}

const ACTION_OPTIONS: ActionOption[] = [
  { type: "water", label: "Water", icon: "tint", color: "#1565C0" },
  { type: "fertilize", label: "Fertilize", icon: "flask", color: "#7B1FA2" },
  { type: "harvest", label: "Harvest", icon: "shopping-basket", color: "#E65100" },
  { type: "prune", label: "Prune", icon: "scissors", color: "#455A64" },
  { type: "plant", label: "Plant", icon: "leaf", color: "#2E7D32" },
  { type: "monitor", label: "Monitor", icon: "eye", color: "#00838F" },
  { type: "protect", label: "Protect", icon: "shield", color: "#AD1457" },
  { type: "other", label: "Other", icon: "ellipsis-h", color: "#757575" },
];

interface ActionTypeSelectorProps {
  selectedType: ActionType | null;
  onSelect: (type: ActionType) => void;
}

export default function ActionTypeSelector({
  selectedType,
  onSelect,
}: ActionTypeSelectorProps) {
  return (
    <View style={styles.grid}>
      {ACTION_OPTIONS.map((option) => {
        const isSelected = selectedType === option.type;
        return (
          <TouchableOpacity
            key={option.type}
            style={[
              styles.button,
              isSelected && styles.buttonSelected,
            ]}
            onPress={() => onSelect(option.type)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: isSelected ? option.color : `${option.color}18` },
              ]}
            >
              <FontAwesome
                name={option.icon}
                size={22}
                color={isSelected ? "#fff" : option.color}
              />
            </View>
            <Text
              style={[
                styles.label,
                isSelected && styles.labelSelected,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  button: {
    width: "22%",
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "#fff",
  },
  buttonSelected: {
    borderColor: "#2D7D46",
    backgroundColor: "#e8f5e9",
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: "500",
    color: "#555",
    textAlign: "center",
  },
  labelSelected: {
    color: "#2D7D46",
    fontWeight: "700",
  },
});
