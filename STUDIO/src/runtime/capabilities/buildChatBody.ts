import { invoke } from "@tauri-apps/api/core";
import type { APIChatMessage } from "@/types/chat";
import type { ChatRequestBody } from "../protocol";
import type { ConversationStorageScope } from "@/core/conversations";
import { filterMcpServersForConversationScope } from "@/core/permissions/scope";

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
    return filterMcpServersForConversationScope(running, scope);
  } catch {
    return [];
  }
}
