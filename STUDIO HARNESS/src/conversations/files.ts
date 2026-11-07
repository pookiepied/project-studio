import { open, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  conversationArtifactsDirectory,
  conversationAttachmentsDirectory,
  conversationDirectory,
  conversationScratchDirectory,
  conversationWorkspaceDirectory,
} from "../platform/paths.js";

/**
 * The files a conversation may show, and how a reply's loose words find one.
 *
 * A reply names a file however it likes: `climate-change.md`, `workspace/chart.png`,
 * a path relative to where the model stood, or a full one. Only this side knows
 * where a conversation stands, so this is where those words become a real path.
 *
 * The boundary is the same for every reader here. A file is answered for only when
 * its real path, links resolved, lies inside one of the conversation's own places.
 * A path that climbs out, or a link that points out, is answered like a missing
 * one, so the answer cannot be used to probe the rest of the disk.
 */

/** A folder a person would not mean, and that would use up the search for nothing. */
const SKIPPED_FOLDERS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "target", "out", ".next", ".cache", ".venv", "venv", "__pycache__",
]);

/** How much of a folder tree one lookup may read. Bounds a click on a huge project. */
const SEARCH_MAX_ENTRIES = 20_000;
const SEARCH_MAX_DEPTH = 8;
const SEARCH_MAX_MATCHES = 50;

/** The most text the viewer is sent; a longer file is cut here and says so. */
const TEXT_MAX_BYTES = 1024 * 1024;
/** Binary files show a NUL early; text does not. */
const BINARY_SNIFF_BYTES = 8192;

/** Credentials stay out of the viewer even inside a conversation's own folders. */
const SECRET_NAME = /^\.env(?:\.|$)|\.(?:pem|key|pfx|p12)$/i;

export interface ConversationFolders {
  /** Where a relative path means what it says: where the turns stand. */
  readonly stand: string;
  readonly home: string;
  readonly roots: readonly string[];
}

export function conversationFolders(conversationId: string, projectFolders: readonly string[]): ConversationFolders {
  return {
    stand: projectFolders[0] ?? conversationWorkspaceDirectory(conversationId),
    home: conversationDirectory(conversationId),
    roots: [
      ...projectFolders,
      conversationWorkspaceDirectory(conversationId),
      conversationScratchDirectory(conversationId),
      conversationArtifactsDirectory(conversationId),
      conversationAttachmentsDirectory(conversationId),
    ],
  };
}

/** `child` is `root` or lies beneath it. Both are already real paths. */
function within(root: string, child: string): boolean {
  const offset = relative(root, child);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

async function realRoots(folders: ConversationFolders): Promise<string[]> {
  const real = await Promise.all(folders.roots.map((root) => realpath(root).catch(() => null)));
  return [...new Set(real.filter((root): root is string => root !== null))];
}

/** A `file:` address is the same path spelled as a URL. */
function plainPath(requested: string): string {
  return /^file:\/\//i.test(requested) ? fileURLToPath(requested) : requested;
}

/**
 * The real paths a reference names exactly, nearest first, inside the
 * conversation's places. Empty when it names nothing there.
 */
export async function containedPaths(folders: ConversationFolders, requested: string): Promise<string[]> {
  const named = plainPath(requested);
  const candidates = isAbsolute(named) ? [named] : [resolve(folders.stand, named), resolve(folders.home, named)];
  const roots = await realRoots(folders);
  const contained: string[] = [];
  for (const candidate of candidates) {
    const real = await realpath(candidate).catch(() => null);
    if (real !== null && roots.some((root) => within(root, real))) contained.push(real);
  }
  return contained;
}

/**
 * The segments to look for when a reference names nothing exactly, or null when
 * it is not that kind of reference. A full Windows path is its own answer, and a
 * path with `..` is not a name to go looking for. A leading `/` is kept out: a
 * sandbox writes `/workspace/notes.md` for what the disk calls something else.
 */
function looseSegments(requested: string): readonly string[] | null {
  if (/^[A-Za-z]:[\\/]/.test(requested) || /^[\\/]{2}/.test(requested) || /^file:/i.test(requested)) return null;
  const segments = requested.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) return null;
  return segments;
}

