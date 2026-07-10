import { promises as fs } from "fs";
import path from "path";
import { buildGraph, listSupportedFiles } from "./build.js";
import {
  loadGraph, loadManifest, graphPaths, sha256, gitHead,
  type CodeGraph, type GraphEdge,
} from "./store.js";

const DEFAULT_MAX_FILES = 1500;

function root(args: Record<string, unknown>): string {
  return path.resolve((args.root_dir as string) || process.cwd());
}

// ---------------------------------------------------------------------------
// graph_build
// ---------------------------------------------------------------------------

export async function graphBuild(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = root(args);
  const maxFiles = (args.max_files as number) ?? DEFAULT_MAX_FILES;
  const { graph, truncated, durationMs } = await buildGraph({ root: r, maxFiles });
  const paths = graphPaths(r);
  if (graph.stats.files === 0) {
    return {
      error:
        "graph_build: found no TypeScript/JavaScript source under this root. " +
        "Phase 1 supports .ts/.tsx/.js/.jsx only. Point root_dir at the code directory.",
      root: r,
    };
  }
  return {
    success: true,
    root: r,
    languages: graph.languages,
    stats: graph.stats,
    truncated,
    truncated_note: truncated ? `Stopped at max_files (${maxFiles}); raise it to index the rest.` : undefined,
    duration_ms: durationMs,
    output: {
      report: path.relative(r, paths.report).replace(/\\/g, "/"),
      graph: path.relative(r, paths.graph).replace(/\\/g, "/"),
      manifest: path.relative(r, paths.manifest).replace(/\\/g, "/"),
    },
    next_step:
      "Read .studio/graph/GRAPH_REPORT.md for the overview (any model can read it directly). " +
      "Use graph_neighbors / graph_path / graph_impact for targeted questions. " +
      "Commit .studio/graph/graph.json and GRAPH_REPORT.md so the map travels with the repo.",
  };
}

// ---------------------------------------------------------------------------
// graph_status — the freshness gate
// ---------------------------------------------------------------------------

export async function graphStatus(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = root(args);
  const manifest = await loadManifest(r);
  if (!manifest) {
    return {
      status: "missing",
      root: r,
      recommendation: "No graph yet. Run graph_build before relying on the graph or GRAPH_REPORT.md.",
    };
  }

  const currentHead = gitHead(r);
  const headMoved = manifest.git_head !== currentHead;

  // Definitive check: re-hash every indexed file and compare. Content hash is
  // the only fully trusted signal — timestamps and git state can both lie.
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [rel, hash] of Object.entries(manifest.files)) {
    try {
      const content = await fs.readFile(path.join(r, rel), "utf-8");
      if (sha256(content) !== hash) changed.push(rel);
    } catch {
      removed.push(rel);
    }
  }
  // New files not present at build time.
  const known = new Set(Object.keys(manifest.files));
  const added: string[] = [];
  for (const abs of await listSupportedFiles(r, DEFAULT_MAX_FILES)) {
    const rel = path.relative(r, abs).replace(/\\/g, "/");
    if (!known.has(rel)) added.push(rel);
  }

  const stale = changed.length > 0 || removed.length > 0 || added.length > 0;
  const cap = <T,>(a: T[]) => ({ count: a.length, sample: a.slice(0, 40) });

  return {
    status: stale ? "stale" : "fresh",
    root: r,
    generated_at: manifest.generated_at,
    git_head: { indexed: manifest.git_head, current: currentHead, moved: headMoved },
    changed: cap(changed),
    added: cap(added),
    removed: cap(removed),
    recommendation: stale
      ? "Graph is stale. Run graph_build to regenerate before trusting relationships."
      : "Graph is up to date with the working tree.",
  };
}

// ---------------------------------------------------------------------------
// Shared resolution + traversal helpers
// ---------------------------------------------------------------------------

type Resolved = { id: string } | { ambiguous: string[] } | { notFound: true };

