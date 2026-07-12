import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// ── Configuration ────────────────────────────────────────────────────────────

const STUDIO_DIR = ".studio";
const GRAPH_FILE = "graph.json";
const REPORT_FILE = "CODEBASE.md";
const DEFAULT_MAX_FILES = 500;

// Directories to skip during scan
const SKIP_DIRS = new Set([
  ".git", ".svn", ".hg",
  "node_modules", "bower_components",
  "dist", "build", ".next", ".nuxt", ".output", "out",
  ".turbo", ".cache", ".parcel-cache",
  "__pycache__", ".pytest_cache", "venv", ".venv",
  "coverage", ".nyc_output",
  STUDIO_DIR, // don't index our own output
]);

// File extensions to index (source code only)
const INDEXABLE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt",
  ".rb", ".php", ".cs", ".swift",
  ".c", ".cpp", ".cc", ".h", ".hpp",
  ".vue", ".svelte", ".astro",
  ".md", ".mdx", ".json", ".yaml", ".yml", ".toml",
  ".sql", ".graphql", ".proto",
]);

// ── Types ────────────────────────────────────────────────────────────────────

interface FileEntry {
  hash: string;
  lines: number;
  imports: string[];   // resolved relative or package paths this file imports
  exports: string[];   // named exports from this file
  sizeBytes: number;
}

interface GraphJson {
  version: number;
  generated_at: string;
  root: string;
  stats: {
    total_files: number;
    changed_files: number;
    scan_duration_ms: number;
  };
  cache: Record<string, FileEntry>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function extractImports(content: string, filePath: string): string[] {
  const imports: string[] = [];
  const dir = path.dirname(filePath);

  // ES module static imports: import ... from '...'
  const esPattern = /^import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = esPattern.exec(content)) !== null) {
    imports.push(m[1]);
  }

  // CommonJS require: require('...')
  const cjsPattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = cjsPattern.exec(content)) !== null) {
    imports.push(m[1]);
  }

  // Python imports: import x / from x import y
  const pyPattern = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
  while ((m = pyPattern.exec(content)) !== null) {
    imports.push(m[1] ?? m[2]);
  }

  // Deduplicate
  return [...new Set(imports)];
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  // Named ES exports
  const pattern =
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?\s+|class\s+|interface\s+|type\s+|enum\s+|const\s+|let\s+|var\s+)(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    exports.push(m[1]);
  }
  // Re-exports: export { A, B } from '...'
  const reExportPattern = /^export\s+\{([^}]+)\}/gm;
  while ((m = reExportPattern.exec(content)) !== null) {
    const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean);
    exports.push(...names);
  }
  return [...new Set(exports)];
}

async function walkDir(
  dir: string,
  maxFiles: number,
  results: string[] = []
): Promise<string[]> {
  if (results.length >= maxFiles) return results;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (results.length >= maxFiles) break;
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name.slice(1))) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, maxFiles, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (INDEXABLE_EXTS.has(ext)) results.push(fullPath);
    }
  }
  return results;
}

// ── Directory tree for CODEBASE.md ──────────────────────────────────────────

