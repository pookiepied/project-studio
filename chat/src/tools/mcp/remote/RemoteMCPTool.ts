import { BaseTool } from "../../base/BaseTool";
import { ToolResult } from "../../base/types";
import { logger } from "../../../logger";
import { emit } from '../../../tracking';
import { getRequestEnv } from '../../../context';
import {
  REMOTE_MCP_CONNECT_TIMEOUT_MS,
  REMOTE_MCP_SSE_TIMEOUT_MS,
  REMOTE_MCP_SSE_CHUNK_TIMEOUT_MS,
} from "../../tool-contract";

/**
 * Cloudflare Workers can yield string chunks from ReadableStream readers.
 * TextDecoder.decode(string) throws — this helper normalises the value.
 */
function decodeStreamChunk(dec: TextDecoder, value: Uint8Array | string | unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return dec.decode(value, { stream: true });
  if (value instanceof ArrayBuffer || Array.isArray(value)) return dec.decode(new Uint8Array(value as any), { stream: true });
  try { return dec.decode(new Uint8Array(value as any), { stream: true }); } catch { return ""; }
}

/**
 * Represents a single tool exposed by a remote (HTTP) MCP server.
 *
 * Unlike DynamicMCPTool (which defers to Tauri), RemoteMCPTool executes
 * directly inside the AI Worker by calling the remote endpoint via JSON-RPC
 * over HTTP — compatible with the MCP Streamable HTTP transport spec.
 *
 * Auth is passed via a Bearer token stored in the server config
 * (config.authToken), or none if the endpoint is public.
 *
 * Tool name convention: mcp_{serverName}__{toolName}
 */
