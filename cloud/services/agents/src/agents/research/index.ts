import { BaseAgentDO } from "../../runtime/agentDO";
import { loadAgentTools } from "../../tools/loader";
import type { Env } from "../../env";
import type { AgentToolDescriptor } from "../../tools/types";
import { RESEARCH_SYSTEM_PROMPT } from "./prompt";

const ALLOWED_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "rag",
  "http_request",
]);

/**
 * ResearchAgent — deep web research + RAG synthesis.
 *
 * Fixed tool set: web_search, web_fetch, rag, http_request.
 * Writes a structured Markdown report as its final message.
 * Intended to be spawned in parallel (one per sub-topic) so the
 * main agent can continue other work while research runs.
 */
export class ResearchAgent extends BaseAgentDO {
  protected readonly SYSTEM_PROMPT = RESEARCH_SYSTEM_PROMPT;

  protected async buildToolDescriptors(env: Env, userId: string): Promise<AgentToolDescriptor[]> {
    const all = await loadAgentTools(env, userId);
    return all.filter(t => t.source === "native" && ALLOWED_TOOLS.has(t.name));
  }
}
