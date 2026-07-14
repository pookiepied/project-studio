import type { Env } from "../env";
import type { ChatRequest } from "../server/types";
import type { AgentMessage } from "../agent/state";
import type { UserContext } from "../tools/base/types";
import type { Router, RouterDecision } from "../server/router";
import type { DynamicMCPTool, RemoteMCPTool, NativeMCPTool, ServiceBindingMCPTool, McpServerSummary } from "../tools/mcp";
import type { ComposioTool, ComposioAppSummary } from "../tools/composio";
import type { ToolRegistry } from "../tools";

/**
 * Mutable context object that flows through every pipeline stage.
 *
 * Stages are called in a fixed order by the coordinator (routes/chat.ts).
 * Each stage reads the fields set by prior stages and writes its own.
 * Fields are grouped below by the stage that owns them.
 *
 * Sub-agent state lives in the research sub-agent DO state (studio-agents)
 * and ChatAgent DO SQLite — not in this context object.
 */
export interface ChatPipelineContext {
  // ── Coordinator-provided (always set before any stage runs) ─────────────
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  body: ChatRequest;
  requestStart: number;
  isServiceBinding: boolean;

  // ── parse stage ─────────────────────────────────────────────────────────
  provider: string;
  modelId: string;
  isLocalProvider: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  modelType: string;
  apiKey: string;
  apiBaseUrl: string;
  autoRouter: Router | null;
  autoRouterDecision: RouterDecision | null;

  // ── userContext stage ────────────────────────────────────────────────────
  userId: string | undefined;
  userContext: UserContext;
  localEngineConnected: boolean;

  // ── preload stage ────────────────────────────────────────────────────────
  userProfile: string | null;
  memoryContext: string | null;
  /** Prompt-ready skills index text fetched from studio-skills (Available Skills section). */
  skillsIndex: string | null;
  mcpServers: McpServerSummary[];
  mcpDynamicTools: (DynamicMCPTool | RemoteMCPTool | NativeMCPTool | ServiceBindingMCPTool)[];
  composioTools: ComposioTool[];
  composioApps: ComposioAppSummary[];
  requestRegistry: ToolRegistry;

  // ── systemPrompt + vision stages ─────────────────────────────────────────
  messages: AgentMessage[];
  // Populated by preprocessVision when base64/https images are uploaded to R2.
  // Each entry maps to an image_url part in the last user message, in order.
  visionSubstitutions?: Array<{ presignedUrl: string }>;

  // ── parse stage (extended) ───────────────────────────────────────────────
  /** Reasoning budget passed from the request body (undefined = provider default). */
  reasoningBudget?: number;

  // ── dispatch stage ───────────────────────────────────────────────────────
  requestId: string;
  threadId: string;
  workerBaseUrl: string;
  tavilyApiKey: string;
}