export class RemoteMCPTool extends BaseTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: any;
  readonly executionTarget = "remote_mcp" as const;
  readonly group = "mcp" as const;
  readonly allowInSubAgent = true; // remote MCP executes in Worker, safe for sub-agents

  private readonly serverName: string;
  private readonly toolName: string;
  private readonly endpointUrl: string;
  private readonly authToken: string | undefined;

  constructor(
    serverName: string,
    toolName: string,
    description: string,
    parameters: any,
    endpointUrl: string,
    authToken?: string
  ) {
    super();
    const safeServer = serverName.replace(/-/g, "_");
    this.name = `mcp_${safeServer}__${toolName}`;
    this.serverName = serverName;
    this.toolName = toolName;
    this.description = description;
    this.parameters = parameters;
    this.endpointUrl = endpointUrl;
    this.authToken = authToken;
  }

  async execute(args: any, _context?: unknown): Promise<ToolResult> {
    try {
      const result = await this.callRemote(args);
      return { success: true, result };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`RemoteMCPTool: Failed to call ${this.name}`, { error: message });
      const _env = getRequestEnv();
      if (_env) emit(_env, undefined, {
        event: 'provider.error', severity: 'error',
        data: { provider: 'mcp', server: this.serverName, tool: this.toolName, error: message },
      });
      return this.errorResult(message);
    }
  }

  private async callRemote(args: any): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const callBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: this.toolName, arguments: args ?? {} },
    });

    const baseUrl = this.endpointUrl.replace(/\/$/, "");

    // Probe with Streamable HTTP first — connect timeout from tool-contract
    const probeController = new AbortController();
    const probeTimeout = setTimeout(() => probeController.abort(), REMOTE_MCP_CONNECT_TIMEOUT_MS);
    let probe: Response;
    try {
      probe = await fetch(baseUrl, { method: "POST", headers, body: callBody, signal: probeController.signal });
    } catch (e: any) {
      clearTimeout(probeTimeout);
      if (e.name === "AbortError") {
        throw new Error(`Remote MCP '${this.serverName}' did not respond within ${REMOTE_MCP_CONNECT_TIMEOUT_MS / 1000}s`);
      }
      throw e;
    }
    clearTimeout(probeTimeout);

    if (probe.ok) {
      const ct = probe.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const json: any = await probe.json();
        if (json.error) throw new Error(`Remote MCP error: ${json.error.message ?? JSON.stringify(json.error)}`);
        return this.extractContent(json.result);
      }
      if (ct.includes("text/event-stream")) {
        return await this.parseSSEResult(probe);
      }
      return await probe.text();
    }

    // Legacy SSE transport — the endpoint only accepts GET for the stream;
    // tool calls are POSTed to a session URL found in the `endpoint` event.
    if (probe.status === 404 || probe.status === 405) {
      return await this.callViaSSETransport(baseUrl, headers, callBody);
    }

    throw new Error(`Remote MCP server '${this.serverName}' returned HTTP ${probe.status}`);
  }

  private async callViaSSETransport(sseUrl: string, headers: Record<string, string>, callBody: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_MCP_SSE_TIMEOUT_MS);

    try {
      const sseRes = await fetch(sseUrl, {
        method: "GET",
        headers: { ...headers, Accept: "text/event-stream" },
        signal: controller.signal,
      });

      if (!sseRes.ok || !sseRes.body) {
        throw new Error(`SSE transport: could not connect (HTTP ${sseRes.status})`);
      }

      const reader = sseRes.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let lastEventType = "";
      let postUrl: string | null = null;

      const readNextMsg = async (): Promise<any | null> => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return null;
          buf += decodeStreamChunk(dec, value);
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              lastEventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const raw = line.slice(5).trim();
              const evType = lastEventType;
              lastEventType = "";
              if (evType === "endpoint") {
                const base = new URL(sseUrl);
                postUrl = raw.startsWith("http") ? raw : `${base.origin}${raw}`;
              } else if (raw && raw !== "[DONE]") {
                try { return JSON.parse(raw); } catch { /* skip */ }
              }
            }
          }
        }
      };

      // Wait for endpoint event, then send initialize
      const initBody = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "STUDIO", version: "0.1.0" } } });
      const notifBody = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });

      const waitAndInit = async (): Promise<any | null> => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return null;
          buf += decodeStreamChunk(dec, value);
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              lastEventType = line.slice(6).trim();
            } else if (line.startsWith("data:") && lastEventType === "endpoint") {
              const raw = line.slice(5).trim();
              const base = new URL(sseUrl);
              postUrl = raw.startsWith("http") ? raw : `${base.origin}${raw}`;
              lastEventType = "";
              await fetch(postUrl, { method: "POST", headers, body: initBody });
              return await readNextMsg();
            } else if (line.startsWith("data:")) {
              lastEventType = "";
            }
          }
        }
      };

      await waitAndInit();

      if (!postUrl) throw new Error("SSE transport: server did not send an endpoint event.");

      await fetch(postUrl, { method: "POST", headers, body: notifBody });
      await fetch(postUrl, { method: "POST", headers, body: callBody });

      const resultMsg = await readNextMsg();
      reader.cancel().catch(() => {});

      if (!resultMsg) throw new Error(`SSE transport: no tool result received from '${this.serverName}'`);
      if (resultMsg.error) throw new Error(`Remote MCP error: ${resultMsg.error.message ?? JSON.stringify(resultMsg.error)}`);
      return this.extractContent(resultMsg.result);

    } catch (e: any) {
      if (e.name === "AbortError") throw new Error(`SSE transport: timed out calling '${this.serverName}' after ${REMOTE_MCP_SSE_TIMEOUT_MS / 1000}s`);
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Extract text content from an MCP tool result object. */
  private extractContent(result: any): unknown {
    if (!result) return null;
    if (Array.isArray(result.content)) {
      const parts: string[] = result.content
        .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
        .filter(Boolean);
      return parts.join("\n");
    }
    return result;
  }

  /** Read an SSE stream and return the first tool result. 30-second read timeout per chunk. */
  private async parseSSEResult(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body from remote MCP server");

    const decoder = new TextDecoder();
    let buffer = "";
    const serverName = this.serverName;

    const readWithTimeout = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
      Promise.race([
        reader.read() as Promise<ReadableStreamReadResult<Uint8Array>>,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Remote MCP '${serverName}' SSE stream stalled — no data for ${REMOTE_MCP_SSE_CHUNK_TIMEOUT_MS / 1000}s`)),
            REMOTE_MCP_SSE_CHUNK_TIMEOUT_MS
          )
        ),
      ]);

    try {
      while (true) {
        const { done, value } = await readWithTimeout();
        if (done) break;

        buffer += decodeStreamChunk(decoder, value);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const msg: any = JSON.parse(data);
            if (msg.result !== undefined) {
              return this.extractContent(msg.result);
            }
            if (msg.error) {
              throw new Error(`Remote MCP error: ${msg.error.message ?? JSON.stringify(msg.error)}`);
            }
          } catch (parseErr: any) {
            if (parseErr.message?.startsWith("Remote MCP")) throw parseErr;
            // Non-JSON SSE data line — skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    throw new Error(`Remote MCP server '${this.serverName}' did not return a result`);
  }
}
