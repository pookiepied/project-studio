import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { glob } from "glob";
export type Vector = number[] | Record<string, number>;
export interface Chunk {
  id: string;
  path: string;
  start_line: number;
  end_line: number;
  symbol?: string;
  kind: "code" | "document";
  language?: string;
  is_test: boolean;
  generated: boolean;
  imports: string[];
  module: string;
  content_hash: string;
  snippet: string;
  vector: Vector;
}
export interface ContextIndex {
  version: 1;
  root: string;
  created_at: string;
  updated_at: string;
  git_revision?: string;
  embedding: {
    backend: "remote" | "local_fallback";
    model: string;
    dimensions: number;
  };
  files: Record<
    string,
    { hash: string; modified_ms: number; chunks: string[] }
  >;
  chunks: Chunk[];
  failures: { path: string; error: string }[];
}
const EXTS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".rb",
    ".cs",
    ".c",
    ".cpp",
    ".h",
    ".md",
    ".mdx",
    ".txt",
    ".rst",
  ]),
  DOCS = new Set([".md", ".mdx", ".txt", ".rst"]);
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const split = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .match(/[a-z_][a-z0-9_]{1,}/g) || [];
function localVector(text: string): Record<string, number> {
  const v: Record<string, number> = {};
  for (const token of split(text)) {
    const i = parseInt(hash(token).slice(0, 6), 16) % 2048;
    v[i] = (v[i] || 0) + 1;
  }
  const n = Math.sqrt(Object.values(v).reduce((a, b) => a + b * b, 0)) || 1;
  for (const k in v) v[k] /= n;
  return v;
}
async function remoteVectors(texts: string[]): Promise<number[][] | undefined> {
  const url = process.env.STUDIO_EMBEDDING_URL;
  if (!url) return;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.STUDIO_EMBEDDING_KEY
        ? { authorization: `Bearer ${process.env.STUDIO_EMBEDDING_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      model: process.env.STUDIO_EMBEDDING_MODEL || "default",
      input: texts,
    }),
  });
  if (!response.ok)
    throw new Error(`embedding endpoint HTTP ${response.status}`);
  const data: any = await response.json();
  return data.data.map((x: any) => x.embedding);
}
function imports(text: string) {
  return [
    ...text.matchAll(/(?:from\s+|require\(\s*|import\s*\(\s*)["']([^"']+)/g),
  ].map((x) => x[1]);
}
function chunkText(rel: string, text: string): Omit<Chunk, "id" | "vector">[] {
  const ext = path.extname(rel).toLowerCase(),
    lines = text.split(/\r?\n/),
    base = {
      path: rel,
      language: ext.slice(1),
      is_test: /(^|[\\/])(__tests__|tests?|spec)[\\/]|\.(test|spec)\./i.test(
        rel,
      ),
      generated: /(dist|build|vendor|node_modules)|\.generated\./i.test(rel),
      imports: imports(text),
      module: path.dirname(rel),
      content_hash: hash(text),
    };
  const starts: number[] = [];
  if (DOCS.has(ext))
    lines.forEach((l, i) => {
      if (/^#{1,6}\s+/.test(l)) starts.push(i);
    });
  else
    lines.forEach((l, i) => {
      if (
        /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|def|func|struct|trait)\s+[A-Za-z_$][\w$]*/.test(
          l,
        )
      )
        starts.push(i);
    });
  if (!starts.length)
    for (let i = 0; i < lines.length; i += 120) starts.push(i);
  return starts.map((s, i) => {
    const e = Math.min(lines.length, starts[i + 1] ?? s + 120);
    const first = lines[s] || "",
      symbol = (first.match(
        /(?:function|class|interface|type|enum|def|func|struct|trait)\s+([\w$]+)/,
      ) || first.match(/^#{1,6}\s+(.+)/))?.[1];
    return {
      ...base,
      start_line: s + 1,
      end_line: e,
      symbol,
      kind: DOCS.has(ext) ? "document" : "code",
      snippet: lines.slice(s, e).join("\n").slice(0, 12000),
    };
  });
}
export const indexPath = (root: string) =>
  path.join(root, ".studio", "context-index.json");
export async function loadIndex(root: string) {
  try {
    return JSON.parse(
      await fs.readFile(indexPath(root), "utf8"),
    ) as ContextIndex;
  } catch {
    return undefined;
  }
}
export async function buildIndex(
  root: string,
  selected?: string[],
  maxFiles = 2000,
): Promise<ContextIndex> {
  const old = await loadIndex(root);
  const patterns = selected?.length ? selected : ["**/*"];
  const paths = (
    await glob(patterns, {
      cwd: root,
      absolute: true,
      nodir: true,
      dot: false,
      ignore: [
        "**/.git/**",
        "**/.studio/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/vendor/**",
      ],
    })
  )
    .filter((p) => {
      const rel = path.relative(root, p);
      return !rel.startsWith("..") && !path.isAbsolute(rel) && EXTS.has(path.extname(p).toLowerCase());
    })
    .slice(0, maxFiles);
  let chunks = old ? [...old.chunks] : [];
  const
    files = old ? { ...old.files } : {},
    failures: any[] = [];
  for (const selectedPath of selected ?? []) {
    if (/[*?{}[\]]/.test(selectedPath)) continue;
    const absolute = path.resolve(root, selectedPath);
    const rel = path.relative(root, absolute).replace(/\\/g, "/");
    if (rel.startsWith("../") || path.isAbsolute(rel)) throw new Error(`Index path escapes root: ${selectedPath}`);
    try { await fs.access(absolute); } catch {
      chunks = chunks.filter((chunk) => chunk.path !== rel);
      delete files[rel];
    }
  }
  const pending: Omit<Chunk, "id" | "vector">[] = [];
  for (const full of paths) {
    const rel = path.relative(root, full).replace(/\\/g, "/");
    try {
      const stat = await fs.stat(full),
        text = await fs.readFile(full, "utf8"),
        h = hash(text);
      if (old?.files[rel]?.hash === h) continue;
      chunks = chunks.filter((chunk) => chunk.path !== rel);
      delete files[rel];
      pending.push(...chunkText(rel, text));
      files[rel] = {
        hash: h,
        modified_ms: Math.floor(stat.mtimeMs),
        chunks: [],
      };
    } catch (e: any) {
      failures.push({ path: rel, error: e.message });
    }
  }
  let remote: number[][] | undefined;
  const useRemote = old?.embedding.backend === "remote" || (!old && Boolean(process.env.STUDIO_EMBEDDING_URL));
  if (useRemote && pending.length > 0) {
    if (!process.env.STUDIO_EMBEDDING_URL) throw new Error("This index uses remote embeddings; configure STUDIO_EMBEDDING_URL before updating it.");
    remote = [];
    for (let offset = 0; offset < pending.length; offset += 64) {
      const batch = pending.slice(offset, offset + 64).map((c) => `${c.path}\n${c.symbol || ""}\n${c.snippet}`);
      remote.push(...((await remoteVectors(batch)) ?? []));
    }
  }
  pending.forEach((c, i) => {
    const id = hash(`${c.path}:${c.start_line}:${c.content_hash}`).slice(0, 20),
      item = {
        ...c,
        id,
        vector:
          remote?.[i] ||
          localVector(`${c.path} ${c.symbol || ""} ${c.snippet}`),
      };
    chunks.push(item);
    files[c.path].chunks.push(id);
  });
  await fs.mkdir(path.join(root, ".studio"), { recursive: true });
  let git_revision: string | undefined;
  try {
    const { execFile } = await import("child_process");
    git_revision = await new Promise((r) =>
      execFile("git", ["rev-parse", "HEAD"], { cwd: root }, (_, o) =>
        r(o?.trim() || undefined),
      ),
    );
  } catch {}
  const now = new Date().toISOString(),
    index: ContextIndex = {
      version: 1,
      root,
      created_at: old?.created_at || now,
      updated_at: now,
      git_revision,
      embedding: {
        backend: useRemote ? "remote" : "local_fallback",
        model: useRemote
          ? process.env.STUDIO_EMBEDDING_MODEL || "default"
          : "hashed-token-2048",
        dimensions: remote?.[0]?.length || old?.embedding.dimensions || 2048,
      },
      files,
      chunks,
      failures,
    };
  await fs.writeFile(indexPath(root), JSON.stringify(index), "utf8");
  return index;
}
export async function queryVector(
  text: string,
  index: ContextIndex,
): Promise<Vector> {
  if (index.embedding.backend === "remote") {
    const v = await remoteVectors([text]);
    if (!v)
      throw new Error(
        "Index requires STUDIO_EMBEDDING_URL for compatible queries",
      );
    return v[0];
  }
  return localVector(text);
}
export function cosine(a: Vector, b: Vector) {
  if (Array.isArray(a) && Array.isArray(b))
    return a.reduce((s, x, i) => s + x * (b[i] || 0), 0);
  if (!Array.isArray(a) && !Array.isArray(b))
    return Object.entries(a).reduce((s, [k, v]) => s + v * (b[k] || 0), 0);
  return 0;
}
