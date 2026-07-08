import { ChatPipelineContext } from "./types";
import { loadMcpTools, loadBuiltinMcpTools } from "../tools/mcp";
import { STUDIO_HARNESS_BLOCKED } from "../tools/mcp/blocklist";
import { ComposioTool } from "../tools/composio/ComposioTool";
import { createRequestRegistry } from "../tools";
import { logger } from "../logger";
import { emit } from "../tracking";
import type { AgentMessage } from "../agent/state";

/**
 * Fire-and-forget: send completed conversation messages to STUDIO Memory for
 * background extraction and storage. Zero latency impact — runs after response
 * is returned via ctx.waitUntil.
 *
 * Called from both the HTTP path (nonStreaming / streaming) and ChatAgent.
 * Silently skips if MEMORY binding or userId is absent.
 */
export function fireMemoryProcess(
  ctx: ChatPipelineContext,
  resolvedMessages: AgentMessage[],
): void {
  const { env, ctx: execCtx, userId, requestId } = ctx;
  if (!userId || !env.MEMORY) return;

  const turnMessages = resolvedMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-30);

  if (turnMessages.length === 0) return;

  execCtx.waitUntil(
    env.MEMORY.fetch(
      new Request("http://memory/process", {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          ...(env.MEMORY_AUTH_SECRET ? { Authorization: `Bearer ${env.MEMORY_AUTH_SECRET}` } : {}),
        },
        body: JSON.stringify({
          user_id:         userId,
          conversation_id: requestId,
          messages:        turnMessages,
        }),
      })
    ).catch(() => {})
  );
}

function lastUserMessage(messages: { role: string; content: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    }
  }
  return "";
}

/**
 * Fetches STUDIO Memory context, MCP tools, and Composio tools in parallel,
 * then builds the per-request tool registry.
 */
