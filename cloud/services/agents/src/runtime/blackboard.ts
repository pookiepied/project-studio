/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";
import type { LLMToolDefinition } from "./types";

/**
 * Built-in blackboard tools for the agent loop.
 *
 * Every cloud agent gets these automatically (they are NOT part of the hub tool
 * catalog) so it can coordinate with the main agent and sibling agents. The
 * blackboard is scoped by conversationId — the SAME scope the main chat agent
 * uses — so a finding written by a sub-agent is immediately visible to the main
 * agent and every sibling. This shared board IS the agent-to-agent channel.
 *
 * We call BlackboardDO directly via env.BLACKBOARD (we are inside the agents
 * worker), mirroring routes/blackboard.ts. Stored values are wrapped with the
 * same { value, description?, writtenAt, writtenBy } shape the chat blackboard
 * tools use, so both sides read an identical structure.
 */

export const WRITE_TOOL = "write_to_blackboard";
export const READ_TOOL  = "read_from_blackboard";

export const BLACKBOARD_TOOL_DEFS: LLMToolDefinition[] = [
  {
    type: "function",
    function: {
      name: WRITE_TOOL,
      description:
        "Publish a finding to the shared blackboard so the main agent and sibling agents can read it immediately. " +
        "Use descriptive lowercase keys (e.g. 'pricing_table', 'api_rate_limits'). Write significant confirmed findings as you go.",
      parameters: {
        type: "object",
        properties: {
          key:         { type: "string", description: "Unique lowercase key, e.g. 'competitor_pricing'." },
          value:       { description: "Any JSON-serializable value to store." },
          description: { type: "string", description: "Optional one-line note about what this value is." },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: READ_TOOL,
      description:
        "Read the shared blackboard. Pass a 'key' to read one value, or omit it to list everything. " +
        "Check this before starting work to avoid duplicating what the main agent or a sibling already found.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Specific key to read. Omit to list all entries." },
        },
      },
    },
  },
];

export function isBlackboardTool(name: string): boolean {
  return name === WRITE_TOOL || name === READ_TOOL;
}

// ---------------------------------------------------------------------------
// Direct DO access
// ---------------------------------------------------------------------------

async function boFetch(
  env:   Env,
  scope: string,
  op:    "write" | "read",
  body:  Record<string, unknown>,
): Promise<any> {
  const stub = env.BLACKBOARD.get(env.BLACKBOARD.idFromName(scope));
  const resp = await stub.fetch(
    new Request(`https://blackboard/blackboard/${op}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    }),
  );
  if (!resp.ok) throw new Error(`Blackboard ${op} failed: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Execute a blackboard tool call from the loop.
 * Returns a JSON string suitable for a tool-result message.
 */
export async function executeBlackboardTool(
  env:     Env,
  scope:   string,
  writtenBy: string,
  name:    string,
  args:    any,
): Promise<string> {
  try {
    if (name === WRITE_TOOL) {
      const key = String(args?.key ?? "").trim();
      if (!key) return JSON.stringify({ error: "'key' is required." });
      if (args?.value === undefined) return JSON.stringify({ error: "'value' is required." });
      const stored = {
        value:       args.value,
        ...(args.description !== undefined ? { description: args.description } : {}),
        writtenAt:   Date.now(),
        writtenBy,
      };
      await boFetch(env, scope, "write", { key, value: stored });
      return JSON.stringify({ written: true, key });
    }

    // read
    const key = args?.key ? String(args.key) : undefined;
    const res = await boFetch(env, scope, "read", key ? { key } : {});
    const data = (res?.data ?? {}) as Record<string, any>;

    if (key) {
      const entry = data[key];
      if (entry == null) return JSON.stringify({ found: false, key });
      return JSON.stringify({ found: true, key, value: entry.value ?? entry, description: entry.description, written_by: entry.writtenBy });
    }

    const entries = Object.entries(data).map(([k, raw]) => ({
      key:        k,
      value:      raw?.value ?? raw,
      description: raw?.description,
      written_by: raw?.writtenBy,
    }));
    return JSON.stringify({ found: entries.length > 0, entry_count: entries.length, entries });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
