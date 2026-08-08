/**
 * ChatContext public types.
 *
 * Consumed by every component that calls useChat(). Keep this file free of
 * React/hook imports so it can also be used in utility functions.
 */

import type { AutoRoutedInfo } from "@/types/chat";
import type {
  ChatConversation,
  ChatMessage,
  ClaudeSessionMetadata,
  MessageSegment,
} from "@/types";
import type { ConversationStorageScope } from "@/core/conversations";
import type { FileAttachment } from "@/features/chat/attachments/fileAttachmentService";
import type { ChatEngine, ClaudeEffortLevel } from "@/cliBridges/types";
import type { PermissionModeId } from "@/core/permissions";

// Tool-execution domain types now live in the neutral leaf module `@/types/tools`
// so the desktop-backend `runtime/` layer can depend on them without importing
// upward from `features/`. Re-exported here so existing `@/features/chat/context`
// consumers keep working unchanged.
export type {
  ActiveToolCall,
  TaskItem,
  ToolApprovalDecision,
} from "@/types/tools";

import type {
  ActiveToolCall,
  TaskItem,
  ToolApprovalDecision,
} from "@/types/tools";

// ---------------------------------------------------------------------------
// Pending message queue
// ---------------------------------------------------------------------------

export interface PendingMessage {
  content: string;
  attachments: FileAttachment[];
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface ChatContextType {
  conversation:          ChatConversation | null;
  isLoading:             boolean;
  isStreaming:           boolean;
  streamingContent:      string;
  streamingMessageId:    string | null;
  error:                 string | null;
  setError:              (error: string | null) => void;
  clearError:            () => void;
  currentModel:          string;
  conversationStorageScope: ConversationStorageScope;
  setConversationStorageScope: (scope: ConversationStorageScope) => void;
  /** Which engine handles a turn: native Studio AI, or the Claude CLI bridge. */
  chatEngine:            ChatEngine;
  setChatEngine:         (engine: ChatEngine, options?: { persist?: boolean }) => void;
  claudeModel:           string;
  setClaudeModel:        (model: string) => void;
  claudeSession:         ClaudeSessionMetadata | null;
  claudePermissionMode:  PermissionModeId;
  setClaudePermissionMode: (mode: PermissionModeId) => void;
  claudeEffortLevel:     ClaudeEffortLevel;
  setClaudeEffortLevel:  (level: ClaudeEffortLevel) => void;
  sendMessage:           (content: string, useStreaming?: boolean, attachments?: FileAttachment[]) => Promise<void>;
  sendVoiceMessage:      () => Promise<void>;
  sendTranscribedText:   (text: string) => Promise<void>;
  isRecordingVoice:      boolean;
  editMessage:           (messageId: string, newContent: string) => Promise<void>;
  editMessageAndRegenerate: (messageId: string, newContent: string) => Promise<void>;
  deleteMessageById:     (messageId: string) => Promise<void>;
  regenerateResponse:    () => Promise<void>;
  continueResponse:      () => Promise<void>;
  clearChat:             () => void;
  setModel:              (model: string) => void;
  loadConversationById:  (id: string) => Promise<void>;
  createNewConversation: (scope?: ConversationStorageScope, options?: { preserveProject?: boolean }) => void;
  forkConversationToStudio: () => Promise<void>;
  updateTitle:           (title: string) => Promise<void>;
  // Lazy loading
  displayedMessages:         ChatMessage[];
  appendToDisplayedMessages: (message: ChatMessage) => void;
  hasMoreMessages:           boolean;
  loadMoreMessages:          () => Promise<void>;
  isLoadingMore:             boolean;
  // Active tool cards (real-time during streaming)
  activeToolCalls:       ActiveToolCall[];
  // Permission system
  permittedTools:        string[];
  grantToolPermission:   (tool: string) => void;
  revokeToolPermission:  (tool: string) => void;
  // Model capabilities
  currentModelSupportsVision: boolean;
  // Auto-routing
  autoRoutedModel:       AutoRoutedInfo | null;
  // Memory
  enableMemoryForConversation: (enabled: boolean) => Promise<void>;
  isMemoryEnabled:       boolean;
  // Context health indicator
  isSummarizing:         boolean;
  contextTokens:         number;
  contextLimit:          number;
  // Real context-window occupancy from model usage (0 = unknown, use estimate)
  usageContextTokens:    number;
  // ask_user_question tool
  answerPendingQuestion: (answer: string) => void;
  // Per-action permission approval gate (scope-based)
  resolveToolApproval:   (decision: ToolApprovalDecision) => void;
  resolveGlobalAccess:   (granted: boolean) => void;
  // Task list
  sessionTasks:          TaskItem[];
  // Pending message queue (messages queued while AI is streaming)
  pendingMessages:       PendingMessage[];
  cancelPendingMessage:  (index: number) => void;
  // Abort
  abortGeneration:       () => void;
  // Project context (opened folder)
  projectContext:        { path: string; name: string; accessMode?: "review" | "autonomous" } | null;
  setProjectContext:     (ctx: { path: string; name: string; accessMode?: "review" | "autonomous" } | null) => void;
  // Extended thinking
  thinkingContent:       string;
  reasoningBudget:       number | undefined;
  setReasoningBudget:    (budget: number | undefined) => void;
  // Studio Harness inline segments (live interleaving during streaming)
  harnessSegments:       MessageSegment[];
}