export async function preload(ctx: ChatPipelineContext): Promise<void> {
  const { env, userId, body } = ctx;
  const runningServers = body.running_mcp_servers ?? [];
  const hasLocalRuntime = ctx.localEngineConnected || runningServers.some((s) => s === "studio-harness" || s === "computer-use");
  const skillsRuntime = hasLocalRuntime ? "local" : "cloud";
  const skillsHeaders: Record<string, string> = env.SKILLS_AUTH_SECRET
    ? { Authorization: `Bearer ${env.SKILLS_AUTH_SECRET}` }
    : {};

  // STUDIO Memory — auto-inject context block for the system prompt.
  // Embeds the latest user message, runs vector search + profile + recent activity.
  // Non-blocking on failure: chat continues with no memory context.
  const memoryPromise: Promise<string | null> =
    userId && env.MEMORY
      ? env.MEMORY.fetch(
          new Request("http://memory/inject", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(env.MEMORY_AUTH_SECRET
                ? { Authorization: `Bearer ${env.MEMORY_AUTH_SECRET}` }
                : {}),
            },
            body: JSON.stringify({
              user_id: userId,
              message: lastUserMessage(body.messages ?? []),
            }),
          })
        )
          .then((r) => r.json<{ context: string }>())
          .then((d) => d.context || null)
          .catch(() => null)
      : Promise.resolve(null);

  // STUDIO Skills — fetch the prompt-ready skills index for the system prompt.
  // Returns a compact "- **{key}**: {description}" block the assistant can scan
  // to decide which skill to load. Non-blocking on failure: chat continues
  // with no skills section.
  const skillsPromise: Promise<string | null> =
    env.SKILLS
      ? env.SKILLS.fetch(
          new Request(
            `http://studio-skills/internal/skills/index?userId=${encodeURIComponent(userId ?? "")}&runtime=${skillsRuntime}`,
            { method: "GET", headers: skillsHeaders }
          )
        )
          .then(async (res) => {
            if (!res.ok) return null;
            const data = await res.json<{ index?: string }>();
            return data.index || null;
          })
          .catch(() => null)
      : Promise.resolve(null);

  const mcpPromise =
    userId && env.MCP && env.MCP_KV
      ? loadMcpTools(userId, env.MCP, env.MCP_KV, body.running_mcp_servers)
          .then((mcp) => {
            logger.info("Chat: MCP tools loaded", {
              userId,
              toolCount: mcp.tools.length,
              serverCount: mcp.servers.length,
            });
            return mcp;
          })
          .catch((e) => {
            logger.error("Chat: MCP load failed", e);
            emit(env, ctx.ctx, { event: 'preload.mcp.failed', severity: 'warn', userId, data: { error: e?.message } });
            return { tools: [], servers: [] };
          })
      : Promise.resolve({ tools: [], servers: [] });

  // Composio tools — discovery via studio-mcp internal endpoint.
  // mcp/hub owns COMPOSIO_API_KEY and all Composio execution; chat only
  // reconstructs ComposioTool proxy instances from the returned schemas.
  const composioPromise: Promise<{ tools: ComposioTool[]; apps: { appName: string; displayName: string; tools: { name: string; description: string }[] }[] }> =
    userId && env.MCP
      ? env.MCP.fetch(new Request(`http://studio-mcp/internal/tools/composio?userId=${encodeURIComponent(userId)}`, { method: "GET" }))
          .then(async (res) => {
            if (!res.ok) throw new Error(`mcp/internal/tools/composio returned HTTP ${res.status}`);
            const data = await res.json<{ tools: { slug: string; name: string; description: string; inputParameters: Record<string, unknown>; connectionId: string }[]; apps: { appName: string; displayName: string; tools: { name: string; description: string }[] }[] }>();
            const composioTools = (data.tools ?? []).map(
              (s) => new ComposioTool(s.slug, s.name, s.description, s.inputParameters, s.connectionId, userId!)
            );
            logger.info("Chat: Composio tools loaded via mcp/hub", { userId, toolCount: composioTools.length, appCount: data.apps?.length ?? 0 });
            return { tools: composioTools, apps: data.apps ?? [] };
          })
          .catch((e) => {
            logger.error("Chat: Composio load failed", e);
            emit(env, ctx.ctx, { event: 'preload.composio.failed', severity: 'warn', userId, data: { error: e?.message } });
            return { tools: [], apps: [] };
          })
      : Promise.resolve({ tools: [], apps: [] });

  // STUDIO built-in MCP servers — always-on, no user install needed.
  // Runs synchronously (no I/O) so no separate promise needed.
  const { tools: builtinTools, servers: builtinServers } = loadBuiltinMcpTools(env as unknown as Record<string, unknown>);

  const [memoryContext, skillsIndex, { tools: userMcpTools, servers: userMcpServers }, { tools: composioTools, apps: composioApps }] =
    await Promise.all([memoryPromise, skillsPromise, mcpPromise, composioPromise]);

  // Merge built-in tools before user tools so they always appear in the registry
  const mcpDynamicTools = [...builtinTools, ...userMcpTools];
  const mcpServers      = [...builtinServers, ...userMcpServers];

  // Auto-detect Studio Harness from the loaded MCP tools.
  if (!ctx.localEngineConnected && mcpDynamicTools.some((t) => t.name.startsWith("mcp_studio_harness__"))) {
    ctx.localEngineConnected = true;
    logger.info("preload: Studio Harness auto-detected from loaded MCP tools — localEngineConnected set to true");
  }

  const filteredMcpDynamicTools = ctx.localEngineConnected
    ? mcpDynamicTools.filter(
        (t) =>
          !STUDIO_HARNESS_BLOCKED.has(t.name) &&
          !t.name.startsWith("mcp_studio_harness__lsp_")
      )
    : mcpDynamicTools;

  if (ctx.localEngineConnected && filteredMcpDynamicTools.length !== mcpDynamicTools.length) {
    logger.info("preload: blocked tools filtered from registry", {
      before: mcpDynamicTools.length,
      after: filteredMcpDynamicTools.length,
      removed: mcpDynamicTools.length - filteredMcpDynamicTools.length,
    });
  }

  ctx.userProfile = null;
  ctx.memoryContext = memoryContext;
  ctx.skillsIndex = skillsIndex;
  ctx.mcpDynamicTools = filteredMcpDynamicTools;
  ctx.mcpServers = mcpServers;
  ctx.composioTools = composioTools;
  ctx.composioApps = composioApps;
  ctx.requestRegistry = createRequestRegistry([...filteredMcpDynamicTools, ...composioTools]);
}
