import { ChatPipelineContext } from "./types";
import { buildSystemPrompt } from "../prompts/system";
import { AgentMessage } from "../agent/state";
import { McpServerSummary } from "../tools/mcp";
import { HARNESS_MARKER } from "../constants";

/**
 * Returns true for the one-liner marker injected by STUDIO's ChatContext when
 * Studio Harness is connected but no project folder is pinned.  All guidance
 * that used to live in that marker payload has moved into the Worker's own
 * harnessSection / studioCodingOverlay — so this message no longer carries
 * useful content and should be discarded rather than appended.
 */
function isBareHarnessMarker(content: string): boolean {
  return content.trim() === HARNESS_MARKER;
}

/**
 * Builds the system prompt and prepends it to the message list.
 *
 * Two distinct paths based on studioMode (localEngineConnected):
 *
 * STUDIO main chat (studioMode = true):
 *   Always inject the Worker's full orchestration prompt.  Merge any real
 *   per-session context the client sends (e.g. [project-context] block with
 *   root_dir and agent call examples).  Strip the bare harness identification
 *   marker — that guidance now lives in the Worker's harnessSection.
 *
 * Sub-agents / regular API callers (studioMode = false):
 *   Restore the original hasSystemMessage guard.  Sub-agents call the same
 *   /api/v1/chat/completions endpoint with their own focused system prompts
 *   (e.g. "You are Coder, a specialist implementation agent…").  We must NOT
 *   prepend the full orchestration prompt there — harnessSection(false) would
 *   tell the coder LLM that "Studio Harness is NOT connected", breaking it.
 *   When the caller supplies a system message, honour it as-is.  When there
 *   is no system message (plain API callers), fall back to the Worker prompt.
 */
export function assembleMessages(ctx: ChatPipelineContext): void {
  const composioMcpServers: McpServerSummary[] = ctx.composioApps.map((app) => ({
    serverName: `composio-${app.appName}`,
    displayName: `Composio: ${app.displayName}`,
    type: "remote" as const,
    tools: app.tools,
  }));

  // Use localEngineConnected as the authoritative signal for studio mode — NOT the MCP
  // server list, which may not be populated yet due to a ~60 s D1 sync delay on first
  // request. Tying studioMode to the server list caused the overlay to be silently
  // skipped on the first turn, leaving the LLM with no decision flow or agent guidance.
  const studioMode = ctx.localEngineConnected === true;

  const incomingMessages = ctx.body.messages as AgentMessage[];

  if (studioMode) {
    // ── STUDIO main chat ─────────────────────────────────────────────────────
    // Always build the full Worker prompt and merge real client context.
    const workerSystemContent = buildSystemPrompt({
      localEngineConnected: ctx.localEngineConnected,
      userContext: ctx.userContext,
      userProfile: ctx.userProfile,
      memoryContext: ctx.memoryContext,
      skillsIndex: ctx.skillsIndex,
      mcpServers: [...ctx.mcpServers, ...composioMcpServers],
    });

    const clientSystemMessages = incomingMessages.filter((m) => m.role === "system");
    const conversationMessages = incomingMessages.filter((m) => m.role !== "system");

    // Keep any client system content that carries real per-session context
    // (e.g. the [project-context] block with root_dir and agent call examples).
    // Discard the bare harness marker — its guidance is now owned by the Worker.
    const additionalCtx = clientSystemMessages
      .map((m) => (typeof m.content === "string" ? m.content : "").trim())
      .filter((content) => content.length > 0 && !isBareHarnessMarker(content))
      .join("\n\n");

    const finalSystemContent = additionalCtx
      ? `${workerSystemContent}\n\n---\n\n${additionalCtx}`
      : workerSystemContent;

    ctx.messages = [
      { role: "system", content: finalSystemContent },
      ...conversationMessages,
    ];
  } else {
    // ── Sub-agents / regular API callers ─────────────────────────────────────
    // Honour the caller's own system prompt.  Sub-agents (Explorer, Planner,
    // Coder, Tester, etc.) each supply a focused system prompt tailored to
    // their role.  Prepending the orchestration prompt here would pollute
    // their context with harnessSection(false) — "harness NOT connected" —
    // and break their behaviour.  Only fall back to the Worker prompt when
    // the caller sends no system message at all (plain API callers).
    const hasSystemMessage = incomingMessages.some((m) => m.role === "system");

    if (!hasSystemMessage) {
      const workerSystemContent = buildSystemPrompt({
        localEngineConnected: ctx.localEngineConnected,
        userContext: ctx.userContext,
        userProfile: ctx.userProfile,
        skillsIndex: ctx.skillsIndex,
        mcpServers: [...ctx.mcpServers, ...composioMcpServers],
      });

      ctx.messages = [
        { role: "system", content: workerSystemContent },
        ...incomingMessages,
      ];
    } else {
      // Sub-agent path: pass messages through untouched.
      ctx.messages = [...incomingMessages];
    }
  }
}
