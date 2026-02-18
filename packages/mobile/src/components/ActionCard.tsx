import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { trpc } from "../lib/trpc";

export interface ActionItem {
  id: string;
  targetType: string;
  targetId: string;
  actionType: string;
  priority: string;
  label: string;
  suggestedDate?: string;
  context?: string;
  recurrence?: string;
  photoRequested?: boolean;
  targetName?: string;
}

interface ActionCardProps {
  action: ActionItem;
  onDone?: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#D32F2F",
  today: "#E6A817",
  upcoming: "#1976D2",
  informational: "#9E9E9E",
};

const ACTION_ICONS: Record<string, { name: string; color: string }> = {
  water: { name: "tint", color: "#1976D2" },
  fertilize: { name: "flask", color: "#7B1FA2" },
  harvest: { name: "shopping-basket", color: "#E65100" },
  prune: { name: "cut", color: "#2D7D46" },
  plant: { name: "leaf", color: "#388E3C" },
  monitor: { name: "eye", color: "#455A64" },
  protect: { name: "shield", color: "#C62828" },
  other: { name: "ellipsis-h", color: "#777" },
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  today: "Today",
  upcoming: "Upcoming",
  informational: "Info",
};

export default function ActionCard({ action, onDone }: ActionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [completed, setCompleted] = useState(false);

  const utils = trpc.useUtils();

  const completeTask = trpc.tasks.complete.useMutation({
    onSuccess: () => {
      setCompleted(true);
      utils.gardens.getActions.invalidate();
      onDone?.();
    },
  });

  const priorityColor = PRIORITY_COLORS[action.priority] ?? "#9E9E9E";
  const iconInfo = ACTION_ICONS[action.actionType] ?? ACTION_ICONS.other;
  const priorityLabel = PRIORITY_LABELS[action.priority] ?? action.priority;

  const handleDone = () => {
    if (!action.id) return;
    completeTask.mutate({
      taskId: action.id,
      notes: `Completed: ${action.label}`,
    });
  };

  if (completed) {
    return (
      <View style={[styles.card, styles.completedCard]}>
        <View style={[styles.priorityBar, { backgroundColor: "#a8d5ba" }]} />
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <FontAwesome name="check" size={18} color="#2D7D46" />
          </View>
          <View style={styles.textSection}>
            <Text style={[styles.label, styles.completedLabel]}>
              {action.label}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={() => {
        if (action.context) setExpanded(!expanded);
      }}
    >
      <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <FontAwesome
            name={iconInfo.name as any}
            size={18}
            color={iconInfo.color}
          />
        </View>
        <View style={styles.textSection}>
          <View style={styles.topRow}>
            <Text style={styles.label} numberOfLines={2}>
              {action.label}
              {action.photoRequested && (
                <FontAwesome name="camera" size={14} color="#666" style={{ marginLeft: 4 }} />
              )}
            </Text>
            <View
              style={[
                styles.priorityBadge,
                { backgroundColor: priorityColor + "18" },
              ]}
            >
              <Text style={[styles.priorityText, { color: priorityColor }]}>
                {priorityLabel}
              </Text>
            </View>
          </View>
          {action.targetName && (
            <Text style={styles.targetName} numberOfLines={1}>
              {action.targetName}
            </Text>
          )}
          {expanded && action.context && (
            <Text style={styles.context}>{action.context}</Text>
          )}
        </View>
        <TouchableOpacity
          style={[
            styles.doneButton,
            completeTask.isPending && styles.doneButtonPending,
          ]}
          onPress={handleDone}
          disabled={completeTask.isPending}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {completeTask.isPending ? (
            <ActivityIndicator size="small" color="#2D7D46" />
          ) : (
            <FontAwesome name="check" size={16} color="#2D7D46" />
          )}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: "hidden",
    flexDirection: "row",
  },
  completedCard: {
    opacity: 0.6,
  },
  priorityBar: {
    width: 4,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  textSection: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
    flex: 1,
  },
  completedLabel: {
    textDecorationLine: "line-through",
    color: "#999",
  },
  priorityBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  targetName: {
    fontSize: 13,
    color: "#777",
    marginTop: 2,
  },
  context: {
    fontSize: 13,
    color: "#999",
    marginTop: 6,
    lineHeight: 18,
  },
  doneButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#e8f5e9",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  doneButtonPending: {
    opacity: 0.6,
  },
});
