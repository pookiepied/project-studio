import { AgentStateType, AgentMessage, ToolCall } from "../state";
import { ToolRegistry } from "../../tools";
import { ToolContext } from "../../tools/base/types";
import { logger } from "../../logger";
import { getRequestEnv, getRegistryById } from "../../context";
import {
  parseExpandArgs,
  getExpandCountSinceLastUser,
  filterToScope,
  applyExpandFilter,
} from "../../tools/agentic/expandTools";
import { retryWithBackoff } from "../../utils/retry";
import { EXPAND_TOOLS_MAX_PER_TURN } from "../../constants";
import { buildToolDirectory, buildExpandedCatalog } from "./catalog";

export interface ToolsStepResult {
  /** Tool result messages from cloud tool executions — appended to conversation. */
  toolMessages: AgentMessage[];
  /** Reserved for future async relay assistant messages — appended after tool results. */
  relayMessages: AgentMessage[];
  /** Local/MCP tool calls deferred to the client for Tauri execution. */
  pendingClientToolCalls: ToolCall[];
}

// Idempotent cloud tools that are safe to retry on transient network failures.
// Side-effectful tools (memory_write, image_generate, http_request, etc.) are
// deliberately excluded — retrying them could produce duplicate side effects.
const RETRYABLE_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "rag",
  "weather",
  "current_time",
  "user_location",
]);

/**
 * Tools step — the action step of the ReAct loop.
 *
 * Cloud tools (web_search, memory_*, http_request, etc.) are executed here
 * in parallel and their results are appended to the conversation.
 *
 * Local tools (MCP tools, client-native tools) are NOT executed here. Instead
 * they are collected into pendingClientToolCalls. The loop emits a
 * "local_tools_pending" SSE event so the STUDIO frontend can execute them via
 * Tauri and resume the conversation.
 *
 * If the local engine is not connected and a local tool is requested, an
 * "unavailable" result is returned immediately so the LLM can inform the user.
 */
