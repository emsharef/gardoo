"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import { resizeImage, uploadToR2 } from "@/lib/photo-upload";
import ReactMarkdown from "react-markdown";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessageAction {
  type: string;
  status: "success" | "error";
  summary: string;
  details?: Record<string, unknown>;
  error?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  actions?: ChatMessageAction[];
  timestamp: string;
}

const getApiBaseUrl = () =>
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/trpc").replace(
    /\/trpc$/,
    "",
  );

// ─── Chat Page ──────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { isAuthenticated, token } = useAuth();
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Streaming state — lifted here so MessageList can render live text
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamingActions, setStreamingActions] = useState<
    ChatMessageAction[] | null
  >(null);
  const [pendingUserMsg, setPendingUserMsg] = useState<ChatMessage | null>(
    null,
  );
  const [isStreaming, setIsStreaming] = useState(false);

  const gardensQuery = trpc.gardens.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const gardenId = gardensQuery.data?.[0]?.id;

  const convListQuery = trpc.chat.conversations.list.useQuery(
    { gardenId: gardenId! },
    { enabled: !!gardenId },
  );

  const convQuery = trpc.chat.conversations.get.useQuery(
    { conversationId: activeConvId! },
    { enabled: !!activeConvId },
  );

  const createConv = trpc.chat.conversations.create.useMutation({
    onSuccess(data) {
      setActiveConvId(data.id);
      convListQuery.refetch();
    },
  });

  const deleteConv = trpc.chat.conversations.delete.useMutation({
    onSuccess() {
      if (activeConvId) {
        setActiveConvId(null);
      }
      convListQuery.refetch();
    },
  });

  const handleNewChat = useCallback(() => {
    if (!gardenId) return;
    createConv.mutate({ gardenId });
    setSidebarOpen(false);
  }, [gardenId, createConv]);

  const handleDeleteConv = useCallback(
    (e: React.MouseEvent, convId: string) => {
      e.stopPropagation();
      deleteConv.mutate({ conversationId: convId });
      if (activeConvId === convId) {
        setActiveConvId(null);
      }
    },
    [deleteConv, activeConvId],
  );

  if (!isAuthenticated) return null;

  const convList = convListQuery.data ?? [];
  const messages = (convQuery.data?.messages ?? []) as ChatMessage[];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] -mt-6 -mx-4 md:-mx-6 lg:-mx-8">
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed bottom-4 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-[#2D7D46] text-white shadow-lg md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </button>

      {/* Sidebar backdrop (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Conversation sidebar */}
      <div
        className={`fixed z-30 flex h-full w-64 flex-col border-r border-gray-200 bg-gray-50 transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-3">
          <span className="text-sm font-semibold text-gray-700">
            Conversations
          </span>
          <button
            onClick={handleNewChat}
            disabled={createConv.isPending || !gardenId}
            className="rounded-lg bg-[#2D7D46] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
          >
            + New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {!gardenId ? (
            <p className="px-2 py-4 text-center text-xs text-gray-400">
              Create a garden first
            </p>
          ) : convList.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-gray-400">
              No conversations yet
            </p>
          ) : (
            <div className="space-y-1">
              {convList.map((conv) => (
                <div
                  key={conv.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveConvId(conv.id);
                    setSidebarOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setActiveConvId(conv.id);
                      setSidebarOpen(false);
                    }
                  }}
                  className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    activeConvId === conv.id
                      ? "bg-[#2D7D46]/10 text-[#2D7D46]"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <span className="flex-1 truncate">{conv.title}</span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {conv.messageCount > 0 ? conv.messageCount : ""}
                  </span>
                  <button
                    onClick={(e) => handleDeleteConv(e, conv.id)}
                    className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    title="Delete conversation"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex flex-1 flex-col">
        {activeConvId ? (
          <>
            {/* Messages */}
            <MessageList
              messages={messages}
              isLoading={convQuery.isLoading}
              streamingText={streamingText}
              streamingActions={streamingActions}
              pendingUserMsg={pendingUserMsg}
              isStreaming={isStreaming}
            />

            {/* Input */}
            <ChatInput
              conversationId={activeConvId}
              gardenId={gardenId!}
              token={token}
              isStreaming={isStreaming}
              onStreamStart={(userMsg) => {
                setPendingUserMsg(userMsg);
                setStreamingText(null);
                setStreamingActions(null);
                setIsStreaming(true);
              }}
              onStreamDelta={(text) => {
                setStreamingText((prev) => (prev ?? "") + text);
              }}
              onStreamDone={(actions, cleanText) => {
                setStreamingActions(actions.length > 0 ? actions : null);
                if (cleanText) {
                  setStreamingText(cleanText);
                }
                setIsStreaming(false);
                setPendingUserMsg(null);
                setStreamingText(null);
                setStreamingActions(null);
                convQuery.refetch();
                convListQuery.refetch();
              }}
              onStreamError={() => {
                setIsStreaming(false);
                setPendingUserMsg(null);
                setStreamingText(null);
                setStreamingActions(null);
              }}
            />
          </>
        ) : (
          <EmptyState onNewChat={handleNewChat} hasGarden={!!gardenId} />
        )}
      </div>
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState({
  onNewChat,
  hasGarden,
}: {
  onNewChat: () => void;
  hasGarden: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2D7D46]/10">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2D7D46" strokeWidth="1.5">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-900">Gardooner</h2>
        <p className="mt-1 text-sm text-gray-500">
          {hasGarden
            ? "Your AI garden advisor. Ask about your plants, get care advice, or manage tasks."
            : "Create a garden first to start chatting."}
        </p>
      </div>
      {hasGarden && (
        <button
          onClick={onNewChat}
          className="rounded-lg bg-[#2D7D46] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#246838]"
        >
          Start a conversation
        </button>
      )}
    </div>
  );
}

// ─── Message List ───────────────────────────────────────────────────────────

function MessageList({
  messages,
  isLoading,
  streamingText,
  streamingActions,
  pendingUserMsg,
  isStreaming,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  streamingText: string | null;
  streamingActions: ChatMessageAction[] | null;
  pendingUserMsg: ChatMessage | null;
  isStreaming: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, pendingUserMsg]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#2D7D46] border-t-transparent" />
      </div>
    );
  }

  const showEmpty = messages.length === 0 && !pendingUserMsg;

  if (showEmpty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-gray-400">
          Send a message to get started
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {[
            "How are my plants doing?",
            "What should I do today?",
            "Any pest concerns?",
          ].map((suggestion) => (
            <span
              key={suggestion}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-500"
            >
              {suggestion}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {/* Show the user message that was just sent (before server persists) */}
        {pendingUserMsg && (
          <MessageBubble message={pendingUserMsg} />
        )}

        {/* Streaming assistant response */}
        {isStreaming && streamingText === null && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="flex gap-1">
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#2D7D46]" style={{ animationDelay: "0ms" }} />
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#2D7D46]" style={{ animationDelay: "150ms" }} />
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#2D7D46]" style={{ animationDelay: "300ms" }} />
                </div>
                <span>Gardooner is thinking...</span>
              </div>
            </div>
          </div>
        )}

        {streamingText !== null && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900">
              <div className="prose prose-sm max-w-none text-gray-800 prose-headings:text-gray-900 prose-headings:mt-3 prose-headings:mb-1 prose-headings:text-[0.9rem] prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-strong:text-gray-900 prose-a:text-[#2D7D46] prose-code:text-[#2D7D46] prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-900 prose-pre:text-gray-100">
                <ReactMarkdown>{streamingText}</ReactMarkdown>
              </div>
              {streamingActions && streamingActions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {streamingActions.map((action, i) => (
                    <ActionCard key={i} action={action} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─── Message Bubble ─────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const getReadUrl = trpc.photos.getReadUrl.useQuery(
    { key: message.imageUrl! },
    { enabled: !!message.imageUrl },
  );

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-[#2D7D46] text-white"
            : "border border-gray-200 bg-white text-gray-900"
        }`}
      >
        {/* Image thumbnail */}
        {message.imageUrl && getReadUrl.data?.url && (
          <div className="mb-2">
            <img
              src={getReadUrl.data.url}
              alt="Attached photo"
              className="max-h-48 rounded-lg object-cover"
            />
          </div>
        )}

        {/* Text content */}
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-white">
            {message.content}
          </div>
        ) : (
          <div className="prose prose-sm max-w-none text-gray-800 prose-headings:text-gray-900 prose-headings:mt-3 prose-headings:mb-1 prose-headings:text-[0.9rem] prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-strong:text-gray-900 prose-a:text-[#2D7D46] prose-code:text-[#2D7D46] prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-900 prose-pre:text-gray-100">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}

        {/* Action cards */}
        {message.actions && message.actions.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.actions.map((action, i) => (
              <ActionCard key={i} action={action} />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`mt-1.5 text-[10px] ${
            isUser ? "text-white/60" : "text-gray-400"
          }`}
        >
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Action Card ────────────────────────────────────────────────────────────

function ActionCard({ action }: { action: ChatMessageAction }) {
  const isSuccess = action.status === "success";
  const typeLabels: Record<string, string> = {
    create_task: "Task Created",
    complete_task: "Task Completed",
    cancel_task: "Task Cancelled",
    create_care_log: "Care Logged",
  };

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border-l-[3px] bg-white/90 px-3 py-2 ${
        isSuccess ? "border-l-green-500" : "border-l-red-400"
      }`}
    >
      <span className="mt-0.5 text-sm">
        {isSuccess ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-700">
          {typeLabels[action.type] ?? action.type}
        </p>
        <p className="truncate text-xs text-gray-500">{action.summary}</p>
        {action.error && (
          <p className="truncate text-xs text-red-500">{action.error}</p>
        )}
      </div>
    </div>
  );
}

// ─── Chat Input ─────────────────────────────────────────────────────────────

// ─── SSE parser helper ───────────────────────────────────────────────────────

function parseSSEEvents(
  chunk: string,
  buffer: string,
): { events: Array<{ event: string; data: string }>; remaining: string } {
  const text = buffer + chunk;
  const events: Array<{ event: string; data: string }> = [];
  const parts = text.split("\n\n");
  const remaining = parts.pop() ?? "";

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    let event = "message";
    let data = "";
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event: ")) {
        event = line.slice(7);
      } else if (line.startsWith("data: ")) {
        data = line.slice(6);
      }
    }
    if (data) {
      events.push({ event, data });
    }
  }

  return { events, remaining };
}

// ─── Chat Input ─────────────────────────────────────────────────────────────

function ChatInput({
  conversationId,
  gardenId,
  token,
  isStreaming,
  onStreamStart,
  onStreamDelta,
  onStreamDone,
  onStreamError,
}: {
  conversationId: string;
  gardenId: string;
  token: string | null;
  isStreaming: boolean;
  onStreamStart: (userMsg: ChatMessage) => void;
  onStreamDelta: (text: string) => void;
  onStreamDone: (actions: ChatMessageAction[], cleanText?: string) => void;
  onStreamError: () => void;
}) {
  const [text, setText] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoData, setPhotoData] = useState<{
    base64: string;
    blob: Blob;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getUploadUrl = trpc.photos.getUploadUrl.useMutation();

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }, []);

  const handlePhotoSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const result = await resizeImage(file);
        setPhotoPreview(result.dataUrl);
        setPhotoData({ base64: result.base64, blob: result.blob });
      } catch {
        console.error("Failed to process image");
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [],
  );

  const removePhoto = useCallback(() => {
    setPhotoPreview(null);
    setPhotoData(null);
  }, []);

  const handleSend = useCallback(async () => {
    const content = text.trim();
    if (!content && !photoData) return;
    if (isStreaming) return;

    const messageContent = content || "What do you see in this photo?";

    setText("");
    setPhotoPreview(null);

    // Show user message immediately
    const userMsg: ChatMessage = {
      role: "user",
      content: messageContent,
      timestamp: new Date().toISOString(),
    };
    onStreamStart(userMsg);

    try {
      let imageBase64: string | undefined;
      let imageKey: string | undefined;

      // Upload photo to R2 if present
      if (photoData) {
        const { uploadUrl, key } = await getUploadUrl.mutateAsync({
          targetType: "chat",
          targetId: conversationId,
          contentType: "image/jpeg",
        });
        await uploadToR2(uploadUrl, photoData.blob);
        imageBase64 = photoData.base64;
        imageKey = key;
      }

      setPhotoData(null);

      // Start SSE stream
      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          conversationId,
          content: messageContent,
          imageBase64,
          imageKey,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Stream request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const { events, remaining } = parseSSEEvents(chunk, sseBuffer);
        sseBuffer = remaining;

        for (const evt of events) {
          if (evt.event === "delta") {
            try {
              const { text: delta } = JSON.parse(evt.data);
              if (delta) onStreamDelta(delta);
            } catch {
              // skip malformed delta
            }
          } else if (evt.event === "done") {
            try {
              const { actions, cleanText } = JSON.parse(evt.data);
              onStreamDone(actions ?? [], cleanText);
              return;
            } catch {
              onStreamDone([]);
              return;
            }
          } else if (evt.event === "error") {
            console.error("[chat-stream] Server error:", evt.data);
            onStreamError();
            return;
          }
        }
      }

      // If we exhausted the stream without a done event, still finalize
      onStreamDone([]);
    } catch (err) {
      console.error("Failed to send message:", err);
      setText(content);
      onStreamError();
    }
  }, [
    text,
    photoData,
    isStreaming,
    conversationId,
    token,
    getUploadUrl,
    onStreamStart,
    onStreamDelta,
    onStreamDone,
    onStreamError,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="mx-auto max-w-2xl">
        {/* Photo preview */}
        {photoPreview && (
          <div className="mb-3 inline-block relative">
            <img
              src={photoPreview}
              alt="Photo to send"
              className="h-20 rounded-lg border border-gray-200 object-cover"
            />
            <button
              onClick={removePhoto}
              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white shadow-sm"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2">
          {/* Photo button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            className="mb-0.5 shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            title="Attach photo"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoSelect}
            className="hidden"
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              adjustTextareaHeight();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your garden..."
            disabled={isStreaming}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-[#2D7D46] focus:bg-white disabled:opacity-50"
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={isStreaming || (!text.trim() && !photoData)}
            className="mb-0.5 shrink-0 rounded-lg bg-[#2D7D46] p-2 text-white transition-colors hover:bg-[#246838] disabled:opacity-40"
            title="Send message"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
