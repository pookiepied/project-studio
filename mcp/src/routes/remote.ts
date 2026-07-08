/// <reference types="@cloudflare/workers-types" />

/**
 * Remote MCP execution proxy.
 *
 * Executes a single tools/call against a remote (HTTP) MCP server via the
 * Streamable HTTP transport (JSON-RPC 2.0). Falls back to the legacy GET-SSE
 * transport when the server returns 404/405, keeping full parity with chat's
 * RemoteMCPTool so both main-agent and sub-agent paths have identical reach.
 *
 * Centralizing here means every worker (chat, agents) routes remote MCP
 * execution through one place — the hub is the single execution router.
 * It proxies the call, never owns a tool.
 */

// ---------------------------------------------------------------------------
// Timeouts (match chat/src/tools/tool-contract.ts values)
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT_MS   = 20_000;
const SSE_TIMEOUT_MS       = 15_000;
const SSE_CHUNK_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function decodeChunk(dec: TextDecoder, value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return dec.decode(value, { stream: true });
  try { return dec.decode(new Uint8Array(value as ArrayBuffer), { stream: true }); } catch { return ""; }
}

/** Extract text content from an MCP tool result. */
function extractContent(result: unknown): unknown {
  if (!result) return null;
  const r = result as any;
  if (Array.isArray(r.content)) {
    return r.content
      .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
      .filter(Boolean)
      .join("\n");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Streamable HTTP — primary transport
// ---------------------------------------------------------------------------

/** Read an SSE response body and return the first JSON-RPC result. */
async function parseSSEResult(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from remote MCP server");

  const dec = new TextDecoder();
  let buffer = "";

  const readWithTimeout = (): Promise<ReadableStreamReadResult<unknown>> =>
    Promise.race([
      reader.read() as Promise<ReadableStreamReadResult<unknown>>,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Remote MCP SSE stream stalled after ${SSE_CHUNK_TIMEOUT_MS / 1000}s`)),
          SSE_CHUNK_TIMEOUT_MS,
        )
      ),
    ]);

  try {
    while (true) {
      const { done, value } = await readWithTimeout();
      if (done) break;
      buffer += decodeChunk(dec, value);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const msg: any = JSON.parse(data);
          if (msg.result !== undefined) return extractContent(msg.result);
          if (msg.error) throw new Error(msg.error.message ?? JSON.stringify(msg.error));
        } catch (e: any) {
          if (e?.message && !(e instanceof SyntaxError)) throw e;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error("Remote MCP server did not return a result");
}

// ---------------------------------------------------------------------------
// Legacy GET-SSE transport — fallback for pre-2024 MCP servers
//
// Protocol:
//   1. GET /mcp  (Accept: text/event-stream)
//      ↳ server emits "event: endpoint\ndata: /mcp/session?id=xyz"
//   2. POST to that session URL:  initialize, notifications/initialized, tools/call
//      ↳ results arrive on the open SSE stream
// ---------------------------------------------------------------------------

async function callViaSSETransport(
  sseUrl:   string,
  headers:  Record<string, string>,
  callBody: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), SSE_TIMEOUT_MS);

  try {
    const sseRes = await fetch(sseUrl, {
      method:  "GET",
      headers: { ...headers, Accept: "text/event-stream" },
      signal:  controller.signal,
    });

    if (!sseRes.ok || !sseRes.body) {
      throw new Error(`SSE transport: could not connect (HTTP ${sseRes.status})`);
    }

    const reader = sseRes.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = "";
    let   lastEvt = "";
    let   postUrl: string | null = null;

    // Reads the next parsed SSE data line.
    const readNextMsg = async (): Promise<any | null> => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return null;
        buf += decodeChunk(dec, value);
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            lastEvt = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const raw = line.slice(5).trim();
            const evt = lastEvt;
            lastEvt   = "";
            if (evt === "endpoint") {
              const base = new URL(sseUrl);
              postUrl = raw.startsWith("http") ? raw : `${base.origin}${raw}`;
            } else if (raw && raw !== "[DONE]") {
              try { return JSON.parse(raw); } catch { /* skip non-JSON */ }
            }
          }
        }
      }
    };

    // Phase 1: wait for the endpoint event, then send initialize.
    const waitAndInit = async (): Promise<void> => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buf += decodeChunk(dec, value);
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            lastEvt = line.slice(6).trim();
          } else if (line.startsWith("data:") && lastEvt === "endpoint") {
            const raw  = line.slice(5).trim();
            const base = new URL(sseUrl);
            postUrl    = raw.startsWith("http") ? raw : `${base.origin}${raw}`;
            lastEvt    = "";
            const initBody  = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "STUDIO", version: "0.1.0" } } });
            await fetch(postUrl, { method: "POST", headers, body: initBody });
            await readNextMsg(); // consume initialize response
            return;
          } else if (line.startsWith("data:")) {
            lastEvt = "";
          }
        }
      }
    };

    await waitAndInit();
    if (!postUrl) throw new Error("SSE transport: server did not send an endpoint event");

    const notifBody = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
    await fetch(postUrl, { method: "POST", headers, body: notifBody });
    await fetch(postUrl, { method: "POST", headers, body: callBody });

    const resultMsg = await readNextMsg();
    reader.cancel().catch(() => {});

    if (!resultMsg) throw new Error("SSE transport: no tool result received");
    if (resultMsg.error) throw new Error(`Remote MCP error: ${resultMsg.error.message ?? JSON.stringify(resultMsg.error)}`);
    return extractContent(resultMsg.result);

  } catch (e: any) {
    if (e.name === "AbortError") throw new Error(`SSE transport: timed out after ${SSE_TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// POST /internal/remote/execute
// Body: { url, authToken?, toolName, args? }
// ---------------------------------------------------------------------------

export async function handleRemoteExecute(request: Request): Promise<Response> {
  let body: { url?: string; authToken?: string; toolName?: string; args?: unknown };
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const { url, authToken, toolName, args } = body;
  if (!url || !toolName) {
    return json({ success: false, error: "url and toolName are required" }, 400);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept:         "application/json, text/event-stream",
  };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const callBody = JSON.stringify({
    jsonrpc: "2.0",
    id:      1,
    method:  "tools/call",
    params:  { name: toolName, arguments: args ?? {} },
  });

  const baseUrl = url.replace(/\/$/, "");

  try {
    const resp = await fetch(baseUrl, {
      method:  "POST",
      headers,
      body:    callBody,
      signal:  AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });

    if (resp.ok) {
      const ct = resp.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const j: any = await resp.json();
        if (j.error) return json({ success: false, error: j.error.message ?? JSON.stringify(j.error) });
        return json({ success: true, data: extractContent(j.result) });
      }
      if (ct.includes("text/event-stream")) {
        const data = await parseSSEResult(resp);
        return json({ success: true, data });
      }
      return json({ success: true, data: await resp.text() });
    }

    // Legacy GET-SSE transport fallback (404/405 = server only accepts GET for SSE stream).
    if (resp.status === 404 || resp.status === 405) {
      const data = await callViaSSETransport(baseUrl, headers, callBody);
      return json({ success: true, data });
    }

    return json({ success: false, error: `Remote MCP server returned HTTP ${resp.status}` }, 502);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: msg }, 502);
  }
}
