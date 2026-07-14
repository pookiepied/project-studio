/**
 * rag — index/query/toc over session-scoped content in Vectorize.
 * Ported from the chat worker's RagTool. env is passed explicitly.
 */

import { VECTORIZE_EMBEDDING_MODEL } from "../constants";
import { indexContent, type RagEnv } from "./indexing";

export interface RagArgs {
  action: "index" | "query" | "toc";
  session_id: string;
  content?: string;
  source?:  string;
  query?:   string;
  top_k?:   number;
  chapter?: string;
  section?: string;
}

export async function runRag(env: RagEnv, args: RagArgs): Promise<unknown> {
  if (!env?.RAG_VECTORIZE || !env?.AI) {
    return { error: "RAG requires VECTORIZE and AI bindings — not configured." };
  }

  const { action = "", session_id: sessionId = "", content, source, query, top_k, chapter, section } = args;

  if (action === "index") {
    const text = String(content ?? "");
    const src  = String(source ?? sessionId);
    if (!text) return { error: "content is required for action=index" };
    try {
      return await indexContent(env, text, sessionId, src);
    } catch (e: any) {
      return { error: `Indexing failed: ${e.message}` };
    }
  }

  if (action === "query") {
    const queryText = String(query ?? "");
    if (!queryText) return { error: "query is required for action=query" };
    const topK = Math.min(Number(top_k ?? 5), 20);

    const embed: any = await env.AI!.run(VECTORIZE_EMBEDDING_MODEL, { text: [queryText] });
    const vector = embed?.data?.[0];
    if (!vector) return { error: "Failed to generate query embedding" };

    const results = await env.RAG_VECTORIZE!.query(vector, {
      topK,
      filter: { session_id: sessionId },
      returnMetadata: "all",
    });

    const chapterFilter = chapter ? String(chapter) : null;
    const sectionFilter = section ? String(section) : null;

    const matches = (results.matches ?? [])
      .filter((m: any) => {
        if (chapterFilter && m.metadata?.chapter !== chapterFilter) return false;
        if (sectionFilter && m.metadata?.section !== sectionFilter) return false;
        return true;
      })
      .map((m: any) => ({
        score:   m.score,
        source:  m.metadata?.source,
        text:    m.metadata?.text ?? "",
        chapter: m.metadata?.chapter,
        section: m.metadata?.section,
      }));

    return { query: queryText, session_id: sessionId, matches };
  }

  if (action === "toc") {
    if (env.MCP_KV) {
      try {
        const cached = await env.MCP_KV.get(`rag:toc:${sessionId}`, "json") as any;
        if (cached) return { session_id: sessionId, toc: cached.chapters ?? [] };
      } catch {
        // fall through to Vectorize scan
      }
    }

    const results = await env.RAG_VECTORIZE!.query(new Array(768).fill(0) as number[], {
      topK: 100,
      filter: { session_id: sessionId },
      returnMetadata: "all",
    });

    const seen = new Set<string>();
    const toc: { chapter?: string; section?: string }[] = [];
    for (const m of results.matches ?? []) {
      const key = `${m.metadata?.chapter ?? ""}::${m.metadata?.section ?? ""}`;
      if (!seen.has(key) && (m.metadata?.chapter || m.metadata?.section)) {
        seen.add(key);
        toc.push({
          chapter: typeof m.metadata?.chapter === "string" ? m.metadata.chapter : undefined,
          section: typeof m.metadata?.section === "string" ? m.metadata.section : undefined,
        });
      }
    }

    return { session_id: sessionId, toc };
  }

  return { error: `Unknown action: ${action}. Must be "index", "query", or "toc".` };
}
