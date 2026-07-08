// LLM wire-format types — live here so gateway workers can import them
// without depending on chat/src/orchestration/.
// orchestration/agent/state.ts re-exports these.

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<
    | { type: "text"; text?: string }
    | { type: "image_url"; image_url?: { url: string; detail?: "low" | "high" | "auto" } }
    | { type: "file"; mimeType: string; data: string; filename?: string }
    | { type: "video_url"; video_url?: { url: string } }
  >;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{
    type: "text" | "image_url";
    text?: string;
    image_url?: {
      url: string;
      detail?: "low" | "high" | "auto";
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: any;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  local_engine_connected?: boolean;
  /**
   * Names of MCP servers currently running on the client (e.g. ["google-workspace"]).
   * Only tools from listed servers are injected into the LLM context.
   * When omitted or empty, no MCP tool schemas are sent (server must be running to be usable).
   */
  running_mcp_servers?: string[];
  /**
   * Conversation storage scope: "local" runs on the user's machine and may use
   * local MCP servers; "cloud" must never expose them. Used as a hard guard on
   * `local_engine_connected` so a cloud conversation can never enable local
   * tools even if the flag or harness marker is present.
   */
  storage_scope?: "cloud" | "local";
  /**
   * When true, bypass the LangGraph agent loop and call the provider directly.
   * Use for single-turn utility calls (rephrase, classify, etc.) where agent
   * tools and the ReAct loop are not needed and can cause misbehaviour.
   */
  direct?: boolean;
  /**
   * Maximum number of LLM iterations the agent graph may run before the server
   * emits an "iteration_limit_reached" SSE event so the client can continue.
   * Defaults to the state default (100) when omitted.
   */
  max_iterations?: number;
  /**
   * Identifies the calling application or surface for tracking purposes.
   * Examples: "studio", "api", "mobile", "web". Stored in usage_events.source.
   */
  calling_app?: string;

  /**
   * Extended thinking / reasoning budget in tokens.
   * Preset levels: low=4096, medium=8192, high=16384.
   * Set to 0 to disable thinking on models that default-enable it.
   * Omit to use the provider's default behaviour.
   */
  reasoning_budget?: number;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface TranscribeRequest {
  file: File | Blob;
  model: string;
  language?: string;
  temperature?: number;
  response_format?: string;
}

export interface TranscribeResponse {
  text: string;
  language?: string;
  duration?: number;
}

export interface Model {
  id: string;
  provider: string;
  /**
   * High-level category used for routing and frontend grouping.
   * Import ModelType from discovery/taxonomy.ts when building providers.
   */
  type: "chat" | "audio" | "embedding" | "image" | "video" | "tts" | "multimodal";
  name: string;
  description?: string;
  maxTokens?: number;
  contextWindow?: number;
  /**
   * Token pricing in USD per 1 000 000 tokens.
   * null  = pricing explicitly unknown (display "N/A")
   * undefined = field not populated (treat same as null in UI)
   */
  pricing?: {
    /** Cost per 1 000 000 input tokens in USD (or per request for audio/image). */
    input: number;
    /** Cost per 1 000 000 output tokens in USD. 0 for audio/embedding/image. */
    output: number;
    currency?: string;
  } | null;
  free?: boolean;
  /**
   * Fine-grained feature tags (ModelCapability from discovery/taxonomy.ts).
   * Used by the frontend for filtering, display, and routing decisions.
   */
  capabilities?: string[];
  /** Human-readable list of media modalities (e.g. ["text", "image"]). */
  modality?: string[];
  architecture?: string;
  created?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsParallelTools?: boolean;
  supportsStreaming?: boolean;
  supportsSystemPrompts?: boolean;
  inputTypes?: ("text" | "image" | "audio" | "video")[];
  outputTypes?: ("text" | "image" | "audio" | "video" | "embedding")[];
  specialFeatures?: ("thinking" | "reasoning" | "code" | "math" | "creative")[];
}

export interface ProviderContract {
  provider: string;
  status: "active" | "inactive" | "error";
  lastChecked: string;
  apiKeyValid: boolean;
  modelCount: number;
  errorMessage?: string;
  rateLimit?: {
    rpm: number;
    rpd: number;
  };
}

export interface ModelsResponse {
  models: Model[];
  providers: Record<string, ProviderContract>;
  lastUpdated: string;
  totalModels: number;
  uniqueModels: number;
}

export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  worker: string;
  timestamp: string;
  version: string;
  /** Per-binding probe results. Only present when bindings were checked. */
  bindings?: Record<string, "ok" | "error">;
}

export interface ErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}
