/**
 * web_fetch — fetch a URL as clean text, auto-indexing large pages into RAG.
 * Ported from the chat worker's WebFetchTool.
 *
 * Difference: auto-indexing is awaited inline (the chat version used
 * ctx.waitUntil for background indexing — there is no ExecutionContext in an
 * McpAgent tool handler, and awaiting also removes the index→query race so a
 * follow-up rag(query) on the returned session_id always finds the content).
 */

import { STUDIO_USER_AGENT } from "../constants";
import {
  AUTO_INDEX_THRESHOLD,
  indexContent,
  sessionIdFromUrl,
  type RagEnv,
} from "./indexing";

function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ");
  text = text
    .replace(/<\/?(p|div|section|article|h[1-6]|li|tr|blockquote|pre)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  return text.replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function rawFetch(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": STUDIO_USER_AGENT },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const ct   = response.headers.get("content-type") ?? "";
  const body = await response.text();
  return ct.includes("text/html") ? htmlToText(body) : body;
}

export interface WebFetchArgs {
  url: string;
  maxLength?: number;
}

export async function runWebFetch(env: RagEnv, args: WebFetchArgs): Promise<unknown> {
  const url       = String(args.url ?? "");
  const maxLength = Number(args.maxLength ?? AUTO_INDEX_THRESHOLD);

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { error: "URL must start with http:// or https://" };
  }

  let content: string;
  try {
    content = await rawFetch(url);
  } catch (e: any) {
    return { error: `Failed to fetch URL: ${e.message}` };
  }

  const truncated   = content.slice(0, maxLength);
  const sessionId   = sessionIdFromUrl(url);
  const autoIndexed = content.length > AUTO_INDEX_THRESHOLD;

  if (autoIndexed && env?.VECTORIZE && env?.AI) {
    await indexContent(env, content, sessionId, url).catch(() => {});
  }

  return {
    url,
    content:      truncated,
    truncated:    truncated.length < content.length,
    session_id:   autoIndexed ? sessionId : undefined,
    auto_indexed: autoIndexed,
  };
}
