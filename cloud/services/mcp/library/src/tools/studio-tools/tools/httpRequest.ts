/**
 * http_request — make an HTTP request to any URL.
 *
 * Ported verbatim (logic-preserving) from the chat worker's HttpRequestTool.
 * Pure cloud tool: no bindings, just fetch. Returns a plain result object the
 * MCP tool handler serializes to JSON.
 */

const STUDIO_USER_AGENT = "ProjectStudio-Agent/1.0";

export interface HttpRequestArgs {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  maxLength?: number;
}

export type HttpRequestResult =
  | {
      ok: boolean;
      status: number;
      contentType: string;
      body: unknown;
      truncated: boolean;
    }
  | { error: string };

export async function runHttpRequest(args: HttpRequestArgs): Promise<HttpRequestResult> {
  const method    = (args.method ?? "GET") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  const urlStr    = String(args.url ?? "");
  const headers   = args.headers ?? {};
  const body      = args.body ? String(args.body) : undefined;
  const maxLength = Number(args.maxLength ?? 4000);

  if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
    return { error: "URL must start with http:// or https://" };
  }

  try {
    const init: RequestInit = {
      method,
      headers: { "User-Agent": STUDIO_USER_AGENT, ...headers },
    };
    if (body && method !== "GET" && method !== "DELETE") {
      init.body = body;
    }

    const response    = await fetch(urlStr, init);
    const contentType = response.headers.get("content-type") ?? "";
    const rawRespBody = await response.text();
    const truncated   = rawRespBody.slice(0, maxLength);

    let parsedBody: unknown = truncated;
    if (contentType.includes("application/json") && truncated) {
      try { parsedBody = JSON.parse(rawRespBody.slice(0, maxLength)); } catch { /* keep string */ }
    }

    return {
      ok:          response.ok,
      status:      response.status,
      contentType,
      body:        parsedBody,
      truncated:   rawRespBody.length > maxLength,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `HTTP request failed: ${message}` };
  }
}
