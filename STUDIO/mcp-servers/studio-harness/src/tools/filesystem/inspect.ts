import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
import { extname } from "path";

export const GENERATED = /(^|[\\/])(dist|build|coverage|vendor|node_modules)[\\/]|\.min\.(js|css)$|\.generated\./i;
const LANGUAGES: Record<string, string> = { ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript", ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".rb": "ruby", ".c": "c", ".h": "c", ".cpp": "cpp", ".cs": "csharp", ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".md": "markdown", ".html": "html", ".css": "css", ".sh": "shell", ".ps1": "powershell" };
export function inferLanguage(path: string): string | undefined { return LANGUAGES[extname(path).toLowerCase()]; }

async function sample(path: string, length = 8192): Promise<Buffer> {
  const handle = await fs.open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

export function classifyBuffer(buffer: Buffer) {
  if (buffer.length === 0) return { binary: false, encoding: "utf-8", confidence: "high" };
  if (buffer.includes(0)) return { binary: true, encoding: null, confidence: "high" };
  let suspicious = 0;
  for (const byte of buffer) if (byte < 7 || (byte > 13 && byte < 32)) suspicious++;
  const ratio = suspicious / buffer.length;
  return { binary: ratio > 0.1, encoding: ratio > 0.1 ? null : "utf-8", confidence: ratio > 0.02 && ratio <= 0.1 ? "medium" : "high" };
}

export async function detectBinary(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const path = args.path as string;
  if (!path) return { error: "path is required" };
  const buffer = await sample(path, Math.min((args.sample_bytes as number) || 8192, 1024 * 1024));
  return { path, sample_bytes: buffer.length, ...classifyBuffer(buffer) };
}

export async function fileMetadata(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const path = args.path as string;
  if (!path) return { error: "path is required" };
  const stat = await fs.lstat(path);
  const kind = stat.isFile() ? "file" : stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "other";
  const classification = stat.isFile() ? classifyBuffer(await sample(path)) : undefined;
  const first = stat.isFile() ? (await sample(path, 32768)).toString("utf8") : "";
  const lines = first.split(/\r?\n/).filter(Boolean);
  const minified = lines.length > 0 && lines.reduce((n, line) => n + line.length, 0) / lines.length > 500;
  return {
    path, kind, size_bytes: stat.size, extension: extname(path).toLowerCase() || null,
    created_ms: Math.floor(stat.birthtimeMs), modified_ms: Math.floor(stat.mtimeMs), accessed_ms: Math.floor(stat.atimeMs),
    mode: stat.mode, readable: true, generated: GENERATED.test(path), minified, ...classification,
    symlink_target: stat.isSymbolicLink() ? await fs.readlink(path) : undefined,
  };
}

export async function contentHash(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const path = args.path as string;
  if (!path) return { error: "path is required" };
  const algorithm = (args.algorithm as string) || "sha256";
  const start = (args.byte_offset as number) || 0;
  const length = args.byte_length as number | undefined;
  const hash = createHash(algorithm);
  let bytes = 0;
  for await (const chunk of createReadStream(path, { start, end: length === undefined ? undefined : start + length - 1 })) {
    const data = chunk as Buffer; bytes += data.length; hash.update(data);
  }
  return { path, algorithm, hash: hash.digest("hex"), byte_offset: start, bytes_hashed: bytes, scope: length === undefined && start === 0 ? "whole_file" : "byte_range" };
}
