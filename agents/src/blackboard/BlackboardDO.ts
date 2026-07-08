/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";

/**
 * BlackboardDO — per-conversation shared key/value store for agent-to-agent
 * coordination.
 *
 * One instance per conversation scope (addressed by idFromName(conversationId)).
 * Both the main agent (chat worker, via the AGENTS service binding) and
 * sub-agents (agents worker, directly) read/write the same blackboard, so
 * findings published by one agent are immediately visible to siblings.
 *
 * This replaces the old per-ChatAgent SQLite blackboard, which lived inside the
 * chat worker's ChatAgent DO and was therefore unreachable from the agents
 * worker. Keeping it here respects the chat → agents call direction (chat may
 * call agents; agents never calls back into chat).
 *
 * Routes (all POST, JSON body — dispatched by the worker after resolving scope):
 *   /blackboard/write  { key, value }  → { ok: true }
 *   /blackboard/read   { key? }        → { data: Record<string, unknown> }
 *
 * Stored values are opaque JSON — the calling tool wraps them with metadata
 * (writtenBy, writtenAt, description) before storing.
 */
export class BlackboardDO {
  private readonly sql: SqlStorage;

  constructor(state: DurableObjectState, _env: Env) {
    this.sql = state.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS blackboard (
         key        TEXT    PRIMARY KEY,
         value      TEXT    NOT NULL,
         updated_at INTEGER NOT NULL
       )`
    );
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    let body: { key?: string; value?: unknown };
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON body" }, 400); }

    if (pathname.endsWith("/write")) {
      const { key, value } = body;
      if (!key) return json({ error: "key is required" }, 400);
      if (value === undefined) return json({ error: "value is required" }, 400);
      this.sql.exec(
        `INSERT OR REPLACE INTO blackboard (key, value, updated_at) VALUES (?, ?, ?)`,
        key, JSON.stringify(value), Date.now(),
      );
      return json({ ok: true });
    }

    if (pathname.endsWith("/read")) {
      const { key } = body;
      const data: Record<string, unknown> = {};

      if (key) {
        const rows = this.sql.exec<{ value: string }>(
          `SELECT value FROM blackboard WHERE key = ?`, key,
        ).toArray();
        const first = rows[0];
        if (first) {
          try { data[key] = JSON.parse(first.value); } catch { /* skip unparseable */ }
        }
        return json({ data });
      }

      const rows = this.sql.exec<{ key: string; value: string }>(
        `SELECT key, value FROM blackboard`,
      ).toArray();
      for (const row of rows) {
        try { data[row.key] = JSON.parse(row.value); } catch { /* skip */ }
      }
      return json({ data });
    }

    return json({ error: "Not Found" }, 404);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
