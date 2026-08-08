import { ChatPipelineContext } from "./types";
import { AgentMessage } from "../agent/state";
import { setRequestRegistry, setRequestContext } from "../context";
import { logger } from "../logger";

function fnv1a32(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function deriveConversationFingerprint(messages: AgentMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");

  const userContent =
    typeof firstUser?.content === "string"
      ? firstUser.content.slice(0, 200)
      : Array.isArray(firstUser?.content)
      ? (firstUser.content as { type: string; text?: string }[])
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("")
          .slice(0, 200)
      : "";

  return fnv1a32(userContent);
}

/**
 * If this is a local model request, returns the local_inference_required
 * payload immediately so the client can call the local daemon.
 */
export function buildLocalDispatch(ctx: ChatPipelineContext): Response | null {
  if (!ctx.isLocalProvider) return null;

  logger.info(`[chat] Returning local_inference_required for ${ctx.body.model}`);

  const tools = ctx.requestRegistry.getContextualDefinitions(ctx.localEngineConnected, {
    coreMode: "baseline",
  });
  const callbackBase = (ctx.env.PUBLIC_API_BASE ?? "").replace(/\/$/, "");
  const payload = {
    type:            "local_inference_required",
    model:           ctx.body.model,
    messages:        ctx.messages,
    tools,
    toolCallbackUrl: callbackBase ? `${callbackBase}/v1/tool-execute` : null,
  };

  if (ctx.body.stream) {
    return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
      status:  200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  return new Response(JSON.stringify(payload), {
    status:  200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Generates the requestId, derives the conversation thread ID, and registers
 * the ToolRegistry in module-level context maps for downstream tool nodes.
 *
 * AgentContext (formerly AgentContextDurableObject) is no longer created here.
 * Sub-agents (research) get their own DO state in studio-agents.
 */
export function setupDispatch(ctx: ChatPipelineContext): void {
  const requestId = crypto.randomUUID();
  setRequestRegistry(requestId, ctx.requestRegistry);

  const conversationFingerprint = deriveConversationFingerprint(ctx.messages);
  const threadId = ctx.userId
    ? `${ctx.userId}:${conversationFingerprint}`
    : requestId;

  setRequestContext(requestId, threadId);

  ctx.requestId     = requestId;
  ctx.threadId      = threadId;
  ctx.workerBaseUrl = (ctx.env.PUBLIC_API_BASE ?? "").replace(/\/$/, "");
  ctx.tavilyApiKey  = ctx.env.TAVILY_API_KEY ?? "";
}