function endsWith(path: string, segments: readonly string[]): boolean {
  const tail = path.split(sep).slice(-segments.length);
  return tail.length === segments.length
    && tail.every((segment, index) => segment.toLowerCase() === segments[index]?.toLowerCase());
}

/**
 * Every path under the roots ending in these segments. Links are not followed, so
 * the walk cannot leave the roots. It stops at its budget and reports what it has:
 * a click on a very large project may miss a file, and must not hang.
 */
async function search(roots: readonly string[], segments: readonly string[]): Promise<string[]> {
  const matches: string[] = [];
  const seen = new Set<string>();
  const queue = roots.map((path) => ({ path, depth: 0 }));
  let visited = 0;
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (seen.has(next.path)) continue;
    seen.add(next.path);
    const entries = await readdir(next.path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      visited += 1;
      if (visited > SEARCH_MAX_ENTRIES || matches.length >= SEARCH_MAX_MATCHES) return matches;
      if (!entry.isFile() && !entry.isDirectory()) continue;
      const path = join(next.path, entry.name);
      if (endsWith(path, segments)) matches.push(path);
      if (entry.isDirectory() && next.depth < SEARCH_MAX_DEPTH && !SKIPPED_FOLDERS.has(entry.name)) {
        queue.push({ path, depth: next.depth + 1 });
      }
    }
  }
  return matches;
}

export interface FileLocation {
  readonly path: string;
  readonly kind: "file" | "folder";
  /** Other paths that fit the same reference; `path` is the newest of them. */
  readonly others: number;
}

async function describe(path: string): Promise<{ path: string; kind: "file" | "folder"; modified: number } | null> {
  const info = await stat(path).catch(() => null);
  if (info === null || (!info.isFile() && !info.isDirectory())) return null;
  return { path, kind: info.isDirectory() ? "folder" : "file", modified: info.mtimeMs };
}

/**
 * Where a reply's reference really is. An exact reading wins; failing that, the
 * conversation's places are searched for a path ending the same way, and the
 * newest match is the answer, with the count of the rest so the caller can say so.
 */
export async function locateConversationFile(
  conversationId: string,
  requested: string,
  projectFolders: readonly string[],
): Promise<FileLocation | null> {
  const folders = conversationFolders(conversationId, projectFolders);
  for (const path of await containedPaths(folders, requested)) {
    const exact = await describe(path);
    if (exact !== null) return { path: exact.path, kind: exact.kind, others: 0 };
  }
  const segments = looseSegments(requested);
  if (segments === null) return null;
  const found = await Promise.all((await search(await realRoots(folders), segments)).map(describe));
  const matches = found
    .filter((match) => match !== null)
    .sort((a, b) => b.modified - a.modified);
  const newest = matches[0];
  return newest === undefined ? null : { path: newest.path, kind: newest.kind, others: matches.length - 1 };
}

export interface FileText {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * The start of a text file, for the viewer. Null for anything it should not show:
 * outside the conversation, a folder, binary, or a credential.
 */
export async function readConversationText(
  conversationId: string,
  requested: string,
  projectFolders: readonly string[],
): Promise<FileText | null> {
  const folders = conversationFolders(conversationId, projectFolders);
  const [path] = await containedPaths(folders, requested);
  if (path === undefined || SECRET_NAME.test(basename(path))) return null;
  const info = await stat(path).catch(() => null);
  if (info === null || !info.isFile()) return null;

  const handle = await open(path, "r").catch(() => null);
  if (handle === null) return null;
  try {
    const buffer = Buffer.alloc(Math.min(info.size, TEXT_MAX_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
    const truncated = info.size > bytesRead;
    const text = new TextDecoder("utf-8").decode(bytes);
    // A cut can land inside a character, so a shortened text ends at a whole line.
    const end = text.lastIndexOf("\n");
    return { text: truncated && end > 0 ? text.slice(0, end) : text, truncated };
  } finally {
    await handle.close();
  }
}
