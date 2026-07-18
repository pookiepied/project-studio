import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import { join, relative } from "path";

type Stamp = { size: number; mtime: number };
const snapshots = new Map<string, { root: string; files: Map<string, Stamp> }>();
const IGNORED = new Set([".git", "node_modules", "dist", "build", "coverage"]);
// Bound retained snapshots — a caller that snapshots and never drops would
// otherwise leak a full file-stamp map per snapshot for the life of the server.
const MAX_SNAPSHOTS = 50;

async function scan(root: string, maxFiles: number): Promise<Map<string, Stamp>> {
  const files = new Map<string, Stamp>();
  async function walk(dir: string): Promise<void> {
    if (files.size >= maxFiles) return;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) { const stat = await fs.stat(full); files.set(relative(root, full), { size: stat.size, mtime: Math.floor(stat.mtimeMs) }); }
    }
  }
  await walk(root); return files;
}

export async function watchFiles(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const action = (args.action as string) || "snapshot";
  if (action === "drop") { const id = args.snapshot_id as string; return { dropped: snapshots.delete(id), snapshot_id: id }; }
  const maxFiles = Math.min((args.max_files as number) || 10_000, 100_000);
  if (action === "snapshot") {
    const root = (args.path as string) || process.cwd(); const files = await scan(root, maxFiles); const id = randomUUID();
    if (snapshots.size >= MAX_SNAPSHOTS) { const oldest = snapshots.keys().next().value; if (oldest) snapshots.delete(oldest); }
    snapshots.set(id, { root, files }); return { snapshot_id: id, path: root, files: files.size };
  }
  if (action !== "changes") return { error: "action must be snapshot, changes, or drop" };
  const id = args.snapshot_id as string; const prior = snapshots.get(id);
  if (!prior) return { error: "Unknown or expired snapshot_id; create a new snapshot first" };
  const current = await scan(prior.root, maxFiles); const added: string[] = [], modified: string[] = [], deleted: string[] = [];
  for (const [path, stamp] of current) { const old = prior.files.get(path); if (!old) added.push(path); else if (old.size !== stamp.size || old.mtime !== stamp.mtime) modified.push(path); }
  for (const path of prior.files.keys()) if (!current.has(path)) deleted.push(path);
  prior.files = current;
  const revision = createHash("sha256").update(JSON.stringify([...current])).digest("hex");
  return { snapshot_id: id, added, modified, deleted, changed_count: added.length + modified.length + deleted.length, revision };
}
