import { getRequestEnv } from "../../context";
import { VECTORIZE_EMBEDDING_MODEL } from "../../constants";

export const CHUNK_SIZE = 1200;
export const AUTO_INDEX_THRESHOLD = 16000;

// Batch sizes matching /v1/docs/index endpoint
const EMBED_BATCH   = 50;
const VECTORIZE_BATCH = 500;

// ── Plain text chunker (unchanged — used internally and by legacy callers) ──

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  let current = "";

  for (const para of paragraphs) {
    const joined = current ? current + "\n\n" + para : para;
    if (joined.length <= CHUNK_SIZE) {
      current = joined;
    } else {
      if (current) chunks.push(current);
      if (para.length > CHUNK_SIZE) {
        const sentences = para.split(/(?<=[.!?])\s+/);
        let sentChunk = "";
        for (const s of sentences) {
          const next = sentChunk ? sentChunk + " " + s : s;
          if (next.length <= CHUNK_SIZE) {
            sentChunk = next;
          } else {
            if (sentChunk) chunks.push(sentChunk);
            sentChunk = s;
          }
        }
        current = sentChunk;
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);

  if (chunks.length === 0) {
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      chunks.push(text.slice(i, i + CHUNK_SIZE));
    }
  }

  return chunks;
}

// ── Structure detection ───────────────────────────────────────────────────────
// Parses common heading patterns found in academic books, technical docs, and
// Markdown files. Chunks are tagged with chapter/section so the rag tool can
// filter to "chapter 7 only" instead of searching the whole document.

export interface StructuredChunk {
  text:          string;
  chapter:       string;  // Normalized id, e.g. "7", "A", "Introduction"
  chapter_label: string;  // Full heading, e.g. "Chapter 7: Differential Equations"
  section:       string;  // Section number or label, e.g. "7.1", "7.2.3"
}

// Small Roman numeral map for academic chapter numbering
const ROMAN: Record<string, number> = {
  i:1, ii:2, iii:3, iv:4, v:5, vi:6, vii:7, viii:8, ix:9, x:10,
  xi:11, xii:12, xiii:13, xiv:14, xv:15, xvi:16, xvii:17, xviii:18, xix:19, xx:20,
};

function normalizeChapterId(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (ROMAN[lower] !== undefined) return String(ROMAN[lower]);
  if (/^\d+$/.test(raw.trim())) return raw.trim();
  return raw.trim().slice(0, 40);
}

interface StructureMarker {
  kind:  "chapter" | "section";
  id:    string;
  label: string;
}

