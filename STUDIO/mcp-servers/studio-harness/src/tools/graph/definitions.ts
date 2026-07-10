/**
 * Tool schema definitions for the code-graph domain.
 *
 * The graph is generated once into portable, committable files under
 * `.studio/graph/` (graph.json + GRAPH_REPORT.md). Everyday reading is a plain
 * file read that any model can do; these tools are for *generating*, *checking
 * freshness of*, and running *targeted traversals* over that graph.
 */
export const GRAPH_DEFINITIONS = [
  {
    name: "graph_build",
    description:
      "Build (or refresh) the code-relationship graph for a project and write it to .studio/graph/ as portable files: " +
      "graph.json (full node/edge structure), GRAPH_REPORT.md (readable overview any model can consume directly), and manifest.json (freshness tracking). " +
      "Deterministic Tree-sitter analysis — no LLM, nothing leaves the machine. Nodes are files and symbols (functions, classes, interfaces, types, methods); " +
      "edges are contains/imports/calls/extends/implements, each tagged EXTRACTED (explicit in source), INFERRED (unique name match), or AMBIGUOUS (multiple matches). " +
      "Phase 1 covers TypeScript/JavaScript (.ts/.tsx/.js/.jsx). Run once to orient, then re-run when graph_status reports the graph is stale. " +
      "Commit graph.json and GRAPH_REPORT.md so the map travels with the repo.",
    inputSchema: {
      type: "object",
      properties: {
        root_dir:  { type: "string", description: "Project root to index (optional, defaults to the harness cwd)." },
        max_files: { type: "number", description: "Maximum source files to index (default 1500). Raise for large repos." },
      },
      required: [],
    },
  },
  {
    name: "graph_status",
    description:
      "Report whether the code graph is up to date with the working tree — the freshness gate to run at the start of a task before trusting the graph or GRAPH_REPORT.md. " +
      "Compares the recorded git HEAD against the current one and re-hashes every indexed file (content hash is the only fully trusted staleness signal — timestamps and git state can lie). " +
      "Returns fresh | stale | missing, plus which files changed, were added, or were removed. If stale, run graph_build before relying on relationships.",
    inputSchema: {
      type: "object",
      properties: {
        root_dir: { type: "string", description: "Project root (optional, defaults to the harness cwd)." },
      },
      required: [],
    },
  },
  {
    name: "graph_neighbors",
    description:
      "Return the direct (or depth-bounded) neighbors of a node in the code graph: what it depends on (dependencies) and/or what depends on it (dependents). " +
      "Use this instead of grepping for a symbol's usages — it follows resolved import/call/inheritance edges, not text matches. " +
      "Accepts a node id (path/to/file.ts or path/to/file.ts#Name) or a bare symbol/file name; ambiguous names return candidates. Read graph provenance to know how much to trust each edge.",
    inputSchema: {
      type: "object",
      properties: {
        node:       { type: "string", description: "Node id (e.g. 'src/a.ts#Foo') or a bare symbol/file name." },
        direction:  { type: "string", enum: ["dependencies", "dependents", "both"], description: "Which way to traverse (default 'both')." },
        depth:      { type: "number", description: "Traversal depth, 1-3 (default 1)." },
        edge_types: { type: "array", items: { type: "string", enum: ["contains", "imports", "calls", "extends", "implements"] }, description: "Restrict to these edge types (optional)." },
        root_dir:   { type: "string", description: "Project root (optional, defaults to the harness cwd)." },
      },
      required: ["node"],
    },
  },
  {
    name: "graph_path",
    description:
      "Find how two entities are connected in the code graph — the shortest relationship chain between them (undirected: follows edges in either direction). " +
      "Answers questions like 'how does this route reach that storage function' or 'is this component linked to that service at all'. " +
      "Accepts node ids or bare names for both endpoints.",
    inputSchema: {
      type: "object",
      properties: {
        from:      { type: "string", description: "Start node id or name." },
        to:        { type: "string", description: "End node id or name." },
        max_depth: { type: "number", description: "Maximum hops to search, 1-12 (default 6)." },
        root_dir:  { type: "string", description: "Project root (optional, defaults to the harness cwd)." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "graph_impact",
    description:
      "Estimate the blast radius of changing a node: the symbols and files that transitively depend on it (reverse reachability over import/call/inheritance edges). " +
      "Use before editing a shared function or type to see what could be affected and where to focus testing. " +
      "Flags when direct dependents were resolved via AMBIGUOUS edges so you don't over-trust the estimate.",
    inputSchema: {
      type: "object",
      properties: {
        node:      { type: "string", description: "Node id or name whose change impact you want." },
        max_depth: { type: "number", description: "How many dependency hops to follow, 1-6 (default 3)." },
        root_dir:  { type: "string", description: "Project root (optional, defaults to the harness cwd)." },
      },
      required: ["node"],
    },
  },
] as const;
