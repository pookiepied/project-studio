/**
 * Shared blackboard tools — read and write structured data to the per-request
 * AgentContextDO key-value store so agents can share findings in real-time.
 *
 * The blackboard is shared across all agents in the same request:
 *   - Any agent (parent or sub-agent) can write to any key
 *   - Any agent can read any key or list all entries
 *   - Data is available immediately after writing — no polling delay
 *   - Everything expires automatically when the request context is cleaned up (30 min)
 *
 * Internal keys (e.g. `{agentId}:summary`) are stored in the same DO namespace
 * but are filtered out of list results to keep the LLM-facing view clean.
 *
 * Key naming convention:
 *   Use descriptive, collision-safe names: "twitter_api_data", "pricing_table",
 *   "competitor_analysis". Avoid colons in user keys — they are used internally.
 *
 * Exported: writeToBlackboardTool, readFromBlackboardTool
 */

import { Type } from "@sinclair/typebox";
import { BaseTool } from "../base/BaseTool";
import { ToolContext, ToolResult } from "../base/types";
import { getAgentExecutionContext, getRequestEnv } from "../../context";
import { getChatAgent } from "../../agent/ChatAgent";

// ---------------------------------------------------------------------------
// Backend access — the blackboard now lives in the studio-agents worker
// (BlackboardDO), reachable by chat via the AGENTS service binding and by
// sub-agents directly. Scope = conversationId (the ChatAgent DO name), so the
// main agent and all its sub-agents share one blackboard.
// ---------------------------------------------------------------------------

async function blackboardFetch(
  op: "write" | "read",
  scope: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const env = getRequestEnv();
  if (!env?.AGENTS) {
    throw new Error("AGENTS service binding is not configured.");
  }
  return env.AGENTS.fetch(`http://studio-agents/blackboard/${op}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ scope, ...payload }),
  });
}

// ---------------------------------------------------------------------------
// Internal key guard — filters out keys used by the orchestration system
// (e.g. "{agentId}:summary") so they don't pollute LLM-facing list results.
// ---------------------------------------------------------------------------

function isInternalKey(key: string): boolean {
  return key.endsWith(":summary");
}

// ---------------------------------------------------------------------------
// write_to_blackboard
// ---------------------------------------------------------------------------

export class WriteToBlackboardTool extends BaseTool {
  readonly name = "write_to_blackboard";
  readonly executionTarget = "cloud" as const;
  readonly group = "agentic" as const;
  readonly tier = 2 as const;
  readonly allowInSubAgent = true;

  readonly description =
    "Write a value to the shared request blackboard so other agents can read it immediately. " +
    "Use this to publish structured findings mid-task — any other agent (parent or sibling) " +
    "can read the value without waiting for you to finish. " +
    "The blackboard persists for the lifetime of the current request. " +
    "Use descriptive, unique keys like 'twitter_api_rate_limits' or 'pricing_comparison_table'.";

  readonly parameters = Type.Object({
    key: Type.String({
      description:
        "Unique key for this value. Use lowercase with underscores. " +
        "Should describe the content, e.g. 'competitor_pricing', 'api_endpoints_found'. " +
        "Keys are shared across all agents — be specific to avoid collisions.",
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-z0-9_-]+$",
    }),
    value: Type.Unknown({
      description:
        "The value to store. Any JSON-serializable value: string, number, object, or array. " +
        "For best interoperability, prefer objects with clear field names.",
    }),
    description: Type.Optional(
      Type.String({
        description:
          "Optional one-line description of what this value contains. " +
          "Shown alongside the value when other agents read the blackboard. " +
          "Example: 'Raw pricing table scraped from competitor site'.",
        maxLength: 200,
      })
    ),
  });

  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    const { key, value, description } = args as {
      key: string;
      value: unknown;
      description?: string;
    };

    if (!key?.trim()) {
      return this.errorResult("'key' is required.");
    }
    if (isInternalKey(key)) {
      return this.errorResult(
        `Key '${key}' uses a reserved suffix. Avoid keys ending in ':summary'.`
      );
    }
    if (value === undefined) {
      return this.errorResult("'value' is required.");
    }

    const scope = getChatAgent()?.name;
    if (!scope) {
      return this.errorResult("write_to_blackboard requires an active conversation scope.");
    }

    // Wrap the value with optional metadata so readers get context
    const stored = {
      value,
      ...(description !== undefined ? { description } : {}),
      writtenAt: Date.now(),
      writtenBy: getAgentExecutionContext()?.agentId ?? "orchestrator",
    };

    try {
      const res = await blackboardFetch("write", scope, { key, value: stored });
      if (!res.ok) {
        return this.errorResult(`Blackboard write failed: HTTP ${res.status}`);
      }
    } catch (e) {
      return this.errorResult(`Blackboard write failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return this.successResult({
      written: true,
      key,
      message: `Value written to blackboard under key '${key}'. Any running agent can now read it.`,
    });
  }
}

