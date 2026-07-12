import { promises as fs, existsSync, statSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import crypto from "crypto";
import { resolveGit } from "../shared/vendor.js";
import type { Provenance, SymbolKind } from "./extract.js";

/**
 * On-disk model for the code graph. Everything lives under `<root>/.studio/graph/`
 * as plain, portable, VCS-committable artifacts that ANY model can read with a
 * bare file read — no query server required:
 *
 *   graph.json     — full node/edge graph (the queryable structure)
 *   GRAPH_REPORT.md — human/LLM-readable overview + how to use it
 *   manifest.json  — freshness tracking only (git HEAD + per-file content hash),
 *                    kept separate so graph_status is cheap on large repos
 */

export const STUDIO_DIR = ".studio";
export const GRAPH_DIR = "graph";
export const GRAPH_FILE = "graph.json";
export const REPORT_FILE = "GRAPH_REPORT.md";
export const MANIFEST_FILE = "manifest.json";
export const SCHEMA_VERSION = 1;

export function graphDir(root: string): string {
  return path.join(root, STUDIO_DIR, GRAPH_DIR);
}
export function graphPaths(root: string) {
  const dir = graphDir(root);
  return {
    dir,
    graph: path.join(dir, GRAPH_FILE),
    report: path.join(dir, REPORT_FILE),
    manifest: path.join(dir, MANIFEST_FILE),
  };
}

export interface GraphNode {
  id: string;              // file rel-path, or `relpath#Name` / `relpath#Class.method`
  kind: "file" | SymbolKind;
  name: string;
  file: string;            // rel-path of the containing file
  start_line?: number;
  end_line?: number;
  exported?: boolean;
}

export interface GraphEdge {
  from: string;            // node id
  to: string;              // node id
  type: "contains" | "imports" | "calls" | "extends" | "implements";
  provenance: Provenance;
}

export interface CodeGraph {
  schema_version: number;
  generated_at: string;
  root: string;
  git_head: string | null;
  languages: string[];
  stats: {
    files: number;
    symbols: number;
    edges: number;
    edges_by_provenance: Record<Provenance, number>;
  };
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
}

export interface Manifest {
  schema_version: number;
  generated_at: string;
  root: string;
  git_head: string | null;
  /** rel-path → sha256 content hash of the file at build time. */
  files: Record<string, string>;
}

export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** Current committed HEAD, or null outside a git repo. Fast, never throws. */
export function gitHead(root: string): string | null {
  try {
    const r = spawnSync(resolveGit(), ["-C", root, "rev-parse", "HEAD"], { encoding: "utf-8", timeout: 5000 });
    if (r.status === 0) return r.stdout.trim() || null;
  } catch { /* not a repo / git missing */ }
  return null;
}

/** Files with uncommitted changes (porcelain), rel-paths. Empty outside git. */
export function gitDirtyFiles(root: string): string[] {
  try {
    const r = spawnSync(resolveGit(), ["-C", root, "status", "--porcelain"], { encoding: "utf-8", timeout: 5000 });
    if (r.status !== 0) return [];
    return r.stdout.split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"));
  } catch { return []; }
}

export async function loadGraph(root: string): Promise<CodeGraph | null> {
  try {
    return JSON.parse(await fs.readFile(graphPaths(root).graph, "utf-8")) as CodeGraph;
  } catch { return null; }
}

export async function loadManifest(root: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await fs.readFile(graphPaths(root).manifest, "utf-8")) as Manifest;
  } catch { return null; }
}

/**
 * Resolve a relative import specifier to a repo-relative file path, trying the
 * usual TS/JS extension and index conventions. Returns null for bare (package)
 * specifiers and anything that doesn't resolve on disk.
 */
const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
export function resolveImport(fromFileAbs: string, specifier: string, root: string): string | null {
  if (!specifier.startsWith(".")) return null; // package import
  const baseAbs = path.resolve(path.dirname(fromFileAbs), specifier);
  const candidates: string[] = [];
  // As written (may already have an extension).
  candidates.push(baseAbs);
  for (const e of RESOLVE_EXTS) candidates.push(baseAbs + e);
  // Rewrite a .js/.jsx specifier to its TS source (ESM import convention).
  const jsRewrite = baseAbs.replace(/\.(js|jsx|mjs|cjs)$/, "");
  if (jsRewrite !== baseAbs) for (const e of RESOLVE_EXTS) candidates.push(jsRewrite + e);
  // index.* barrels.
  for (const e of RESOLVE_EXTS) candidates.push(path.join(baseAbs, "index" + e));
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        if (statSync(c).isFile()) return path.relative(root, c).replace(/\\/g, "/");
      } catch { /* skip */ }
    }
  }
  return null;
}