export async function runToolsStep(state: AgentStateType): Promise<ToolsStepResult> {
  const lastMessage = state.messages[state.messages.length - 1];

  if (!lastMessage?.tool_calls?.length) {
    logger.warn("Tools step called with no pending tool calls");
    return { toolMessages: [], relayMessages: [], pendingClientToolCalls: [] };
  }

  const registry = getRegistryById(state.requestId);
  const env = getRequestEnv();
  const toolContext: ToolContext = {
    apiKeys: {
      tavily: state.tavilyApiKey || undefined,
    },
    // Carry _agentModel and _requestId for SpawnAgentTool to construct SubAgentRunner.
    // These are private convention fields — not part of the public UserContext API.
    userContext: {
      ...state.userContext,
      _agentModel: `${state.provider}:${state.modelId}`,
      _requestId: state.requestId,
      _localEngineConnected: state.localEngineConnected,
      _localSkillRuntimeAvailable:
        state.localEngineConnected ||
        state.runningMcpServers.some((s) => s === "studio-harness" || s === "computer-use"),
    } as any,
  };

  // Pre-scan all spawn_agent calls in this turn so each specialist can see its siblings
  interface SpawnCallMeta { id: string; agentType: string; description: string }
  const spawnCallMetas: SpawnCallMeta[] = lastMessage.tool_calls
    .filter((tc) => tc.function.name === "spawn_agent")
    .map((tc) => {
      let a: Record<string, unknown> = {};
      try {
        const p = tc.function.arguments ? JSON.parse(tc.function.arguments) : null;
        if (p !== null && typeof p === "object" && !Array.isArray(p)) a = p;
      } catch { /* ignore */ }
      return {
        id: tc.id,
        agentType: (a.agent_type as string | undefined) ?? "research",
        description: (a.description as string | undefined) ?? (a.task as string | undefined)?.slice(0, 100) ?? "",
      };
    });

  const pendingClientToolCalls: ToolCall[] = [];
  const cloudExecutions: Promise<{ tool_call_id: string; name: string; content: string }>[] = [];
  // Reserved for future async relay assistant messages.
  const relayMessages: AgentMessage[] = [];

  for (const tc of lastMessage.tool_calls) {
    // expand_tools is a virtual meta-tool — not in the registry.
    // Execution is handled inline here based on the filter value.
    if (tc.function.name === "expand_tools") {
      const { filter, hint } = parseExpandArgs(tc.function.arguments);

      // ── Index mode ─────────────────────────────────────────────────────────
      // Returns a directory listing of all connected servers and categories.
      // This is a free call — does NOT count toward the per-turn limit.
      if (filter === "index") {
        const content = buildToolDirectory(registry, state.localEngineConnected);
        cloudExecutions.push(
          Promise.resolve({ tool_call_id: tc.id, name: "expand_tools", content })
        );
        continue;
      }

      // ── Expansion limit check ───────────────────────────────────────────────
      const expandCountSinceLastUser = getExpandCountSinceLastUser(state.messages);
      if (expandCountSinceLastUser >= EXPAND_TOOLS_MAX_PER_TURN) {
        cloudExecutions.push(
          Promise.resolve({
            tool_call_id: tc.id,
            name: "expand_tools",
            content:
              "Expansion limit reached for this user turn (max 2). " +
              "Proceed with currently visible tools or ask the user for clarification.",
          })
        );
        continue;
      }

      // ── Specific expansion ─────────────────────────────────────────────────
      // Fetch tools for the given scope, then apply sub-type / server-name filter.
      const scope = filterToScope(filter);
      let allDefs = registry.getContextualDefinitions(state.localEngineConnected, {
        scope,
        coreMode: "all",
      });

      allDefs = applyExpandFilter(
        allDefs,
        (name) => registry.get(name)?.executionTarget,
        filter
      );

      // Strip LSP tools (internal plumbing) — everything else is available.
      const catalogDefs = state.localEngineConnected
        ? allDefs.filter(
            (d) => !d.function.name.startsWith("mcp_studio_harness__lsp_")
          )
        : allDefs;

      // Build organized, categorized catalog text
      const catalogText = buildExpandedCatalog(catalogDefs, filter, hint);

      // Collect co-located group prompts from returned tools
      const groupPrompts: string[] = [];
      const seenPrompts = new Set<string>();
      for (const d of catalogDefs) {
        const tool = registry.get(d.function.name);
        if (tool?.groupPrompt && !seenPrompts.has(tool.groupPrompt)) {
          seenPrompts.add(tool.groupPrompt);
          groupPrompts.push(tool.groupPrompt);
        }
      }

      cloudExecutions.push(
        Promise.resolve({
          tool_call_id: tc.id,
          name: "expand_tools",
          content:
            catalogText +
            (groupPrompts.length > 0
              ? `\n\n---\n\n${groupPrompts.join("\n\n---\n\n")}`
              : ""),
        })
      );
      continue;
    }

    const tool = registry.get(tc.function.name);

    if (tool?.executionTarget === "mcp") {
      // Local MCP tools defer to client — route through Tauri subprocess
      pendingClientToolCalls.push(tc);
      continue;
    }

    if (tc.function.name === "task_write") {
      // Resolve task_write inline — no round-trip to the client.
      //
      // task_write is logically "client-native" (it updates React state in the
      // STUDIO frontend), but deferring it via local_tools_pending forces a full
      // HTTP round-trip: the graph ends, the frontend handles it instantly, then
      // immediately re-sends all messages + 71 KB of tool schemas back to the
      // Worker for the LLM to process again.  On a large context (round 4+ of an
      // agentic task) that round-trip costs 20–60 s of silent DeepSeek processing,
      // which looks like the agent is hung.
      //
      // Fix: return a success result immediately.  The tasks are embedded in the
      // tool_complete event so the frontend can update its task list from
      // onToolComplete without any extra round-trip.
      let parsedTodos: unknown[] = [];
      try {
        const a = tc.function.arguments ? JSON.parse(tc.function.arguments) : null;
        if (a && typeof a === "object" && !Array.isArray(a) && Array.isArray((a as any).todos)) {
          parsedTodos = (a as any).todos;
        }
      } catch { /* ignore malformed args — empty list is safe */ }
      cloudExecutions.push(
        Promise.resolve({
          tool_call_id: tc.id,
          name: "task_write",
          content: JSON.stringify({ status: "updated", todos: parsedTodos }),
        })
      );
      continue;
    }

    if (tool?.executionTarget === "client") {
      // Client-native tools (other than task_write, which is handled above) —
      // deferred to the STUDIO frontend via local_tools_pending.
      pendingClientToolCalls.push(tc);
      continue;
    }

    if (tool?.executionTarget === "remote_mcp") {
      // Remote MCP tools execute directly in the Worker via HTTP
      let args: Record<string, any> = {};
      try {
        const parsed = tc.function.arguments ? JSON.parse(tc.function.arguments) : null;
        args = (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
      } catch {
        logger.warn("Tools node: failed to parse remote MCP arguments", { toolName: tc.function.name });
      }

      logger.info("Tools node: executing remote MCP tool", { name: tc.function.name, args });

      cloudExecutions.push(
        registry.execute(tc.function.name, args, toolContext).then((result: import("../../tools/base/types").ToolResult) => ({
          tool_call_id: tc.id,
          name: tc.function.name,
          content: result.success
            ? typeof result.result === "string"
              ? result.result
              : JSON.stringify(result.result)
            : JSON.stringify({ error: result.error }),
        }))
      );
      continue;
    }

    if (tool?.executionTarget === "local") {
      if (!state.localEngineConnected) {
        // Local engine offline — tell the LLM
        cloudExecutions.push(
          Promise.resolve({
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify({
              status: "unavailable",
              reason:
                "Local engine is not connected. Start the engine in STUDIO Settings to enable this tool.",
            }),
          })
        );
      } else {
        pendingClientToolCalls.push(tc);
      }
      continue;
    }

    // Cloud tool — execute in the worker
    let args: Record<string, any> = {};
    try {
      const parsed = tc.function.arguments ? JSON.parse(tc.function.arguments) : null;
      // JSON.parse("null") returns null — treat non-object values as empty args
      args = (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
        ? parsed
        : {};
    } catch {
      logger.warn("Tools node: failed to parse tool arguments", {
        toolName: tc.function.name,
        raw: tc.function.arguments,
      });
    }

    logger.info("Tools node: executing cloud tool", { name: tc.function.name, args });

    // For spawn_agent calls: inject sibling metadata + the LLM tool_call_id so the
    // specialist can register itself in the DO with a back-link to this tool call card.
    const execContext: ToolContext =
      tc.function.name === "spawn_agent"
        ? {
            ...toolContext,
            userContext: {
              ...toolContext.userContext,
              _toolCallId: tc.id,
              ...(spawnCallMetas.length > 1
                ? {
                    _siblingAgents: spawnCallMetas
                      .filter((s) => s.id !== tc.id)
                      .map((s) => ({ agentType: s.agentType, description: s.description })),
                  }
                : {}),
            } as any,
          }
        : toolContext;

    const executeFn = () => registry.execute(tc.function.name, args, execContext);
    const execute = RETRYABLE_TOOLS.has(tc.function.name)
      ? () => retryWithBackoff(executeFn, 2, 1000)
      : executeFn;

    cloudExecutions.push(
      execute().then((result: import("../../tools/base/types").ToolResult) => ({
        tool_call_id: tc.id,
        name: tc.function.name,
        content: result.success
          ? typeof result.result === "string"
            ? result.result
            : JSON.stringify(result.result)
          : JSON.stringify({ error: result.error }),
      }))
    );
  }

  const cloudResults = await Promise.all(cloudExecutions);

  const toolMessages: AgentMessage[] = cloudResults.map((r) => ({
    role: "tool",
    content: r.content,
    tool_call_id: r.tool_call_id,
    name: r.name,
  }));

  logger.info("Tools step complete", {
    cloudTools: cloudResults.length,
    pendingLocalTools: pendingClientToolCalls.length,
    relayMessages: relayMessages.length,
  });

  return {
    toolMessages,
    relayMessages,
    pendingClientToolCalls,
  };
}
