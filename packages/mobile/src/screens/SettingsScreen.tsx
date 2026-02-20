import { useState, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "../lib/trpc";
import { useAuthStore } from "../lib/auth-store";

// ─── Section Header ────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
}

// ─── Row Components ────────────────────────────────────────────────────────

function SettingsRow({
  label,
  value,
  onPress,
  trailing,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.row} onPress={onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {trailing}
        {onPress && !trailing ? (
          <FontAwesome
            name="chevron-right"
            size={12}
            color="#ccc"
            style={{ marginLeft: 8 }}
          />
        ) : null}
      </View>
    </Wrapper>
  );
}

function SettingsRowDanger({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={styles.rowLabelDanger}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── API Key Add Modal ─────────────────────────────────────────────────────

function AddKeyModal({
  visible,
  provider,
  onClose,
  onSave,
  isPending,
}: {
  visible: boolean;
  provider: "claude" | "kimi";
  onClose: () => void;
  onSave: (key: string) => void;
  isPending: boolean;
}) {
  const [keyValue, setKeyValue] = useState("");

  const handleSave = () => {
    const trimmed = keyValue.trim();
    if (!trimmed) {
      Alert.alert("Error", "Please enter an API key");
      return;
    }
    onSave(trimmed);
    setKeyValue("");
  };

  const handleClose = () => {
    setKeyValue("");
    onClose();
  };

  const providerName = provider === "claude" ? "Claude" : "Kimi";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Add {providerName} API Key</Text>
          <TextInput
            style={styles.modalInput}
            placeholder={`Enter your ${providerName} API key`}
            value={keyValue}
            onChangeText={setKeyValue}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={styles.modalButtonCancel}
              onPress={handleClose}
              disabled={isPending}
            >
              <Text style={styles.modalButtonCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modalButtonSave,
                isPending && styles.buttonDisabled,
              ]}
              onPress={handleSave}
              disabled={isPending}
            >
              {isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.modalButtonSaveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Skill Level Selector ──────────────────────────────────────────────────

const SKILL_LEVELS = ["beginner", "intermediate", "advanced"] as const;

function SkillLevelPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (level: "beginner" | "intermediate" | "advanced") => void;
}) {
  return (
    <View style={styles.pillRow}>
      {SKILL_LEVELS.map((level) => (
        <TouchableOpacity
          key={level}
          style={[styles.pill, value === level && styles.pillActive]}
          onPress={() => onChange(level)}
        >
          <Text
            style={[styles.pillText, value === level && styles.pillTextActive]}
          >
            {level.charAt(0).toUpperCase() + level.slice(1)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Provider Toggle ───────────────────────────────────────────────────────

function ProviderToggle({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (provider: "claude" | "kimi") => void;
}) {
  return (
    <View style={styles.pillRow}>
      {(["claude", "kimi"] as const).map((provider) => (
        <TouchableOpacity
          key={provider}
          style={[styles.pill, value === provider && styles.pillActive]}
          onPress={() => onChange(provider)}
        >
          <Text
            style={[
              styles.pillText,
              value === provider && styles.pillTextActive,
            ]}
          >
            {provider === "claude" ? "Claude" : "Kimi"}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Main Settings Screen ──────────────────────────────────────────────────

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const clearToken = useAuthStore((s) => s.clearToken);
  const utils = trpc.useUtils();

  // ── API Keys ──
  const apiKeysQuery = trpc.apiKeys.list.useQuery();
  const storeKeyMutation = trpc.apiKeys.store.useMutation({
    onSuccess: () => {
      utils.apiKeys.list.invalidate();
      setAddKeyModal(null);
    },
    onError: (err) => Alert.alert("Error", err.message),
  });
  const deleteKeyMutation = trpc.apiKeys.delete.useMutation({
    onSuccess: () => utils.apiKeys.list.invalidate(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  const [addKeyModal, setAddKeyModal] = useState<"claude" | "kimi" | null>(
    null,
  );

  // ── Gardens ──
  const gardensQuery = trpc.gardens.list.useQuery();
  const garden = gardensQuery.data?.[0];
  const updateGardenMutation = trpc.gardens.update.useMutation({
    onSuccess: () => utils.gardens.list.invalidate(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  // Garden editing state
  const [editingGardenName, setEditingGardenName] = useState(false);
  const [gardenNameDraft, setGardenNameDraft] = useState("");
  const [editingLocation, setEditingLocation] = useState(false);
  const [latDraft, setLatDraft] = useState("");
  const [lngDraft, setLngDraft] = useState("");
  const [editingZone, setEditingZone] = useState(false);
  const [zoneDraft, setZoneDraft] = useState("");

  // ── User Settings ──
  const settingsQuery = trpc.users.getSettings.useQuery();
  const updateSettingsMutation = trpc.users.updateSettings.useMutation({
    onSuccess: () => utils.users.getSettings.invalidate(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  // HA editing state
  const [editingHaUrl, setEditingHaUrl] = useState(false);
  const [haUrlDraft, setHaUrlDraft] = useState("");
  const [editingHaToken, setEditingHaToken] = useState(false);
  const [haTokenDraft, setHaTokenDraft] = useState("");

  // ── Handlers ──

  const handleDeleteKey = useCallback(
    (id: string, provider: string) => {
      Alert.alert(
        "Delete API Key",
        `Remove the ${provider === "claude" ? "Claude" : "Kimi"} API key?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => deleteKeyMutation.mutate({ id }),
          },
        ],
      );
    },
    [deleteKeyMutation],
  );

  const handleSaveGardenName = useCallback(() => {
    if (!garden || !gardenNameDraft.trim()) return;
    updateGardenMutation.mutate({ id: garden.id, name: gardenNameDraft.trim() });
    setEditingGardenName(false);
  }, [garden, gardenNameDraft, updateGardenMutation]);

  const handleSaveLocation = useCallback(() => {
    if (!garden) return;
    const lat = parseFloat(latDraft);
    const lng = parseFloat(lngDraft);
    if (isNaN(lat) || isNaN(lng)) {
      Alert.alert("Error", "Please enter valid latitude and longitude values");
      return;
    }
    updateGardenMutation.mutate({
      id: garden.id,
      locationLat: lat,
      locationLng: lng,
    });
    setEditingLocation(false);
  }, [garden, latDraft, lngDraft, updateGardenMutation]);

  const handleSaveHardinessZone = useCallback(() => {
    if (!garden || !zoneDraft.trim()) return;
    updateGardenMutation.mutate({
      id: garden.id,
      hardinessZone: zoneDraft.trim(),
    });
    setEditingZone(false);
  }, [garden, zoneDraft, updateGardenMutation]);

  const handleSaveHaUrl = useCallback(() => {
    updateSettingsMutation.mutate({ haUrl: haUrlDraft.trim() });
    setEditingHaUrl(false);
  }, [haUrlDraft, updateSettingsMutation]);

  const handleSaveHaToken = useCallback(() => {
    updateSettingsMutation.mutate({ haToken: haTokenDraft.trim() });
    setEditingHaToken(false);
  }, [haTokenDraft, updateSettingsMutation]);

  const handleTestHaConnection = useCallback(() => {
    Alert.alert(
      "Test Connection",
      "Home Assistant connection testing will be available in a future update.",
    );
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert("Logout", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await clearToken();
          router.replace("/(auth)/login");
        },
      },
    ]);
  }, [clearToken, router]);

  // Format date for display
  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleDateString();
  };

  // ── Render ──

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(40, insets.bottom + 20) }]}>
        {/* Screen Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.screenTitle}>Settings</Text>
        </View>

        {/* ── AI Configuration ── */}
        <SectionHeader title="AI CONFIGURATION" />
        <View style={styles.section}>
          {/* Stored keys */}
          {apiKeysQuery.isLoading ? (
            <View style={styles.rowCenter}>
              <ActivityIndicator size="small" color="#2D7D46" />
            </View>
          ) : apiKeysQuery.data && apiKeysQuery.data.length > 0 ? (
            apiKeysQuery.data.map((key) => (
              <View key={key.id} style={styles.row}>
                <View style={styles.keyInfo}>
                  <Text style={styles.rowLabel}>
                    {key.provider === "claude" ? "Claude" : "Kimi"}
                  </Text>
                  <Text style={styles.keyDate}>
                    Added {formatDate(key.createdAt)}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeleteKey(key.id, key.provider)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <FontAwesome name="trash-o" size={18} color="#d32f2f" />
                </TouchableOpacity>
              </View>
            ))
          ) : (
            <View style={styles.row}>
              <Text style={styles.rowValueMuted}>No API keys stored</Text>
            </View>
          )}

          {/* Add key buttons */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => setAddKeyModal("claude")}
          >
            <FontAwesome name="plus-circle" size={18} color="#2D7D46" />
            <Text style={styles.addKeyText}>Add Claude API Key</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, styles.rowLast]}
            onPress={() => setAddKeyModal("kimi")}
          >
            <FontAwesome name="plus-circle" size={18} color="#2D7D46" />
            <Text style={styles.addKeyText}>Add Kimi API Key</Text>
          </TouchableOpacity>
        </View>

        {/* Preferred Provider */}
        <SectionHeader title="PREFERRED AI PROVIDER" />
        <View style={styles.section}>
          <View style={[styles.row, styles.rowLast]}>
            <ProviderToggle
              value={settingsQuery.data?.preferredProvider}
              onChange={(provider) =>
                updateSettingsMutation.mutate({ preferredProvider: provider })
              }
            />
          </View>
        </View>

        {/* ── Garden Settings ── */}
        <SectionHeader title="GARDEN SETTINGS" />
        <View style={styles.section}>
          {gardensQuery.isLoading ? (
            <View style={styles.rowCenter}>
              <ActivityIndicator size="small" color="#2D7D46" />
            </View>
          ) : !garden ? (
            <View style={[styles.row, styles.rowLast]}>
              <Text style={styles.rowValueMuted}>
                No garden yet. Create one in the Garden tab.
              </Text>
            </View>
          ) : (
            <>
              {/* Garden Name */}
              {editingGardenName ? (
                <View style={styles.editRow}>
                  <TextInput
                    style={styles.editInput}
                    value={gardenNameDraft}
                    onChangeText={setGardenNameDraft}
                    placeholder="Garden name"
                    autoFocus
                  />
                  <TouchableOpacity
                    style={styles.editSaveBtn}
                    onPress={handleSaveGardenName}
                  >
                    <Text style={styles.editSaveBtnText}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setEditingGardenName(false)}
                  >
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <SettingsRow
                  label="Garden Name"
                  value={garden.name}
                  onPress={() => {
                    setGardenNameDraft(garden.name);
                    setEditingGardenName(true);
                  }}
                />
              )}

              {/* Location */}
              {editingLocation ? (
                <View style={styles.editRow}>
                  <TextInput
                    style={[styles.editInput, styles.editInputHalf]}
                    value={latDraft}
                    onChangeText={setLatDraft}
                    placeholder="Latitude"
                    keyboardType="numeric"
                    autoFocus
                  />
                  <TextInput
                    style={[styles.editInput, styles.editInputHalf]}
                    value={lngDraft}
                    onChangeText={setLngDraft}
                    placeholder="Longitude"
                    keyboardType="numeric"
                  />
                  <TouchableOpacity
                    style={styles.editSaveBtn}
                    onPress={handleSaveLocation}
                  >
                    <Text style={styles.editSaveBtnText}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setEditingLocation(false)}
                  >
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <SettingsRow
                  label="Location"
                  value={
                    garden.locationLat && garden.locationLng
                      ? `${garden.locationLat.toFixed(4)}, ${garden.locationLng.toFixed(4)}`
                      : "Not set"
                  }
                  onPress={() => {
                    setLatDraft(garden.locationLat?.toString() ?? "");
                    setLngDraft(garden.locationLng?.toString() ?? "");
                    setEditingLocation(true);
                  }}
                />
              )}

              {/* Hardiness Zone */}
              {editingZone ? (
                <View style={styles.editRow}>
                  <TextInput
                    style={styles.editInput}
                    value={zoneDraft}
                    onChangeText={setZoneDraft}
                    placeholder="e.g. 7b"
                    autoFocus
                  />
                  <TouchableOpacity
                    style={styles.editSaveBtn}
                    onPress={handleSaveHardinessZone}
                  >
                    <Text style={styles.editSaveBtnText}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditingZone(false)}>
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.rowLast}>
                  <SettingsRow
                    label="Hardiness Zone"
                    value={garden.hardinessZone ?? "Not set"}
                    onPress={() => {
                      setZoneDraft(garden.hardinessZone ?? "");
                      setEditingZone(true);
                    }}
                  />
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Home Assistant ── */}
        <SectionHeader title="HOME ASSISTANT (OPTIONAL)" />
        <View style={styles.section}>
          {/* HA URL */}
          {editingHaUrl ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.editInput}
                value={haUrlDraft}
                onChangeText={setHaUrlDraft}
                placeholder="http://homeassistant.local:8123"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                autoFocus
              />
              <TouchableOpacity
                style={styles.editSaveBtn}
                onPress={handleSaveHaUrl}
              >
                <Text style={styles.editSaveBtnText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingHaUrl(false)}>
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <SettingsRow
              label="HA URL"
              value={settingsQuery.data?.haUrl || "Not set"}
              onPress={() => {
                setHaUrlDraft(settingsQuery.data?.haUrl ?? "");
                setEditingHaUrl(true);
              }}
            />
          )}

          {/* HA Token */}
          {editingHaToken ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.editInput}
                value={haTokenDraft}
                onChangeText={setHaTokenDraft}
                placeholder="Long-lived access token"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                autoFocus
              />
              <TouchableOpacity
                style={styles.editSaveBtn}
                onPress={handleSaveHaToken}
              >
                <Text style={styles.editSaveBtnText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingHaToken(false)}>
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <SettingsRow
              label="Access Token"
              value={settingsQuery.data?.haToken ? "Configured" : "Not set"}
              onPress={() => {
                setHaTokenDraft("");
                setEditingHaToken(true);
              }}
            />
          )}

          {/* Test Connection */}
          <TouchableOpacity
            style={[styles.row, styles.rowLast]}
            onPress={handleTestHaConnection}
          >
            <FontAwesome name="plug" size={16} color="#2D7D46" />
            <Text style={styles.addKeyText}>Test Connection</Text>
          </TouchableOpacity>
        </View>

        {/* ── Account ── */}
        <SectionHeader title="ACCOUNT" />
        <View style={styles.section}>
          {/* Skill Level */}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Skill Level</Text>
          </View>
          <View style={styles.row}>
            <SkillLevelPicker
              value={settingsQuery.data?.skillLevel}
              onChange={(level) =>
                updateSettingsMutation.mutate({ skillLevel: level })
              }
            />
          </View>

          {/* Logout */}
          <View style={styles.rowLast}>
            <SettingsRowDanger label="Logout" onPress={handleLogout} />
          </View>
        </View>

      </ScrollView>

      {/* Add Key Modal */}
      {addKeyModal && (
        <AddKeyModal
          visible={!!addKeyModal}
          provider={addKeyModal}
          onClose={() => setAddKeyModal(null)}
          onSave={(key) =>
            storeKeyMutation.mutate({ provider: addKeyModal, key })
          }
          isPending={storeKeyMutation.isPending}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  titleContainer: {
    paddingTop: 60,
    paddingBottom: 8,
    paddingHorizontal: 16,
    backgroundColor: "#f2f2f7",
  },
  screenTitle: {
    fontSize: 34,
    fontWeight: "bold",
    color: "#000",
  },

  // Section header (iOS Settings-like)
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6d6d72",
    letterSpacing: 0.5,
  },

  // Section container (white grouped list)
  section: {
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#c8c7cc",
  },

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#c8c7cc",
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowCenter: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    fontSize: 16,
    color: "#000",
    flex: 1,
  },
  rowLabelDanger: {
    fontSize: 16,
    color: "#d32f2f",
    textAlign: "center",
    flex: 1,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowValue: {
    fontSize: 16,
    color: "#8e8e93",
  },
  rowValueMuted: {
    fontSize: 15,
    color: "#8e8e93",
    fontStyle: "italic",
  },

  // Key info (provider + date)
  keyInfo: {
    flex: 1,
  },
  keyDate: {
    fontSize: 12,
    color: "#8e8e93",
    marginTop: 2,
  },

  // Add key row
  addKeyText: {
    fontSize: 16,
    color: "#2D7D46",
    marginLeft: 10,
    fontWeight: "500",
  },

  // Pill toggles
  pillRow: {
    flexDirection: "row",
    gap: 8,
    flex: 1,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f2f2f7",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  pillActive: {
    backgroundColor: "#2D7D46",
    borderColor: "#2D7D46",
  },
  pillText: {
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
  },
  pillTextActive: {
    color: "#fff",
  },

  // Inline edit row
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#c8c7cc",
    gap: 8,
  },
  editInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: "#fafafa",
  },
  editInputHalf: {
    flex: 0.5,
  },
  editSaveBtn: {
    backgroundColor: "#2D7D46",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editSaveBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  editCancelText: {
    color: "#8e8e93",
    fontSize: 14,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#000",
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: "#fafafa",
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  modalButtonCancel: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalButtonCancelText: {
    fontSize: 15,
    color: "#8e8e93",
    fontWeight: "500",
  },
  modalButtonSave: {
    backgroundColor: "#2D7D46",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalButtonSaveText: {
    fontSize: 15,
    color: "#fff",
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