function resolveNode(graph: CodeGraph, input: string): Resolved {
  if (graph.nodes[input]) return { id: input };
  const norm = input.replace(/\\/g, "/");
  if (graph.nodes[norm]) return { id: norm };
  // Match by symbol name or file suffix.
  const matches = Object.values(graph.nodes).filter(
    (n) => n.name === input || n.id.endsWith(`#${input}`) || (n.kind === "file" && n.id.endsWith(norm)),
  );
  const ids = [...new Set(matches.map((n) => n.id))];
  if (ids.length === 1) return { id: ids[0] };
  if (ids.length > 1) return { ambiguous: ids.slice(0, 20) };
  return { notFound: true };
}

interface Adj { out: Map<string, GraphEdge[]>; in: Map<string, GraphEdge[]>; }
function adjacency(graph: CodeGraph, types?: Set<string>): Adj {
  const out = new Map<string, GraphEdge[]>();
  const inn = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (types && !types.has(e.type)) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push(e);
  }
  return { out, in: inn };
}

function nodeBrief(graph: CodeGraph, id: string) {
  const n = graph.nodes[id];
  return n ? { id, kind: n.kind, name: n.name, file: n.file, line: n.start_line } : { id, kind: "unknown" };
}

// ---------------------------------------------------------------------------
// graph_neighbors
// ---------------------------------------------------------------------------

export async function graphNeighbors(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = root(args);
  const graph = await loadGraph(r);
  if (!graph) return { error: "graph_neighbors: no graph found. Run graph_build first." };
  const input = args.node as string;
  if (!input) return { error: "graph_neighbors: 'node' (id or name) is required." };

  const resolved = resolveNode(graph, input);
  if ("ambiguous" in resolved) return { ambiguous: resolved.ambiguous, note: "Multiple matches; pass a full node id." };
  if ("notFound" in resolved) return { error: `graph_neighbors: no node matches '${input}'.` };

  const direction = (args.direction as string) ?? "both"; // dependencies | dependents | both
  const depth = Math.min(Math.max(1, (args.depth as number) ?? 1), 3);
  const types = Array.isArray(args.edge_types) ? new Set(args.edge_types as string[]) : undefined;
  const adj = adjacency(graph, types);

  const results: any[] = [];
  const seen = new Set<string>([resolved.id]);
  let frontier = [resolved.id];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (direction !== "dependents") {
        for (const e of adj.out.get(id) ?? []) if (!seen.has(e.to)) {
          seen.add(e.to); next.push(e.to);
          results.push({ ...nodeBrief(graph, e.to), relation: e.type, direction: "dependency", provenance: e.provenance, depth: d });
        }
      }
      if (direction !== "dependencies") {
        for (const e of adj.in.get(id) ?? []) if (!seen.has(e.from)) {
          seen.add(e.from); next.push(e.from);
          results.push({ ...nodeBrief(graph, e.from), relation: e.type, direction: "dependent", provenance: e.provenance, depth: d });
        }
      }
    }
    frontier = next;
  }

  const truncated = results.length > 200;
  return {
    node: nodeBrief(graph, resolved.id),
    direction, depth,
    count: results.length,
    neighbors: results.slice(0, 200),
    truncated,
  };
}

// ---------------------------------------------------------------------------
// graph_path
// ---------------------------------------------------------------------------

