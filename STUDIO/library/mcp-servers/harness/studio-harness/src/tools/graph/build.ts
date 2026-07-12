import { promises as fs } from "fs";
import path from "path";
import { parsePath } from "../syntax/runtime.js";
import { extractFile, isSupportedLanguage, type FileExtraction, type Provenance } from "./extract.js";
import {
  graphPaths, sha256, gitHead, SCHEMA_VERSION,
  type CodeGraph, type GraphNode, type GraphEdge, type Manifest,
  resolveImport,
} from "./store.js";
import { buildReport } from "./report.js";

const SKIP_DIRS = new Set([
  ".git", ".svn", ".hg", "node_modules", "bower_components",
  "dist", "build", ".next", ".nuxt", ".output", "out",
  ".turbo", ".cache", ".parcel-cache", "coverage", ".nyc_output", ".studio",
]);
const SUPPORTED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const DEFAULT_MAX_FILES = 1500;

async function walk(dir: string, root: string, max: number, out: string[]): Promise<void> {
  if (out.length >= max) return;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= max) break;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, root, max, out);
    else if (e.isFile() && SUPPORTED_EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
}

/** Absolute paths of the graphable source files under `root` (bounded). */
export async function listSupportedFiles(root: string, max = DEFAULT_MAX_FILES): Promise<string[]> {
  const out: string[] = [];
  await walk(root, root, max, out);
  return out;
}

interface BuildOptions { root: string; maxFiles: number; }

export async function buildGraph(opts: BuildOptions): Promise<{
  graph: CodeGraph; manifest: Manifest; truncated: boolean; durationMs: number;
}> {
  const { root } = opts;
  const start = Date.now();

  const files: string[] = [];
  await walk(root, root, opts.maxFiles, files);
  const truncated = files.length >= opts.maxFiles;

  const nodes: Record<string, GraphNode> = {};
  const edges: GraphEdge[] = [];
  const fileHashes: Record<string, string> = {};

  // name → node ids that declare it (for global name-match resolution).
  const byName = new Map<string, string[]>();
  // rel-path → its extraction (kept for the resolution pass).
  const extractions = new Map<string, { rel: string; abs: string; ex: FileExtraction }>();
  const languages = new Set<string>();

  // ---- Pass 1: parse + extract per file, register nodes ----
  for (const abs of files) {
    let parsed;
    try { parsed = await parsePath(abs); } catch { continue; }
    if (!isSupportedLanguage(parsed.language)) continue;
    languages.add(parsed.language);

    const rel = path.relative(root, abs).replace(/\\/g, "/");
    fileHashes[rel] = sha256(parsed.text);

    // File node.
    nodes[rel] = { id: rel, kind: "file", name: rel, file: rel };

    const ex = extractFile(parsed.tree.rootNode, parsed.text, parsed.language);
    extractions.set(rel, { rel, abs, ex });

    for (const s of ex.symbols) {
      const id = `${rel}#${s.local}`;
      nodes[id] = {
        id, kind: s.kind, name: s.name, file: rel,
        start_line: s.start_line, end_line: s.end_line, exported: s.exported,
      };
      edges.push({ from: rel, to: id, type: "contains", provenance: "EXTRACTED" });
      const list = byName.get(s.name) ?? [];
      list.push(id);
      byName.set(s.name, list);
    }
  }

  // ---- Pass 2: resolve import (file→file) and reference (symbol→symbol) edges ----
  const bump = (p: Provenance) => { counts[p]++; };
  const counts: Record<Provenance, number> = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0 };

  for (const { rel, abs, ex } of extractions.values()) {
    // file → file imports
    for (const spec of ex.importSources) {
      const targetRel = resolveImport(abs, spec, root);
      if (targetRel && nodes[targetRel]) {
        edges.push({ from: rel, to: targetRel, type: "imports", provenance: "EXTRACTED" });
        bump("EXTRACTED");
      }
    }

    // Import binding lookup: local name → { source rel-path, imported name }.
    const importMap = new Map<string, { targetRel: string | null; imported: string }>();
    for (const b of ex.imports) {
      importMap.set(b.local, { targetRel: resolveImport(abs, b.source, root), imported: b.imported });
    }

    const localNames = new Set(ex.symbols.map((s) => s.local.split(".")[0]));

    for (const ref of ex.refs) {
      const fromId = ref.from ? `${rel}#${ref.from}` : rel;
      if (!nodes[fromId]) continue;
      const edgeType = ref.kind; // calls | extends | implements

      // 1. Cross-file via explicit import binding → EXTRACTED.
      const binding = importMap.get(ref.name);
      if (binding?.targetRel && binding.imported !== "*") {
        const targetId = `${binding.targetRel}#${binding.imported === "default" ? ref.name : binding.imported}`;
        if (nodes[targetId]) {
          edges.push({ from: fromId, to: targetId, type: edgeType, provenance: "EXTRACTED" });
          bump("EXTRACTED");
          continue;
        }
      }

      // 2. Same-file symbol → EXTRACTED.
      if (localNames.has(ref.name) && nodes[`${rel}#${ref.name}`]) {
        edges.push({ from: fromId, to: `${rel}#${ref.name}`, type: edgeType, provenance: "EXTRACTED" });
        bump("EXTRACTED");
        continue;
      }

      // 3. Global name match → INFERRED (unique) or AMBIGUOUS (many).
      const candidates = (byName.get(ref.name) ?? []).filter((id) => id !== fromId);
      if (candidates.length === 1) {
        edges.push({ from: fromId, to: candidates[0], type: edgeType, provenance: "INFERRED" });
        bump("INFERRED");
      } else if (candidates.length > 1) {
        edges.push({ from: fromId, to: candidates[0], type: edgeType, provenance: "AMBIGUOUS" });
        bump("AMBIGUOUS");
      }
      // else: unresolved (external/builtin) — dropped by design.
    }
  }

  // `contains` edges are all EXTRACTED; fold them into the provenance counts.
  counts.EXTRACTED += edges.filter((e) => e.type === "contains").length;

  const symbolCount = Object.values(nodes).filter((n) => n.kind !== "file").length;
  const head = gitHead(root);
  const generated_at = new Date().toISOString();

  const graph: CodeGraph = {
    schema_version: SCHEMA_VERSION,
    generated_at,
    root,
    git_head: head,
    languages: [...languages].sort(),
    stats: {
      files: Object.values(nodes).filter((n) => n.kind === "file").length,
      symbols: symbolCount,
      edges: edges.length,
      edges_by_provenance: counts,
    },
    nodes,
    edges,
  };

  const manifest: Manifest = {
    schema_version: SCHEMA_VERSION,
    generated_at,
    root,
    git_head: head,
    files: fileHashes,
  };

  // ---- Write artifacts ----
  const paths = graphPaths(root);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.graph, JSON.stringify(graph, null, 2), "utf-8");
  await fs.writeFile(paths.manifest, JSON.stringify(manifest, null, 2), "utf-8");
  await fs.writeFile(paths.report, buildReport(graph), "utf-8");

  return { graph, manifest, truncated, durationMs: Date.now() - start };
}
