import { invoke } from "@tauri-apps/api/core";
import type { APIChatMessage } from "@/types/chat";
import type { ChatRequestBody } from "../protocol";
import type { ConversationStorageScope } from "@/core/conversations";
import {
  filterMcpServersForConversationScope,
  setLocalMcpServerNames,
} from "@/core/permissions/scope";
import { LOCAL_MCP_SERVERS } from "../servers/catalog";

/**
 * Sync the permission layer's notion of which MCP servers are machine-bound.
 * The authoritative local set is the bundled catalogue (always local) unioned
 * with whatever is currently running as a local subprocess — everything
 * `mcp_list_running` reports is, by construction, a local process. Refreshed on
 * every request build so a newly-started server is scoped correctly at once.
 */
function refreshLocalMcpIdentity(runningServerNames: string[]): void {
  setLocalMcpServerNames([
    ...LOCAL_MCP_SERVERS.map((s) => s.name),
    ...runningServerNames,
  ]);
}

export interface ChatBodyParams {
  messages: APIChatMessage[];
  model: string;
  runningMcpServers: string[];
  storageScope: ConversationStorageScope;
  reasoningBudget?: number;
  userId?: string;
}

export function buildChatBody({
  messages,
  model,
  runningMcpServers,
  storageScope,
  reasoningBudget,
  userId,
}: ChatBodyParams): ChatRequestBody {
  const scopedMcpServers = filterMcpServersForConversationScope(runningMcpServers, storageScope);

  return {
    messages,
    model,
    local_engine_connected: scopedMcpServers.includes("studio-harness"),
    running_mcp_servers: scopedMcpServers,
    storage_scope: storageScope,
    persistence: storageScope === "local" ? "client_local" : "cloud",
    ...(userId ? { user_id: userId } : {}),
    ...(reasoningBudget != null ? { reasoning_budget: reasoningBudget } : {}),
  };
}

export async function getMcpServers(scope: ConversationStorageScope = "local"): Promise<string[]> {
  try {
    const running = await invoke<string[]>("mcp_list_running");
    // Keep the permission layer's local-server identity fresh before scoping,
    // so a just-started server is filtered/gated correctly on this very request.
    refreshLocalMcpIdentity(running);
    return filterMcpServersForConversationScope(running, scope);
  } catch {
    return [];
  }
}
