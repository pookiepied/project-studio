import type { CodeGraph, GraphEdge, GraphNode } from "./store.js";

/**
 * GRAPH_REPORT.md — the portable, model-agnostic view of the graph. Any LLM in
 * any future conversation can read this file directly (no tools, no server) and
 * understand the codebase's shape: entry hubs, most-connected symbols, and how
 * to ask the graph deeper questions. Kept deterministic and bounded.
 */

function dependents(edges: GraphEdge[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) {
    if (e.type === "imports" || e.type === "calls") m.set(e.to, (m.get(e.to) ?? 0) + 1);
  }
  return m;
}

function topN<T>(arr: T[], n: number): T[] { return arr.slice(0, n); }

export function buildReport(graph: CodeGraph): string {
  const nodes = Object.values(graph.nodes);
  const fileNodes = nodes.filter((n) => n.kind === "file");
  const symbolNodes = nodes.filter((n) => n.kind !== "file");
  const dep = dependents(graph.edges);

  // Hub files: most imported.
  const importCounts = new Map<string, number>();
  for (const e of graph.edges) if (e.type === "imports") importCounts.set(e.to, (importCounts.get(e.to) ?? 0) + 1);
  const hubFiles = topN(
    [...importCounts.entries()].sort((a, b) => b[1] - a[1]),
    12,
  );

  // Most-called symbols.
  const callCounts = new Map<string, number>();
  for (const e of graph.edges) if (e.type === "calls") callCounts.set(e.to, (callCounts.get(e.to) ?? 0) + 1);
  const hotSymbols = topN(
    [...callCounts.entries()].sort((a, b) => b[1] - a[1]).filter(([id]) => graph.nodes[id]?.kind !== "file"),
    15,
  );

  const p = graph.stats.edges_by_provenance;
  const label = (id: string): string => {
    const n: GraphNode | undefined = graph.nodes[id];
    return n ? (n.kind === "file" ? n.name : `${n.name} (${n.file}:${n.start_line})`) : id;
  };

  const lines: string[] = [
    `# Code Graph`,
    ``,
    `> Generated: ${new Date(graph.generated_at).toISOString()}`,
    `> Git HEAD: ${graph.git_head ?? "(not a git repo)"}`,
    `> Languages: ${graph.languages.join(", ") || "none"}`,
    `> ${graph.stats.files} files · ${graph.stats.symbols} symbols · ${graph.stats.edges} edges`,
    ``,
    `## Edge provenance`,
    `Every relationship is tagged by how confidently it was resolved:`,
    ``,
    `- **EXTRACTED** ${p.EXTRACTED} — explicit in the source (import, same-file call, declared heritage). Trust these.`,
    `- **INFERRED** ${p.INFERRED} — resolved by a unique project-wide name match. Usually right; verify before relying.`,
    `- **AMBIGUOUS** ${p.AMBIGUOUS} — the name matched more than one symbol; the edge points at one candidate. Treat as a hint, not fact.`,
    ``,
    `## Hub files (most imported — likely core abstractions)`,
    hubFiles.length ? hubFiles.map(([id, c]) => `- ${label(id)} — imported by ${c}`).join("\n") : "_none_",
    ``,
    `## Hot symbols (most called)`,
    hotSymbols.length ? hotSymbols.map(([id, c]) => `- ${label(id)} — ${c} calls`).join("\n") : "_none_",
    ``,
    `## How to use this graph`,
    `- Read \`graph.json\` (same folder) for the full node/edge structure — it is plain JSON.`,
    `- Node ids are \`path/to/file.ts\` for files and \`path/to/file.ts#Name\` (or \`#Class.method\`) for symbols.`,
    `- For targeted questions without loading the whole graph, use the harness tools:`,
    `  \`graph_neighbors\` (what does X depend on / who depends on X), \`graph_path\` (how are A and B connected),`,
    `  \`graph_impact\` (blast radius of changing X).`,
    `- Before trusting this file, run \`graph_status\`: if HEAD moved or files changed since generation, run \`graph_build\` to refresh.`,
    ``,
    `_Files indexed: ${fileNodes.length}. Symbols: ${symbolNodes.length}._`,
    ``,
  ];
  return lines.join("\n");
}
