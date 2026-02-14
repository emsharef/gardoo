import { Image, StyleSheet, Text, View } from "react-native";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  imageUri?: string;
  timestamp: Date;
}

interface ChatBubbleProps {
  message: ChatMessage;
}

/**
 * Render very basic markdown: **bold**, *italic*, and bullet lists (lines starting with "- ").
 * Returns an array of Text elements for a single line.
 */
function renderMarkdownLine(line: string, key: string) {
  const parts: React.ReactNode[] = [];
  // Match bold (**text**) and italic (*text*)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIndex = 0;

  while ((match = regex.exec(line)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // Bold
      parts.push(
        <Text key={`${key}-b-${partIndex}`} style={styles.bold}>
          {match[2]}
        </Text>
      );
    } else if (match[3]) {
      // Italic
      parts.push(
        <Text key={`${key}-i-${partIndex}`} style={styles.italic}>
          {match[3]}
        </Text>
      );
    }

    lastIndex = match.index + match[0].length;
    partIndex++;
  }

  // Remaining text
  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts;
}

function renderContent(content: string, isUser: boolean) {
  const lines = content.split("\n");
  const textColor = isUser ? styles.userText : styles.assistantText;

  return lines.map((line, index) => {
    const key = `line-${index}`;

    // Bullet list item
    if (line.startsWith("- ")) {
      return (
        <View key={key} style={styles.bulletRow}>
          <Text style={[textColor, styles.bullet]}>{"\u2022"}</Text>
          <Text style={[textColor, styles.bulletText]}>
            {renderMarkdownLine(line.slice(2), key)}
          </Text>
        </View>
      );
    }

    // Regular line (preserve blank lines)
    return (
      <Text key={key} style={textColor}>
        {renderMarkdownLine(line, key)}
        {line === "" ? "\n" : ""}
      </Text>
    );
  });
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === "user";

  return (
    <View
      style={[
        styles.row,
        isUser ? styles.rowUser : styles.rowAssistant,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
        ]}
      >
        {/* Show attached photo in user messages */}
        {isUser && message.imageUri && (
          <Image
            source={{ uri: message.imageUri }}
            style={styles.attachedImage}
            resizeMode="cover"
          />
        )}

        {renderContent(message.content, isUser)}

        <Text
          style={[
            styles.timestamp,
            isUser ? styles.timestampUser : styles.timestampAssistant,
          ]}
        >
          {message.timestamp.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 12,
    marginVertical: 4,
  },
  rowUser: {
    alignItems: "flex-end",
  },
  rowAssistant: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: "#2D7D46",
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: "#ECECEC",
    borderBottomLeftRadius: 4,
  },
  userText: {
    fontSize: 15,
    color: "#fff",
    lineHeight: 21,
  },
  assistantText: {
    fontSize: 15,
    color: "#1a1a1a",
    lineHeight: 21,
  },
  bold: {
    fontWeight: "bold",
  },
  italic: {
    fontStyle: "italic",
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 2,
  },
  bullet: {
    marginRight: 6,
    fontSize: 15,
    lineHeight: 21,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
  },
  attachedImage: {
    width: "100%",
    height: 160,
    borderRadius: 10,
    marginBottom: 8,
  },
  timestamp: {
    fontSize: 11,
    marginTop: 4,
  },
  timestampUser: {
    color: "rgba(255,255,255,0.65)",
    textAlign: "right",
  },
  timestampAssistant: {
    color: "#999",
    textAlign: "left",
  },
});