// ---------------------------------------------------------------------------
// read_from_blackboard
// ---------------------------------------------------------------------------

export class ReadFromBlackboardTool extends BaseTool {
  readonly name = "read_from_blackboard";
  readonly executionTarget = "cloud" as const;
  readonly group = "agentic" as const;
  readonly tier = 2 as const;
  readonly allowInSubAgent = true;

  readonly description =
    "Read one or all values from the shared request blackboard. " +
    "Use a specific 'key' to read a known value, or omit it to list everything currently on the blackboard. " +
    "Values are written by any agent via write_to_blackboard and are available immediately after writing. " +
    "Use this to check if a sibling has already found something before doing the same work.";

  readonly parameters = Type.Object({
    key: Type.Optional(
      Type.String({
        description:
          "Specific key to read. If omitted, all blackboard entries are returned. " +
          "Use the exact key that was passed to write_to_blackboard.",
        minLength: 1,
        maxLength: 128,
      })
    ),
  });

  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    const { key } = args as { key?: string };

    const scope = getChatAgent()?.name;
    if (!scope) {
      return this.errorResult("read_from_blackboard requires an active conversation scope.");
    }

    const readRemote = async (k?: string): Promise<Record<string, unknown>> => {
      const res = await blackboardFetch("read", scope, k ? { key: k } : {});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await res.json() as { data?: Record<string, unknown> };
      return parsed.data ?? {};
    };

    // --- Single key read ---
    if (key) {
      if (isInternalKey(key)) {
        return this.errorResult(`Key '${key}' is internal and cannot be read directly.`);
      }
      let data: Record<string, unknown>;
      try { data = await readRemote(key); }
      catch (e) { return this.errorResult(`Blackboard read failed: ${e instanceof Error ? e.message : String(e)}`); }
      const entry = data[key] as Record<string, unknown> | undefined;
      if (entry === undefined || entry === null) {
        return this.successResult({
          found: false,
          key,
          message: `No value found for key '${key}'. It may not have been written yet.`,
        });
      }
      return this.successResult({
        found: true,
        key,
        value: entry.value ?? entry,
        description: entry.description ?? undefined,
        written_by: entry.writtenBy ?? undefined,
        written_at: entry.writtenAt
          ? new Date(entry.writtenAt as number).toISOString()
          : undefined,
      });
    }

    // --- Full list read ---
    let all: Record<string, unknown>;
    try { all = await readRemote(); }
    catch (e) { return this.errorResult(`Blackboard read failed: ${e instanceof Error ? e.message : String(e)}`); }
    const userEntries = Object.entries(all).filter(([k]) => !isInternalKey(k));

    if (userEntries.length === 0) {
      return this.successResult({
        found: false,
        entry_count: 0,
        entries: [],
        message: "The blackboard is empty — no values have been written yet.",
      });
    }

    const entries = userEntries.map(([k, raw]) => {
      const entry = raw as Record<string, unknown> | null;
      return {
        key: k,
        value: entry?.value ?? entry,
        description: entry?.description ?? undefined,
        written_by: entry?.writtenBy ?? undefined,
        written_at: entry?.writtenAt
          ? new Date(entry.writtenAt as number).toISOString()
          : undefined,
      };
    });

    return this.successResult({
      found: true,
      entry_count: entries.length,
      entries,
      message: `${entries.length} value(s) on the blackboard.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

export const writeToBlackboardTool = new WriteToBlackboardTool();
export const readFromBlackboardTool = new ReadFromBlackboardTool();
