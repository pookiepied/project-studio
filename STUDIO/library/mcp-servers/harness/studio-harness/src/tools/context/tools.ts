import { promises as fs } from "fs";
import path from "path";
import {
  buildIndex,
  loadIndex,
  queryVector,
  cosine,
  type Chunk,
  type ContextIndex,
} from "./store.js";
async function ready(root: string) {
  return (await loadIndex(root)) || buildIndex(root);
}
function result(c: Chunk, score: number, index: ContextIndex, reason: string) {
  return {
    chunk_id: c.id,
    path: path.resolve(index.root, c.path),
    start_line: c.start_line,
    end_line: c.end_line,
    symbol: c.symbol,
    score: Number(score.toFixed(4)),
    reason,
    snippet: c.snippet,
    content_hash: c.content_hash,
    language: c.language,
    is_test: c.is_test,
    generated: c.generated,
    index_backend: index.embedding.backend,
    index_updated_at: index.updated_at,
  };
}
async function ranked(
  args: Record<string, unknown>,
  kind?: "code" | "document",
) {
  const query = args.query as string;
  if (!query) return { error: "query is required" };
  const root = (args.root_dir as string) || process.cwd(),
    index = await ready(root),
    vector = await queryVector(query, index),
    terms = query.toLowerCase().split(/\W+/).filter(Boolean),
    includeTests = (args.include_tests as boolean) ?? true;
  let candidates = index.chunks.filter(
    (c) =>
      (!kind || c.kind === kind) &&
      (includeTests || !c.is_test) &&
      ((args.include_generated as boolean) || !c.generated),
  );
  const scored = candidates
    .map((c) => {
      const semantic = cosine(vector, c.vector),
        lexical =
          terms.filter((t) =>
            `${c.symbol || ""} ${c.snippet}`.toLowerCase().includes(t),
          ).length / Math.max(terms.length, 1),
        score = semantic * 0.75 + lexical * 0.25;
      return { c, score, semantic, lexical };
    })
    .filter((x) => x.score >= ((args.min_score as number) || 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min((args.max_results as number) || 10, 100));
  return {
    query,
    results: scored.map((x) =>
      result(
        x.c,
        x.score,
        index,
        `Selected by ${index.embedding.backend} similarity (${x.semantic.toFixed(3)}) and lexical overlap (${x.lexical.toFixed(3)}).`,
      ),
    ),
    index: {
      backend: index.embedding.backend,
      model: index.embedding.model,
      updated_at: index.updated_at,
      git_revision: index.git_revision,
    },
    warning:
      index.embedding.backend === "local_fallback"
        ? "No embedding endpoint configured; semantic ranking uses a local hashed-token approximation."
        : undefined,
  };
}
export const semanticCodeSearch = (a: Record<string, unknown>) =>
  ranked(a, "code");
export const semanticDocumentSearch = (a: Record<string, unknown>) =>
  ranked(a, "document");
export async function findSimilarImplementation(args: Record<string, unknown>) {
  const root = (args.root_dir as string) || process.cwd();
  let query = args.code as string | undefined;
  if (!query && args.path) {
    const text = await fs.readFile(args.path as string, "utf8"),
      lines = text.split(/\r?\n/),
      s = (args.start_line as number) || 1,
      e = (args.end_line as number) || Math.min(lines.length, s + 120);
    query = lines.slice(s - 1, e).join("\n");
  }
  if (!query) return { error: "code or path is required" };
  const found: any = await ranked({ ...args, query }, "code");
  if (found.results && args.path)
    found.results = found.results.filter(
      (x: any) => path.resolve(x.path) !== path.resolve(args.path as string),
    );
  return found;
}
export async function findFeatureImplementation(args: Record<string, unknown>) {
  const feature = args.feature as string;
  if (!feature) return { error: "feature is required" };
  const found: any = await ranked({
    ...args,
    query: feature,
    max_results: (args.max_results as number) || 30,
  });
  if (found.error) return found;
  const groups: any = {
    implementation: [],
    tests: [],
    configuration: [],
    documentation: [],
  };
  for (const x of found.results) {
    if (x.is_test) groups.tests.push(x);
    else if (/\.(json|ya?ml|toml|ini)$/.test(x.path))
      groups.configuration.push(x);
    else if (/\.(md|mdx|txt|rst)$/.test(x.path)) groups.documentation.push(x);
    else groups.implementation.push(x);
  }
  return {
    feature,
    components: groups,
    confidence: found.results[0]?.score || 0,
    index: found.index,
    warning: found.warning,
  };
}
export async function retrieveContextBundle(args: Record<string, unknown>) {
  const task = args.task as string;
  if (!task) return { error: "task is required" };
  const found: any = await ranked({
    ...args,
    query: task,
    max_results: Math.min((args.max_items as number) || 30, 100),
  });
  if (found.error) return found;
  let budget = Math.min((args.token_budget as number) || 8000, 100000),
    used = 0;
  const items = [];
  const selectedFiles = new Set<string>();
  const maxFiles = (args.max_files as number) || 20;
  for (const x of found.results) {
    const tokens = Math.ceil(x.snippet.length / 4);
    if (used + tokens > budget) continue;
    if (!selectedFiles.has(x.path) && selectedFiles.size >= maxFiles) continue;
    items.push({ ...x, estimated_tokens: tokens });
    selectedFiles.add(x.path);
    used += tokens;
  }
  return {
    task,
    items,
    estimated_tokens: used,
    token_budget: budget,
    truncated: items.length < found.results.length,
    index: found.index,
    warning: found.warning,
  };
}
export async function explainRetrieval(args: Record<string, unknown>) {
  const root = (args.root_dir as string) || process.cwd(),
    index = await ready(root),
    id = args.chunk_id as string,
    query = args.query as string;
  if (!id || !query) return { error: "chunk_id and query are required" };
  const chunk = index.chunks.find((c) => c.id === id);
  if (!chunk) return { error: "chunk_id not found in index" };
  const v = await queryVector(query, index),
    semantic = cosine(v, chunk.vector);
  return {
    chunk_id: id,
    path: chunk.path,
    range: [chunk.start_line, chunk.end_line],
    signals: {
      semantic_similarity: semantic,
      symbol: chunk.symbol,
      module: chunk.module,
      is_test: chunk.is_test,
      generated: chunk.generated,
      imports: chunk.imports,
    },
    backend: index.embedding,
  };
}
export async function indexStatus(args: Record<string, unknown>) {
  const root = (args.root_dir as string) || process.cwd(),
    index = await loadIndex(root);
  if (!index)
    return {
      state: "missing",
      root,
      suggestion: "Call reindex_paths with paths ['**/*']",
    };
  let current: string | undefined;
  try {
    const { execFile } = await import("child_process");
    current = await new Promise((r) =>
      execFile("git", ["rev-parse", "HEAD"], { cwd: root }, (_, o) =>
        r(o?.trim() || undefined),
      ),
    );
  } catch {}
  return {
    state: current && index.git_revision !== current ? "stale" : "ready",
    root,
    version: index.version,
    files: Object.keys(index.files).length,
    chunks: index.chunks.length,
    code_chunks: index.chunks.filter((c) => c.kind === "code").length,
    document_chunks: index.chunks.filter((c) => c.kind === "document").length,
    failures: index.failures,
    coverage: { indexed_files: Object.keys(index.files).length, failed_files: index.failures.filter((x) => x.path !== "<embedding>").length },
    partitions: { metadata: "ready", symbols: "ready", imports: "ready", semantic: "ready", documents: "ready" },
    embedding: index.embedding,
    indexed_revision: index.git_revision,
    current_revision: current,
    created_at: index.created_at,
    updated_at: index.updated_at,
  };
}
export async function reindexPaths(args: Record<string, unknown>) {
  const root = (args.root_dir as string) || process.cwd(),
    paths = (args.paths as string[]) || ["**/*"],
    index = await buildIndex(
      root,
      paths,
      Math.min((args.max_files as number) || 2000, 10000),
    );
  return {
    success: true,
    root,
    paths,
    files: Object.keys(index.files).length,
    chunks: index.chunks.length,
    failures: index.failures,
    embedding: index.embedding,
    updated_at: index.updated_at,
  };
}