export async function graphPath(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = root(args);
  const graph = await loadGraph(r);
  if (!graph) return { error: "graph_path: no graph found. Run graph_build first." };
  const fromIn = args.from as string, toIn = args.to as string;
  if (!fromIn || !toIn) return { error: "graph_path: 'from' and 'to' (ids or names) are required." };

  const a = resolveNode(graph, fromIn), b = resolveNode(graph, toIn);
  if ("ambiguous" in a) return { ambiguous: a.ambiguous, which: "from" };
  if ("notFound" in a) return { error: `graph_path: no node matches 'from'='${fromIn}'.` };
  if ("ambiguous" in b) return { ambiguous: b.ambiguous, which: "to" };
  if ("notFound" in b) return { error: `graph_path: no node matches 'to'='${toIn}'.` };

  const maxDepth = Math.min(Math.max(1, (args.max_depth as number) ?? 6), 12);
  // Undirected BFS ("how are these connected"), recording the traversed edge.
  const undirected = new Map<string, { to: string; edge: GraphEdge; forward: boolean }[]>();
  for (const e of graph.edges) {
    (undirected.get(e.from) ?? undirected.set(e.from, []).get(e.from)!).push({ to: e.to, edge: e, forward: true });
    (undirected.get(e.to) ?? undirected.set(e.to, []).get(e.to)!).push({ to: e.from, edge: e, forward: false });
  }
  const prev = new Map<string, { from: string; edge: GraphEdge; forward: boolean }>();
  const seen = new Set<string>([a.id]);
  let frontier = [a.id]; let depth = 0; let found = false;
  while (frontier.length && depth < maxDepth && !found) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of undirected.get(id) ?? []) {
        if (seen.has(nb.to)) continue;
        seen.add(nb.to); prev.set(nb.to, { from: id, edge: nb.edge, forward: nb.forward });
        if (nb.to === b.id) { found = true; break; }
        next.push(nb.to);
      }
      if (found) break;
    }
    frontier = next; depth++;
  }

  if (!found) return { connected: false, from: nodeBrief(graph, a.id), to: nodeBrief(graph, b.id), note: `No path within depth ${maxDepth}.` };

  const chain: any[] = [];
  let cur = b.id;
  while (cur !== a.id) {
    const step = prev.get(cur)!;
    chain.unshift({ from: nodeBrief(graph, step.from), to: nodeBrief(graph, cur), relation: step.edge.type, provenance: step.edge.provenance, direction: step.forward ? "->" : "<-" });
    cur = step.from;
  }
  return { connected: true, from: nodeBrief(graph, a.id), to: nodeBrief(graph, b.id), hops: chain.length, path: chain };
}

// ---------------------------------------------------------------------------
// graph_impact — transitive dependents (blast radius)
// ---------------------------------------------------------------------------

export async function graphImpact(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = root(args);
  const graph = await loadGraph(r);
  if (!graph) return { error: "graph_impact: no graph found. Run graph_build first." };
  const input = args.node as string;
  if (!input) return { error: "graph_impact: 'node' (id or name) is required." };
  const resolved = resolveNode(graph, input);
  if ("ambiguous" in resolved) return { ambiguous: resolved.ambiguous, note: "Multiple matches; pass a full node id." };
  if ("notFound" in resolved) return { error: `graph_impact: no node matches '${input}'.` };

  const maxDepth = Math.min(Math.max(1, (args.max_depth as number) ?? 3), 6);
  // Reverse reachability over dependency edges (who would be affected if this changes).
  const rev = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (e.type === "contains") continue;
    (rev.get(e.to) ?? rev.set(e.to, []).get(e.to)!).push(e);
  }
  const affected = new Map<string, number>(); // id → shortest depth
  let frontier = [resolved.id];
  const seen = new Set<string>([resolved.id]);
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const e of rev.get(id) ?? []) if (!seen.has(e.from)) {
      seen.add(e.from); affected.set(e.from, d); next.push(e.from);
    }
    frontier = next;
  }

  const affectedIds = [...affected.keys()];
  const affectedFiles = new Set<string>();
  for (const id of affectedIds) { const n = graph.nodes[id]; if (n) affectedFiles.add(n.file); }
  const provenanceMix = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0 } as Record<string, number>;
  for (const e of graph.edges) if (affected.has(e.from) && affected.get(e.from) === 1 && e.to === resolved.id) provenanceMix[e.provenance]++;

  return {
    node: nodeBrief(graph, resolved.id),
    max_depth: maxDepth,
    affected_symbols: affectedIds.length,
    affected_files: affectedFiles.size,
    files: [...affectedFiles].slice(0, 60),
    direct_dependents: affectedIds.filter((id) => affected.get(id) === 1).map((id) => nodeBrief(graph, id)).slice(0, 60),
    note: provenanceMix.AMBIGUOUS > 0
      ? `${provenanceMix.AMBIGUOUS} direct dependent edge(s) are AMBIGUOUS — verify those before assuming impact.`
      : undefined,
    truncated: affectedFiles.size > 60 || affectedIds.length > 60,
  };
}
