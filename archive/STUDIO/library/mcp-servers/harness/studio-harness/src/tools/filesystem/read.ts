import { createReadStream, promises as fs } from "fs";
import { createInterface } from "readline";
import { resolve } from "path";
import { classifyBuffer, GENERATED, inferLanguage } from "./inspect.js";
import { getFileRevision } from "./revision.js";

const DEFAULT_MAX_BYTES = 256 * 1024;
const HARD_MAX_BYTES = 5 * 1024 * 1024;

function numbered(lines: string[], start: number): string {
  return lines.map((line, index) => `${start + index}\t${line}`).join("\n");
}

async function readBytes(path: string, offset: number, requested: number) {
  const length = Math.min(requested, HARD_MAX_BYTES);
  const handle = await fs.open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function readFile(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const path = args.path as string;
  if (!path) return { error: "path is required" };

  const stat = await fs.stat(path);
  if (!stat.isFile()) return { error: `${path} is not a regular file` };

  const byteOffset = args.byte_offset as number | undefined;
  const byteLength = args.byte_length as number | undefined;
  if (byteOffset !== undefined || byteLength !== undefined) {
    if (byteOffset === undefined || byteLength === undefined || byteOffset < 0 || byteLength < 1) {
      return { error: "byte_offset and byte_length must be supplied together and be non-negative/positive integers" };
    }
    const data = await readBytes(path, byteOffset, byteLength);
    const revision = await getFileRevision(path);
    return {
      path: resolve(path),
      content: data.toString((args.encoding as BufferEncoding) || "utf8"),
      byte_offset: byteOffset,
      bytes_returned: data.length,
      size_bytes: stat.size,
      truncated: byteOffset + data.length < stat.size,
      capped: byteLength > HARD_MAX_BYTES,
      modified_ms: Math.floor(stat.mtimeMs),
      revision,
      content_hash: revision.hash,
      language: inferLanguage(path),
      generated: GENERATED.test(path),
    };
  }

  const probe = await readBytes(path, 0, Math.min(stat.size, 8192));
  if (classifyBuffer(probe).binary) {
    return { error: "binary_file: read_file only returns text. Use file_metadata to classify the file and route it to the appropriate specialized capability.", size_bytes: stat.size };
  }

  const legacyOffset = args.offset as number | undefined;
  const legacyLimit = args.limit as number | undefined;
  const startLine = (args.start_line as number | undefined) ?? (legacyOffset !== undefined ? legacyOffset + 1 : 1);
  const endLine = args.end_line as number | undefined;
  const maxLines = endLine !== undefined ? endLine - startLine + 1 : legacyLimit;
  const maxBytes = Math.min((args.max_bytes as number | undefined) ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
  if (startLine < 1 || (maxLines !== undefined && maxLines < 1) || maxBytes < 1) {
    return { error: "start_line must be >= 1; end_line/limit and max_bytes must select a positive range" };
  }

  const includeLineNumbers = (args.include_line_numbers as boolean | undefined) ?? true;
  const lines: string[] = [];
  let lineNumber = 0;
  let returnedBytes = 0;
  let outputLimited = false;
  const input = createReadStream(path, { encoding: (args.encoding as BufferEncoding) || "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    lineNumber++;
    if (lineNumber < startLine) continue;
    if (maxLines !== undefined && lines.length >= maxLines) continue;
    const bytes = Buffer.byteLength(line, "utf8") + 1;
    if (returnedBytes + bytes > maxBytes) {
      outputLimited = true;
      continue;
    }
    lines.push(line);
    returnedBytes += bytes;
  }

  const requestedEnd = maxLines === undefined ? lineNumber : startLine + maxLines - 1;
  const after = await fs.stat(path);
  if (after.size !== stat.size || Math.floor(after.mtimeMs) !== Math.floor(stat.mtimeMs)) return { error: "file_changed_during_read", message: "The file changed while it was being read. Retry the read to obtain a consistent revision." };
  // Compute the revision from the raw file bytes via the shared helper so this
  // hash is identical to what edit/write/delete compute. Hashing the decoded →
  // re-encoded stream (as before) diverged for any non-strict-UTF-8 file and
  // caused false "stale_file" rejections on the next edit.
  const revision = await getFileRevision(path);
  return {
    path: resolve(path),
    content: includeLineNumbers ? numbered(lines, startLine) : lines.join("\n"),
    total_lines: lineNumber,
    start_line: startLine,
    end_line: lines.length ? startLine + lines.length - 1 : startLine - 1,
    lines_returned: lines.length,
    bytes_returned: returnedBytes,
    size_bytes: stat.size,
    modified_ms: Math.floor(stat.mtimeMs),
    truncated: outputLimited || requestedEnd < lineNumber,
    limit_reason: outputLimited ? "max_bytes" : undefined,
    line_numbers_included: includeLineNumbers,
    revision,
    content_hash: revision.hash,
    language: inferLanguage(path),
    generated: GENERATED.test(path),
  };
}
