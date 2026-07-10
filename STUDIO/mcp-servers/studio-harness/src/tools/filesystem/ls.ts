import { promises as fs } from "fs";
import { join, relative } from "path";

interface Entry { path: string; name: string; type: "file" | "directory" | "symlink" | "other"; size?: number; depth: number }
const DEFAULT_IGNORES = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache"]);

export async function listDirectory(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const root = (args.path as string) || process.cwd();
  const recursive = (args.recursive as boolean) || false;
  const maxDepth = Math.max(0, Math.min((args.depth as number | undefined) ?? (recursive ? 3 : 1), 20));
  const maxEntries = Math.max(1, Math.min((args.max_entries as number) || 500, 10_000));
  const includeHidden = (args.include_hidden as boolean) || false;
  const ignores = new Set([...DEFAULT_IGNORES, ...((args.ignore as string[]) || [])]);
  const entries: Entry[] = [];
  let skipped = 0;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth || entries.length >= maxEntries) return;
    const dirents = await fs.readdir(directory, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const item of dirents) {
      if (entries.length >= maxEntries) { skipped++; continue; }
      if ((!includeHidden && item.name.startsWith(".")) || ignores.has(item.name)) { skipped++; continue; }
      const full = join(directory, item.name);
      const type = item.isDirectory() ? "directory" : item.isFile() ? "file" : item.isSymbolicLink() ? "symlink" : "other";
      const stat = type === "file" ? await fs.stat(full) : undefined;
      entries.push({ path: relative(root, full) || item.name, name: item.name, type, size: stat?.size, depth });
      if (type === "directory" && depth < maxDepth) await walk(full, depth + 1);
    }
  }

  await walk(root, 1);
  return { path: root, entries, count: entries.length, max_depth: maxDepth, ignored_or_skipped: skipped, truncated: entries.length >= maxEntries };
}
