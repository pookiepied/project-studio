// Chat domain types — moved from src/types/index.ts per T5.5 (D-527 shim pattern).

// ---------------------------------------------------------------------------
// Harness execution events (Studio Harness inline cards)
// ---------------------------------------------------------------------------

export interface HarnessEvent {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result?: unknown;
  /** Human-readable verb, e.g. "Editing", "Edited", "Ran" */
  label: string;
  /** Short target string, e.g. "ChatProvider.tsx" or "npm install" */
  target: string;
  /** Diff stats for file-edit operations */
  diffStats?: { added: number; removed: number };
  /** Line range for read operations, e.g. "38–97" */
  lineRange?: string;
  /** Truncated output/diff for the expanded preview pane */
  preview?: string;
}

/** A slice of an assistant message — either a prose block or a harness step card. */
export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "harness_event"; event: HarnessEvent }
  | { type: "user_question"; id: string; question: string; answer?: string };

// ---------------------------------------------------------------------------
// Chat types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  imageUrls?: string[];
  documentAttachments?: { name: string; extension: string }[];
  /**
   * Interleaved prose + harness-event segments.
   * Populated only for assistant messages that triggered Studio Harness tools.
   * When present, used for display in place of the plain `content` field.
   * `content` always holds the full prose text (for LLM context / clipboard).
   */
  segments?: MessageSegment[];
  /** Extended thinking / reasoning content captured during streaming. Collapsible in UI. */
  thinkingContent?: string;
  metadata?: {
    type?: 'permission-request' | 'normal';
    operation?: {
      type: string;
      path: string;
      content?: string;
    };
    onApprove?: () => void;
    onDeny?: () => void;
  };
}

export interface ClaudeRateLimitInfo {
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
  isUsingOverage?: boolean;
  surpassedThreshold?: boolean | number;
}

export interface ClaudeSessionMetadata {
  sessionId?: string;
  model?: string;
  permissionMode?: string;
  effortLevel?: string;
  cwd?: string;
  projectKey?: string;
  transcriptPath?: string;
  /** Cost the CLI reported for the most recent turn (one `claude -p` invocation). */
  lastCostUsd?: number;
  lastDurationMs?: number;
  /** Real token usage the CLI reported for the most recent turn (from the
   *  `result` event's `usage`). Ground truth — counts the system prompt, skills,
   *  tool schemas, and every file-read result, not just the visible chat. Sum of
   *  the input fields is the current context-window occupancy. */
  lastInputTokens?: number;
  lastOutputTokens?: number;
  lastCacheReadTokens?: number;
  lastCacheCreationTokens?: number;
  /** Running sum of every turn's cost for THIS conversation. Persisted in
   *  conversation metadata, so it survives restarts and dies with the chat. */
  totalCostUsd?: number;
  lastTurnAt?: number;
  rateLimit?: ClaudeRateLimitInfo;
}

export interface ConversationMetadata {
  /** "cloud" is a legacy alias for "claude" kept for backward-compat reads. */
  provider?: "studio" | "cloud" | "claude";
  /** Cloud chats are portable. Local chats may use local files, tools, or CLI bridges. */
  storageScope?: "cloud" | "local";
  /** Which transcript system is authoritative for continuing this conversation. */
  owner?: "studio" | "claude";
  /** Folder/project this local Studio conversation belongs to, when any. */
  project?: {
    path: string;
    name: string;
    accessMode?: "review" | "autonomous";
  };
  forkedFrom?: {
    owner: "studio" | "claude";
    conversationId: string;
    sessionId?: string;
    cwd?: string;
  };
  claude?: ClaudeSessionMetadata;
}

export interface MessageOptions {
  type?: 'permission-request' | 'normal';
  operation?: {
    type: string;
    path: string;
    content?: string;
  };
  onApprove?: () => void;
  onDeny?: () => void;
}

export interface ChatConversation {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /**
   * A rolling plain-text summary of messages older than `summarizedUpToIndex`.
   * Injected as a system message on every API call so the model retains
   * historical context without re-sending all raw messages.
   */
  contextSummary?: string;
  /**
   * The index (inclusive) of the last message in `messages` that is already
   * covered by `contextSummary`. Messages at index > summarizedUpToIndex are
   * still sent as raw turns; older ones are represented by the summary only.
   */
  summarizedUpToIndex?: number;
  metadata?: ConversationMetadata;
}
