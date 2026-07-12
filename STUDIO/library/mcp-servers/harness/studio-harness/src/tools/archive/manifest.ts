import { promises as fs } from "fs";
import { extname } from "path";

function unsafe(name: string): boolean { return name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes(".."); }
function zipEntries(data: Buffer) {
  const entries: Record<string, unknown>[] = [];
  for (let i = 0; i + 46 <= data.length;) {
    if (data.readUInt32LE(i) !== 0x02014b50) { i++; continue; }
    const method = data.readUInt16LE(i + 10), compressed = data.readUInt32LE(i + 20), size = data.readUInt32LE(i + 24);
    const nameLen = data.readUInt16LE(i + 28), extra = data.readUInt16LE(i + 30), comment = data.readUInt16LE(i + 32);
    const name = data.subarray(i + 46, i + 46 + nameLen).toString("utf8");
    entries.push({ name, type: name.endsWith("/") ? "directory" : "file", size, compressed_size: compressed, compression_method: method, unsafe_path: unsafe(name) });
    i += 46 + nameLen + extra + comment;
  }
  return entries;
}
function tarEntries(data: Buffer) {
  const entries: Record<string, unknown>[] = [];
  for (let i = 0; i + 512 <= data.length;) {
    const name = data.subarray(i, i + 100).toString("utf8").replace(/\0.*$/, ""); if (!name) break;
    const size = parseInt(data.subarray(i + 124, i + 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    const flag = String.fromCharCode(data[i + 156]); entries.push({ name, type: flag === "5" ? "directory" : flag === "2" ? "symlink" : "file", size, unsafe_path: unsafe(name) });
    i += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
export async function readArchiveManifest(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const path = args.path as string; if (!path) return { error: "path is required" };
  const stat = await fs.stat(path); if (stat.size > 200 * 1024 * 1024) return { error: "Archive exceeds the 200 MB inspection limit" };
  const data = await fs.readFile(path); const ext = extname(path).toLowerCase();
  const format = data.readUInt32LE(0) === 0x04034b50 ? "zip" : ext === ".tar" ? "tar" : "unknown";
  if (format === "unknown") return { error: "Unsupported archive format; supported formats are ZIP and uncompressed TAR" };
  const all = format === "zip" ? zipEntries(data) : tarEntries(data); const offset = Math.max(0, (args.offset as number) || 0); const limit = Math.min((args.max_entries as number) || 500, 10_000);
  const entries = all.slice(offset, offset + limit); return { path, format, total_entries: all.length, offset, entries, unsafe_entries: all.filter(x => x.unsafe_path).length, truncated: offset + entries.length < all.length };
}