function detectMarker(line: string): StructureMarker | null {
  const t = line.trim();
  if (!t || t.length > 150) return null;

  // "Chapter 7", "Chapter VII", "Part 3", "Appendix A", "CHAPTER 7: ..."
  const chapterRe = t.match(/^(?:chapter|ch\.?|part|appendix)\s+([A-Za-z0-9]+)(?:\s|[:\-.]|$)/i);
  if (chapterRe) {
    return { kind: "chapter", id: normalizeChapterId(chapterRe[1]), label: t.slice(0, 80) };
  }

  // Markdown h1  →  chapter boundary
  const h1 = t.match(/^#\s+(.+)/);
  if (h1) {
    const inner = h1[1].trim();
    const nested = inner.match(/^(?:chapter|ch\.?|part)\s+([A-Za-z0-9]+)/i);
    return { kind: "chapter", id: nested ? normalizeChapterId(nested[1]) : inner.slice(0, 40), label: inner.slice(0, 80) };
  }

  // "7.1 Title" or "A.1 Title"  →  section
  const sectionRe = t.match(/^([A-Z]?\d+\.\d+(?:\.\d+)*)\s+\S/);
  if (sectionRe) {
    return { kind: "section", id: sectionRe[1], label: t.slice(0, 80) };
  }

  // Markdown h2 / h3  →  section
  const h2 = t.match(/^#{2,3}\s+(.+)/);
  if (h2) {
    return { kind: "section", id: h2[1].trim().slice(0, 40), label: h2[1].trim().slice(0, 80) };
  }

  return null;
}

/**
 * Structure-aware chunker.
 *
 * Scans the text for chapter / section headings, groups paragraphs by which
 * chapter/section they belong to, then applies the standard paragraph-aware
 * chunker within each group. Every returned chunk carries chapter/section
 * metadata so Vectorize can filter on it.
 *
 * Falls back to plain chunkText() with empty metadata if no structure is found.
 */
export function chunkTextWithStructure(text: string): StructuredChunk[] {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  // Pass 1 — annotate each paragraph with its current chapter/section context
  let curChapter      = "";
  let curChapterLabel = "";
  let curSection      = "";

  type Annotated = { text: string; chapter: string; chapterLabel: string; section: string };
  const annotated: Annotated[] = paragraphs.map((para) => {
    const marker = detectMarker(para.split("\n")[0]);
    if (marker?.kind === "chapter") {
      curChapter      = marker.id;
      curChapterLabel = marker.label;
      curSection      = "";
    } else if (marker?.kind === "section") {
      curSection = marker.id;
    }
    return { text: para, chapter: curChapter, chapterLabel: curChapterLabel, section: curSection };
  });

  // Pass 2 — buffer paragraphs of the same chapter/section together then chunk
  const result: StructuredChunk[] = [];
  let buf          = "";
  let bufChapter   = "";
  let bufChLabel   = "";
  let bufSection   = "";

  const flush = () => {
    if (!buf) return;
    for (const c of chunkText(buf)) {
      result.push({ text: c, chapter: bufChapter, chapter_label: bufChLabel, section: bufSection });
    }
    buf = "";
  };

  for (const item of annotated) {
    const structureChanged = buf !== "" && (item.chapter !== bufChapter || item.section !== bufSection);
    const oversized        = (buf.length + item.text.length) > CHUNK_SIZE * 4;

    if (structureChanged || oversized) flush();

    if (!buf) { bufChapter = item.chapter; bufChLabel = item.chapterLabel; bufSection = item.section; }
    buf = buf ? buf + "\n\n" + item.text : item.text;
  }
  flush();

  return result.length > 0
    ? result
    : chunkText(text).map((t) => ({ text: t, chapter: "", chapter_label: "", section: "" }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function sessionIdFromUrl(url: string): string {
  return `url:${url.replace(/[^a-z0-9]/gi, "_").slice(0, 80)}`;
}

// ── TOC types ─────────────────────────────────────────────────────────────────

export interface TocEntry {
  id:            string;   // Normalized chapter identifier, e.g. "7"
  label:         string;   // Full heading text, e.g. "Chapter 7: Integration Techniques"
  section_count: number;   // How many distinct sections were found in this chapter
}

export interface StoredToc {
  session_id:  string;
  source:      string;
  chapters:    TocEntry[];
  indexed_at:  number;
}

export interface IndexResult {
  indexed:           true;
  session_id:        string;
  source:            string;
  chunks:            number;
  chapters_detected: number;
  chapters:          TocEntry[];   // Table of contents extracted from document structure
}

/** Derive a StoredToc from a set of structured chunks. */
function buildToc(structured: StructuredChunk[], sessionId: string, source: string): StoredToc {
  // Build a map of chapter id → { label, sections }
  const chapterMap = new Map<string, { label: string; sections: Set<string> }>();
  for (const c of structured) {
    if (!c.chapter) continue;
    if (!chapterMap.has(c.chapter)) {
      chapterMap.set(c.chapter, { label: c.chapter_label || c.chapter, sections: new Set() });
    }
    if (c.section) chapterMap.get(c.chapter)!.sections.add(c.section);
  }
  const chapters: TocEntry[] = [...chapterMap.entries()].map(([id, v]) => ({
    id,
    label:         v.label,
    section_count: v.sections.size,
  }));
  return { session_id: sessionId, source, chapters, indexed_at: Date.now() };
}

/** Persist the TOC to KV so rag(action="toc") can retrieve it instantly. */
async function saveToc(toc: StoredToc, env: { MCP_KV?: KVNamespace }): Promise<void> {
  if (!env.MCP_KV || toc.chapters.length === 0) return;
  try {
    await env.MCP_KV.put(
      `rag:toc:${toc.session_id}`,
      JSON.stringify(toc),
      { expirationTtl: 7 * 24 * 60 * 60 } // 7 days
    );
  } catch {
    // Non-fatal — TOC is a convenience feature
  }
}

// ── Core indexing ─────────────────────────────────────────────────────────────

/**
 * Chunk, embed, and store text in Vectorize.
 *
 * Uses structure-aware chunking so each vector carries chapter/section
 * metadata. The rag tool can then filter by chapter when querying.
 *
 * Embeddings are processed in batches of 50 to stay within Workers AI limits.
 * Vectors are inserted in batches of 500 to stay within Vectorize limits.
 */
export interface IndexOptions {
  docId?:     string;
  extraMeta?: Record<string, string | number>;
  env?:       { AI?: any; VECTORIZE?: any; MCP_KV?: KVNamespace };
}

export async function indexContent(
  text:      string,
  sessionId: string,
  source:    string,
  options:   IndexOptions = {}
): Promise<IndexResult> {
  const env = options.env ?? getRequestEnv();
  if (!env?.VECTORIZE) throw new Error("VECTORIZE binding not configured.");
  if (!env?.AI)        throw new Error("AI binding not configured.");

  const structured = chunkTextWithStructure(text);
  const texts      = structured.map((c) => c.text);

  // Embed in batches
  type VecInsert = { id: string; values: number[]; metadata: Record<string, string | number> };
  const allVectors: VecInsert[] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch  = texts.slice(i, i + EMBED_BATCH);
    const result = (await env.AI.run(VECTORIZE_EMBEDDING_MODEL as any, {
      text: batch,
    })) as unknown as { data: number[][] };

    for (let j = 0; j < batch.length; j++) {
      const s   = structured[i + j];
      const meta: Record<string, string | number> = {
        session_id:  sessionId,
        source,
        chunk_index: i + j,
        text:        batch[j],
        ...(options.extraMeta ?? {}),
      };
      if (s.chapter)       meta.chapter       = s.chapter;
      if (s.chapter_label) meta.chapter_label = s.chapter_label;
      if (s.section)       meta.section       = s.section;

      const vectorId = options.docId ? `${options.docId}-${i + j}` : crypto.randomUUID();
      allVectors.push({ id: vectorId, values: result.data[j], metadata: meta });
    }
  }

  // Insert in batches
  for (let i = 0; i < allVectors.length; i += VECTORIZE_BATCH) {
    await env.VECTORIZE.insert(allVectors.slice(i, i + VECTORIZE_BATCH));
  }

  const toc              = buildToc(structured, sessionId, source);
  await saveToc(toc, env as any);

  return {
    indexed:           true,
    session_id:        sessionId,
    source,
    chunks:            allVectors.length,
    chapters_detected: toc.chapters.length,
    chapters:          toc.chapters,
  };
}
