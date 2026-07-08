import { promises as fs } from "fs";

// Per-session dedup cache. Key = "path::offset::limit" → last seen mtime + total line count.
// Saves a full re-read when the LLM requests the same range of an unchanged file.
const readCache = new Map<string, { mtime: number; totalLines: number }>();

// Threshold above which an unbounded read shows a warning instead of silently
// burning tokens. ~80 KB ≈ 20,000 tokens at 4 chars/token.
const TOKEN_GATE_CHARS = 80_000;

// Hard ceiling applied even when allow_large: true. Prevents 50MB binaries or
// generated files from flooding the context window. 5 MB ≈ 1.25M tokens.
const ABSOLUTE_MAX_CHARS = 5 * 1024 * 1024;

function addLineNumbers(lines: string[], startLine: number): string {
  return lines.map((l, i) => `${startLine + i}\t${l}`).join("\n");
}

export async function readFile(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const filePath = args.path as string;
  // offset is 0-indexed line position; limit is max lines to return
  const offset = (args.offset as number) ?? 0;
  const limit = args.limit as number | undefined;
  // allow_large: true bypasses the token-gate error and reads the whole file.
  // A size warning is still included in the response. Hard 5 MB ceiling still applies.
  const allowLarge = (args.allow_large as boolean) ?? false;

  if (!filePath) return { error: "path is required" };

  // Stat first (cheap) — gives us mtime for dedup and size for early rejection
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { error: `File not found: ${filePath}` };
  }
  const mtime = Math.floor(stat.mtimeMs);

  // Absolute ceiling — check the on-disk size BEFORE loading the file into
  // memory. Without this, a 50 MB file would be fully read into a string and
  // only then rejected, defeating the purpose of the guard. stat.size is in
  // bytes (>= char count for UTF-8), so this can only ever reject earlier, not
  // let something through that the post-read check would have caught.
  if (stat.size > ABSOLUTE_MAX_CHARS) {
    return {
      error:
        `File exceeds the absolute size limit (${(stat.size / 1024 / 1024).toFixed(1)} MB). ` +
        `Use offset and limit to read specific sections, or outline_file to see structure first.`,
      total_lines: undefined,
      size_bytes: stat.size,
    };
  }

  // Dedup: if same path+range and mtime unchanged, skip the read entirely
  const cacheKey = `${filePath}::${offset}::${limit ?? "all"}`;
  const cached = readCache.get(cacheKey);
  if (cached && cached.mtime === mtime) {
    return {
      unchanged: true,
      note: "File not modified since last read. Content from that read is still in your context window.",
      total_lines: cached.totalLines,
      start_line: offset + 1,
    };
  }

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return { error: `Cannot read file: ${filePath}` };
  }

  const lines = raw.split("\n");
  const total = lines.length;
  const end = limit !== undefined ? offset + limit : total;
  const selected = lines.slice(offset, end);

  // Absolute ceiling — enforced even with allow_large: true.
  // Prevents binaries or generated files from flooding the context window.
  if (raw.length > ABSOLUTE_MAX_CHARS) {
    return {
      error:
        `File exceeds the absolute size limit (${(raw.length / 1024 / 1024).toFixed(1)} MB). ` +
        `Use offset and limit to read specific sections, or outline_file to see structure first.`,
      total_lines: total,
      size_bytes: raw.length,
    };
  }

  // Token gate — fires when no explicit limit AND file is large AND allow_large not set.
  // If the caller set limit, they're already scoping — let it through unconditionally.
  // If the caller set allow_large: true, they explicitly want the full file — let it through with a warning.
  let sizeWarning: string | undefined;
  if (limit === undefined && raw.length > TOKEN_GATE_CHARS) {
    if (!allowLarge) {
      const estimatedTokens = Math.round(raw.length / 4);
      return {
        error:
          `File too large for an unbounded read (est. ${estimatedTokens.toLocaleString()} tokens, ${total} lines). ` +
          `Options:\n` +
          `  1. Use offset + limit to read a specific section (recommended):\n` +
          `       offset=0, limit=100          → first 100 lines\n` +
          `       offset=${Math.max(0, total - 100)}, limit=100  → last 100 lines\n` +
          `  2. Run outline_file first → identify the section you need → read with offset+limit.\n` +
          `  3. Pass allow_large: true to read the entire file anyway (use sparingly).`,
        total_lines: total,
        estimated_tokens: estimatedTokens,
      };
    }
    // allow_large: true path — include a warning but proceed
    sizeWarning =
      `Large file read (${total} lines, est. ${Math.round(raw.length / 4).toLocaleString()} tokens). ` +
      `Consider outline_file + targeted reads for future sessions to save context.`;
  }

  readCache.set(cacheKey, { mtime, totalLines: total });

  // 1-based start line for display (matches editor line numbers)
  const startLine = offset + 1;
  const content = addLineNumbers(selected, startLine);

  return {
    content,
    total_lines: total,
    start_line: startLine,
    lines_returned: selected.length,
    truncated: end < total,
    ...(sizeWarning && { size_warning: sizeWarning }),
  };
}
