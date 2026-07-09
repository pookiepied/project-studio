import { apiManager } from "@/core/network/apiManager";
import { createHeaders } from "@/utils/api";
import { logger } from "@/core/logging/logger";

/** Characters of extracted text above which we RAG-index instead of inlining. */
export const DOC_RAG_THRESHOLD = 100_000; // ~25K tokens

/** Characters we actually send to the index endpoint (hard cap). */
export const DOC_MAX_INDEX_CHARS = 300_000; // ~75K tokens, ~100 dense pages

export interface DocIndexResult {
  docId: string;
  sessionId: string;
  fileName: string;
  chunkCount: number;
  truncated: boolean;
  originalLength: number;
  indexedLength: number;
}

/**
 * Send extracted document text to the AI worker for RAG indexing.
 *
 * @param text        Full extracted text (will be truncated server-side if > DOC_MAX_INDEX_CHARS)
 * @param fileName    Original file name — stored as the `source` label in Vectorize metadata
 * @param sessionId   Conversation ID — used as the Vectorize filter key so the RAG tool
 *                    only retrieves chunks belonging to this conversation
 */
export async function indexDocumentForRAG(
  text: string,
  fileName: string,
  sessionId: string,
): Promise<DocIndexResult> {
  const endpoints = await apiManager.getEndpoints();
  // Derive the base from the models endpoint (strips /models)
  const base = endpoints.models.replace(/\/models$/, "");

  const headers = await createHeaders(true) as Record<string, string>;

  const response = await fetch(`${base}/docs/index`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text, fileName, sessionId }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`Document indexing failed (${response.status}): ${err}`);
  }

  const result = await response.json() as DocIndexResult;
  logger.info("docIndexService", `Indexed "${fileName}"`, {
    chunks: result.chunkCount,
    truncated: result.truncated,
    sessionId,
  });
  return result;
}

/**
 * Build the RAG annotation text injected into the user message when one or
 * more documents have been indexed.  The LLM sees this and knows to use the
 * rag tool with the given session_id before answering document questions.
 */
export function buildRAGAnnotation(
  docs: Array<{ fileName: string; chunkCount: number; sessionId: string; truncated: boolean }>,
): string {
  const lines = docs.map((d) => {
    const truncNote = d.truncated ? " (first ~100 pages indexed — document was larger)" : "";
    return `• "${d.fileName}" — ${d.chunkCount} chunks indexed${truncNote}. Query with: rag(action="query", session_id="${d.sessionId}", query="…")`;
  });

  return (
    `[RAG Context — the following document${docs.length > 1 ? "s have" : " has"} been indexed and ` +
    `can be searched with the rag tool:\n${lines.join("\n")}\n` +
    `Always use the rag tool to answer questions about these documents rather than guessing.]`
  );
}
