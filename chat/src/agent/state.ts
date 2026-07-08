import { UserContext } from "../tools/base/types";

// Types are defined in gateway/types.ts so the gateway worker can import them
// without depending on orchestration code.
import type { AgentMessage, ToolCall } from "../server/types";
export type { AgentMessage, ToolCall };

/**
 * Plain TypeScript state passed through the agent loop.
 *
 * Replaces the LangGraph Annotation.Root() schema. All fields are now
 * simple value types — no reducers, no defaults, no framework magic.
 * The loop in loop.ts owns state accumulation.
 */
export interface AgentStateType {
  // Conversation history — accumulated by the loop
  messages: AgentMessage[];

  // Provider details set once at invocation start
  modelId: string;
  provider: string;
  apiKey: string;
  apiBaseUrl: string;

  // Inference parameters
  temperature: number;
  maxTokens?: number;

  // Whether the local engine (Studio Harness) is currently connected
  localEngineConnected: boolean;

  // MCP servers reported running by the STUDIO desktop client for this turn
  runningMcpServers: string[];

  // Local/MCP tool calls deferred to the client for Tauri execution
  pendingClientToolCalls: ToolCall[];

  // Tavily API key for the web_search cloud tool
  tavilyApiKey: string;

  // User context derived from Cloudflare request metadata
  userContext?: UserContext;

  // Unique ID for this request — used to look up the per-request ToolRegistry
  requestId: string;

  // When set, llmStep returns this message as-is and clears the field,
  // skipping a redundant API call (Phase 1 already obtained this message).
  precomputedAssistantMessage?: AgentMessage | null;
}
