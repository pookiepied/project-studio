import { promises as fs } from "fs";
import { createHash } from "crypto";

/**
 * index_document — index a local file into the cloud RAG knowledge base.
 *
 * Reads the file, splits it into parts of up to 290K characters, and sends
 * each part to the cloud Worker's /v1/docs/index endpoint. All parts share
 * the same session_id so the agent can query the full document in one call.
 * No content is ever truncated — the whole file is indexed regardless of size.
 *
 * The cloud Worker uses structure-aware chunking: chapter/section headings are
 * detected and stored as metadata on every vector. After indexing the agent can
 * search with chapter/section filters:
 *   rag(action="query", session_id="...", query="...", chapter="7")
 *
 * Configuration (environment variables on the local machine):
 *   STUDIO_AI_WORKER_URL  — base URL of the AI Worker (required)
 *                           e.g. https://ai.yourdomain.workers.dev
 *   STUDIO_AI_TOKEN       — bearer token for Worker auth (optional)
 *
 * Limits:
 *   - Text files only (binary files are rejected)
 *   - Files over 500 MB are rejected (practically covers any document)
 *   - Each part is ≤ 290K chars; large files are split into as many parts as needed
 */

/** Size of each indexing part sent to the cloud. Matches the 300K server-side limit exactly. */
const PART_SIZE      = 300_000;
// For PDFs, use the Studio chat upload which handles binary + text extraction natively.
const MAX_FILE_BYTES = 100 * 1024 * 1024;  // 100 MB — consistent with pdf.ts upload limit
const PART_TIMEOUT   = 120_000;             // 2 min per part — large embedding batches need time
const BINARY_SAMPLE  = 8_192;

function sessionIdFromPath(filePath: string): string {
  return "file-" + createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

function looksLikeBinary(content: string): boolean {
  return content.slice(0, BINARY_SAMPLE).includes("\0");
}

export async function indexDocument(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const filePath  = args.path as string;
  const sessionId = args.session_id as string | undefined;

  if (!filePath) return { error: "path is required" };

  // ── Worker URL ─────────────────────────────────────────────────────────────
  const workerUrl = (process.env.STUDIO_AI_WORKER_URL ?? "").replace(/\/$/, "");
  if (!workerUrl) {
    return {
      error:
        "STUDIO_AI_WORKER_URL is not set. " +
        "Set it to your AI Worker base URL (e.g. https://ai.yourdomain.workers.dev) " +
        "so index_document can reach the cloud indexing endpoint.",
    };
  }

  // ── File stat ──────────────────────────────────────────────────────────────
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { error: `File not found: ${filePath}. Verify the path with ls or glob.` };
  }

  if (stat.isDirectory()) {
    return {
      error:
        `${filePath} is a directory. Provide a path to a specific file. ` +
        `Use glob to list candidate files (e.g. **/*.md, **/*.txt, **/*.pdf).`,
    };
  }

  if (stat.size > MAX_FILE_BYTES) {
    return {
      error:
        `File is too large to index (${(stat.size / 1024 / 1024).toFixed(0)} MB, limit 100 MB). ` +
        `For PDF books, use the Studio chat upload which handles text extraction automatically. ` +
        `For plain-text files, use read_file with offset+limit to extract the relevant section and index that instead.`,
      size_bytes: stat.size,
    };
  }

  // ── Read ───────────────────────────────────────────────────────────────────
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (e: any) {
    return { error: `Cannot read file: ${e.message}` };
  }

  if (looksLikeBinary(content)) {
    return {
      error:
        `${filePath} appears to be a binary file. index_document only supports plain text ` +
        `(.md, .txt, .rst, .html, .json, .csv, .log, etc.). ` +
        `For PDFs, use the Studio chat upload flow — it extracts text before indexing.`,
    };
  }

  // ── Split into parts ───────────────────────────────────────────────────────
  const effectiveSession = sessionId ?? sessionIdFromPath(filePath);
  const fileName         = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  const totalParts       = Math.ceil(content.length / PART_SIZE);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.STUDIO_AI_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let totalChunks         = 0;
  let chaptersDetected    = 0;

  // ── Index each part ────────────────────────────────────────────────────────
  for (let part = 0; part < totalParts; part++) {
    const partText  = content.slice(part * PART_SIZE, (part + 1) * PART_SIZE);
    const partLabel = totalParts > 1 ? `${fileName} (part ${part + 1}/${totalParts})` : fileName;

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), PART_TIMEOUT);

    let resp: Response;
    try {
      resp = await fetch(`${workerUrl}/v1/docs/index`, {
        method:  "POST",
        headers,
        body:    JSON.stringify({ text: partText, fileName: partLabel, sessionId: effectiveSession }),
        signal:  controller.signal,
      });
    } catch (e: any) {
      clearTimeout(timer);
      const reason = e.name === "AbortError"
        ? `timed out after ${PART_TIMEOUT / 1000}s`
        : e.message;
      return {
        error: `Part ${part + 1}/${totalParts}: could not reach AI Worker at ${workerUrl}: ${reason}.`,
        parts_completed: part,
        total_parts: totalParts,
      };
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "(empty)");
      return {
        error: `Part ${part + 1}/${totalParts}: AI Worker returned HTTP ${resp.status}: ${body}`,
        parts_completed: part,
        total_parts: totalParts,
      };
    }

    const data = (await resp.json()) as any;
    totalChunks      += data.chunkCount ?? 0;
    chaptersDetected += data.chaptersDetected ?? 0;
  }

  const message =
    `"${fileName}" fully indexed — ${totalChunks} chunks across ${totalParts} part(s), ` +
    `session_id "${effectiveSession}". ` +
    (chaptersDetected > 0
      ? `${chaptersDetected} chapter(s) detected — you can filter queries with chapter="N". `
      : "") +
    `Use rag(action="query", session_id="${effectiveSession}", query="...") to search it.`;

  return {
    session_id:        effectiveSession,
    file_name:         fileName,
    total_chars:       content.length,
    parts:             totalParts,
    chunks:            totalChunks,
    chapters_detected: chaptersDetected,
    message,
  };
}
