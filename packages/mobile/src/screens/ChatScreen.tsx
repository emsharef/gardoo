import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { File } from "expo-file-system";
import { trpc } from "../lib/trpc";
import ChatBubble, { type ChatMessage } from "../components/ChatBubble";
import PhotoAttachButton from "../components/PhotoAttachButton";

export default function ChatScreen() {
  const params = useLocalSearchParams<{
    gardenId: string;
    zoneId?: string;
    plantId?: string;
    contextLabel?: string;
  }>();

  const { gardenId, zoneId, plantId, contextLabel } = params;
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  const chatMutation = trpc.chat.send.useMutation();

  const scrollToEnd = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text && !imageUri) return;
    if (!gardenId) return;

    // Build user message
    const userMessage: ChatMessage = {
      role: "user",
      content: text || "(photo attached)",
      imageUri: imageUri ?? undefined,
      timestamp: new Date(),
    };

    // Add user message to state
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputText("");
    const attachedImageUri = imageUri;
    setImageUri(null);
    scrollToEnd();

    // Convert image to base64 if attached
    let imageBase64: string | undefined;
    if (attachedImageUri) {
      try {
        const file = new File(attachedImageUri);
        const buffer = await file.arrayBuffer();
        // Convert ArrayBuffer to base64 string
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        imageBase64 = btoa(binary);
      } catch (err) {
        console.warn("Failed to read image as base64:", err);
      }
    }

    // Build the messages array for the API (all messages so far, including the new user message)
    const apiMessages = updatedMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setIsLoading(true);

    try {
      const result = await chatMutation.mutateAsync({
        gardenId,
        zoneId: zoneId || undefined,
        plantId: plantId || undefined,
        messages: apiMessages,
        imageBase64,
      });

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.content,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      scrollToEnd();
    } catch (err: any) {
      // Show error as assistant message
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: `Sorry, I had trouble responding. ${err.message || "Please try again."}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      scrollToEnd();
    } finally {
      setIsLoading(false);
    }
  };

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => <ChatBubble message={item} />,
    []
  );

  const keyExtractor = useCallback(
    (_: ChatMessage, index: number) => `msg-${index}`,
    []
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {/* Context Chip */}
      <View style={styles.contextBar}>
        <FontAwesome name="leaf" size={14} color="#2D7D46" />
        <Text style={styles.contextText} numberOfLines={1}>
          Chatting about: {contextLabel || "My Garden"}
        </Text>
      </View>

      {/* Messages List */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={scrollToEnd}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <FontAwesome name="comments-o" size={48} color="#d0e8d4" />
            <Text style={styles.emptyTitle}>Ask anything about your garden</Text>
            <Text style={styles.emptySubtitle}>
              Get personalized advice, diagnose plant issues, or plan your next
              steps.
            </Text>
          </View>
        }
      />

      {/* Loading indicator */}
      {isLoading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#2D7D46" />
          <Text style={styles.loadingText}>Thinking...</Text>
        </View>
      )}

      {/* Input Bar */}
      <View style={[styles.inputBar, { paddingBottom: Math.max(8, insets.bottom) }]}>
        <PhotoAttachButton
          imageUri={imageUri}
          onImageSelected={setImageUri}
          onImageRemoved={() => setImageUri(null)}
        />

        <TextInput
          style={styles.textInput}
          placeholder="Ask about your garden..."
          placeholderTextColor="#999"
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={4000}
          returnKeyType="default"
        />

        <TouchableOpacity
          style={[
            styles.sendButton,
            (!inputText.trim() && !imageUri) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={(!inputText.trim() && !imageUri) || isLoading}
        >
          <FontAwesome
            name="send"
            size={18}
            color={
              inputText.trim() || imageUri ? "#fff" : "rgba(255,255,255,0.5)"
            }
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  contextBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#e8f5e9",
    borderBottomWidth: 1,
    borderBottomColor: "#d0e8d4",
  },
  contextText: {
    fontSize: 13,
    color: "#2D7D46",
    fontWeight: "500",
    flex: 1,
  },
  messagesContent: {
    paddingVertical: 12,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#555",
    marginTop: 16,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#999",
    marginTop: 8,
    textAlign: "center",
    lineHeight: 20,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 13,
    color: "#888",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    gap: 4,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    backgroundColor: "#f9f9f9",
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#2D7D46",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#a8d5ba",
  },
});