function buildDirTree(files: string[], root: string, maxDepth = 3): string {
  const relPaths = files.map((f) => path.relative(root, f));
  const dirs = new Map<string, number>(); // dir → file count
  for (const rel of relPaths) {
    const parts = rel.split(path.sep);
    for (let d = 1; d <= Math.min(parts.length - 1, maxDepth); d++) {
      const dir = parts.slice(0, d).join("/");
      dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
    }
  }
  const topLevel = [...dirs.entries()]
    .filter(([k]) => !k.includes("/"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  return topLevel.map(([dir, count]) => `  ${dir}/  (${count} files)`).join("\n");
}

// ── Main report generator ────────────────────────────────────────────────────

function buildReport(
  root: string,
  graph: GraphJson,
  projectName: string
): string {
  const cache = graph.cache;
  const entries = Object.entries(cache);
  const totalFiles = entries.length;

  // Sort by line count (most complex first)
  const byLines = entries
    .sort((a, b) => b[1].lines - a[1].lines)
    .slice(0, 20);

  // Import frequency: how many files import each file
  const importedBy = new Map<string, number>();
  for (const [, entry] of entries) {
    for (const imp of entry.imports) {
      // Only count relative imports (internal dependencies)
      if (imp.startsWith(".")) {
        importedBy.set(imp, (importedBy.get(imp) ?? 0) + 1);
      }
    }
  }
  const hubFiles = [...importedBy.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Entry point detection
  const entryPatterns = [
    "index.ts", "index.js", "main.ts", "main.js", "app.ts", "app.js",
    "src/index.ts", "src/index.js", "src/main.ts",
  ];
  const entryPoints = entryPatterns
    .filter((e) => cache[path.join(root, e)] || cache[e])
    .slice(0, 5);

  // Detect dominant languages
  const extCounts = new Map<string, number>();
  for (const [filePath] of entries) {
    const ext = path.extname(filePath);
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
  }
  const langs = [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext, count]) => `${ext} (${count})`)
    .join(", ");

  const now = new Date(graph.generated_at).toLocaleString();
  const changed = graph.stats.changed_files;

  const lines: string[] = [
    `# Codebase: ${projectName}`,
    ``,
    `> Generated: ${now} | ${totalFiles} files indexed | ${changed} changed since last run`,
    `> Root: ${root}`,
    ``,
    `## Languages`,
    langs || "unknown",
    ``,
    `## Directory Structure`,
    buildDirTree(entries.map(([f]) => f), root),
    ``,
  ];

  if (entryPoints.length > 0) {
    lines.push(`## Entry Points`, entryPoints.map((e) => `- ${e}`).join("\n"), ``);
  }

  if (byLines.length > 0) {
    lines.push(`## Largest Files (most complex)`);
    for (const [fp, entry] of byLines) {
      const rel = path.relative(root, fp);
      lines.push(`- ${rel}  (${entry.lines} lines, ${entry.exports.length} exports)`);
    }
    lines.push(``);
  }

  if (hubFiles.length > 0) {
    lines.push(`## Most Imported (hub files — likely core abstractions)`);
    for (const [imp, count] of hubFiles) {
      lines.push(`- ${imp}  (imported by ${count} files)`);
    }
    lines.push(``);
  }

  lines.push(
    `## How to Navigate`,
    `Use \`outline_file\` on any file listed above to see its structure without reading the full content.`,
    `Use \`read_file\` with \`offset\` and \`limit\` to read specific line ranges.`,
    `Use \`grep\` with \`type\` filter to find symbols across the codebase.`,
    ``,
    `---`,
    `*Re-run \`index_codebase\` to refresh after significant changes.*`,
  );

  return lines.join("\n");
}

// ── Tool entry point ─────────────────────────────────────────────────────────

export async function indexCodebase(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const timeout = (args.timeout as number) ?? 120_000;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(
        `index_codebase timed out after ${timeout / 1000}s. ` +
        `For large monorepos try timeout: 300000. ` +
        `To index faster, reduce max_files or point root_dir at a subdirectory instead of the whole repo.`
      )),
      timeout
    )
  );

  return Promise.race([_runIndex(args), timeoutPromise]);
}

async function _runIndex(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const rootDir = path.resolve((args.root_dir as string) || process.cwd());
  const force = (args.force as boolean) ?? false;
  const maxFiles = (args.max_files as number) ?? DEFAULT_MAX_FILES;

  const studioPath = path.join(rootDir, STUDIO_DIR);
  const graphPath = path.join(studioPath, GRAPH_FILE);
  const reportPath = path.join(studioPath, REPORT_FILE);

  const startMs = Date.now();

  // Load existing graph for incremental comparison
  let existing: GraphJson | null = null;
  if (!force) {
    try {
      const raw = await fs.readFile(graphPath, "utf-8");
      existing = JSON.parse(raw) as GraphJson;
    } catch {
      // No existing graph — full scan
    }
  }

  const existingCache: Record<string, FileEntry> = existing?.cache ?? {};

  // Walk file tree
  const allFiles = await walkDir(rootDir, maxFiles);
  const truncated = allFiles.length >= maxFiles;

  // Process each file
  const newCache: Record<string, FileEntry> = {};
  let changedCount = 0;

  for (const filePath of allFiles) {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      continue; // skip unreadable files
    }

    const hash = hashContent(content);
    const prev = existingCache[filePath];

    if (prev && prev.hash === hash) {
      // Unchanged — reuse cached entry
      newCache[filePath] = prev;
    } else {
      // New or changed — re-extract
      changedCount++;
      const lineCount = content.split("\n").length;
      newCache[filePath] = {
        hash,
        lines: lineCount,
        imports: extractImports(content, filePath),
        exports: extractExports(content),
        sizeBytes: Buffer.byteLength(content, "utf-8"),
      };
    }
  }

  // Detect project name from package.json
  let projectName = path.basename(rootDir);
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf-8"));
    if (pkg.name) projectName = pkg.name;
  } catch { /* no package.json */ }

  const graph: GraphJson = {
    version: 1,
    generated_at: new Date().toISOString(),
    root: rootDir,
    stats: {
      total_files: allFiles.length,
      changed_files: changedCount,
      scan_duration_ms: Date.now() - startMs,
    },
    cache: newCache,
  };

  // Write outputs
  await fs.mkdir(studioPath, { recursive: true });
  await fs.writeFile(graphPath, JSON.stringify(graph, null, 2), "utf-8");

  const report = buildReport(rootDir, graph, projectName);
  await fs.writeFile(reportPath, report, "utf-8");

  return {
    success: true,
    root: rootDir,
    files_indexed: allFiles.length,
    files_changed: changedCount,
    files_unchanged: allFiles.length - changedCount,
    truncated,
    truncated_note: truncated
      ? `Reached max_files limit (${maxFiles}). Increase max_files or focus on a subdirectory.`
      : undefined,
    duration_ms: Date.now() - startMs,
    output: {
      report: reportPath,
      graph: graphPath,
    },
    next_step:
      `Read ${path.relative(rootDir, reportPath)} for a structured overview. ` +
      `Use outline_file on specific files, then read_file with targeted ranges.`,
  };
}
