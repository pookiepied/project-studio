/**
 * Composite coding workflow tools.
 *
 * Each tool chains multiple local operations (index, grep, outline, read, lsp)
 * into a single call. The LLM pays one round-trip and gets a rich structured
 * result instead of orchestrating 4-8 separate tool calls.
 *
 * These run entirely on local project files with no network or subprocess use.
 */

import { promises as fs } from "fs";
import path from "path";
import { indexCodebase } from "./index_codebase.js";
import { outlineFile } from "./outline.js";
import { readFile } from "../filesystem/read.js";
import { grepFiles } from "../filesystem/grep.js";
import { runLsp } from "../lsp/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function ensureCodebaseIndex(rootDir: string): Promise<{
  fresh: boolean;
  reportPath: string;
  existed: boolean;
}> {
  const reportPath = path.join(rootDir, ".studio", "CODEBASE.md");
  let existed = false;
  try {
    await fs.stat(reportPath);
    existed = true;
  } catch {
    await indexCodebase({ root_dir: rootDir });
  }
  return { fresh: !existed, reportPath, existed };
}

// ── explore_codebase ─────────────────────────────────────────────────────────

/**
 * Full project orientation in one call.
 *
 * 1. Ensures .studio/CODEBASE.md exists (builds it if missing).
 * 2. Returns the full codebase map.
 * 3. Optionally outlines 2-3 hub/entry-point files for immediate structure.
 *
 * Use at the start of any coding session on an unfamiliar project.
 */
export async function exploreCodebase(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const rootDir = path.resolve((args.root_dir as string) || process.cwd());
  const includeOutlines = (args.include_outlines as boolean) ?? true;

  const { fresh, reportPath, existed } = await ensureCodebaseIndex(rootDir);

  const reportContent = await readTextFile(reportPath);
  if (!reportContent) {
    return {
      error:
        "Failed to build or read codebase index. Check directory permissions.",
    };
  }

  const result: Record<string, unknown> = {
    root: rootDir,
    index_built: fresh,
    index_existed: existed,
    codebase_map: reportContent,
  };

  // Extract entry point files from the report and outline them
  if (includeOutlines) {
    const entrySection =
      reportContent.match(/## Entry Points\n([\s\S]*?)(?=\n##|$)/)?.[1] ?? "";
    const entryFiles = entrySection
      .split("\n")
      .map((l) => l.replace(/^- /, "").trim())
      .filter(Boolean)
      .slice(0, 3);

    const outlines: Record<string, unknown> = {};
    await Promise.all(
      entryFiles.map(async (rel) => {
        const abs = path.join(rootDir, rel);
        try {
          await fs.stat(abs);
          const outline = (await outlineFile({ file_path: abs })) as Record<
            string,
            unknown
          >;
          outlines[rel] = outline;
        } catch {
          // file not found — skip
        }
      }),
    );

    if (Object.keys(outlines).length > 0) {
      result.entry_point_outlines = outlines;
    }
  }

  result.next_steps =
    "Read codebase_map for orientation. Use search_symbol to find specific functions. " +
    "Use analyze_file for a deep dive into any file. " +
    "Use index_codebase(force: true) to refresh if the project changed significantly.";

  return result;
}

// ── search_symbol ─────────────────────────────────────────────────────────────

/**
 * Find a symbol (function, class, type, variable) across the codebase.
 *
 * Strategy (in priority order):
 *   1. LSP workspaceSymbol — most accurate when language server is running.
 *   2. grep for exact name in declaration context (export/function/class/def).
 *   3. grep for the name anywhere — broadest fallback.
 *
 * For each match, returns the file, line, a surrounding code snippet, and
 * the file's structural outline so the LLM knows context without reading more.
 */
export async function searchSymbol(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const symbol = args.symbol as string;
  const rootDir = path.resolve((args.root_dir as string) || process.cwd());
  const fileType = args.type as string | undefined;
  const maxResults = (args.max_results as number) ?? 5;

  if (!symbol) return { error: "symbol is required" };

  type Match = {
    file: string;
    line: number | null;
    snippet: string;
    outline?: unknown;
  };
  const matches: Match[] = [];

  // ── Strategy 1: LSP workspaceSymbol ──────────────────────────────────────
  const lspResult = (await runLsp({
    operation: "workspaceSymbol",
    query: symbol,
    workspaceRoot: rootDir,
  })) as Record<string, unknown>;

  if (!lspResult.error && lspResult) {
    for (const item of ((lspResult.symbols as any[]) ?? []).slice(
      0,
      maxResults,
    )) {
      const filePath = item.path as string;
      const lineNum = item.start_line as number;
      const snippet = (await readFile({
        path: filePath,
        start_line: Math.max(1, lineNum - 2),
        end_line: lineNum + 5,
      })) as Record<string, unknown>;
      matches.push({
        file: path.relative(rootDir, filePath),
        line: lineNum,
        snippet: (snippet.content as string) ?? "",
      });
    }
    const lspText =
      typeof lspResult === "string" ? lspResult : JSON.stringify(lspResult);
    // LSP found something — parse file:line pairs from the formatted output
    const locPattern = /([^\s:]+\.[a-z]+):(\d+)/g;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while (
      (m = locPattern.exec(lspText)) !== null &&
      matches.length < maxResults
    ) {
      const key = `${m[1]}:${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const filePath = path.isAbsolute(m[1]) ? m[1] : path.join(rootDir, m[1]);
      const lineNum = parseInt(m[2], 10);
      const snippet = (await readFile({
        path: filePath,
        offset: Math.max(0, lineNum - 3),
        limit: 8,
      })) as Record<string, unknown>;
      matches.push({
        file: path.relative(rootDir, filePath),
        line: lineNum,
        snippet: (snippet.content as string) ?? "",
      });
    }
  }

  // Whether the LSP strategy actually produced matches (not just ran without
  // error). Used for honest strategy_used reporting below.
  const lspMatched = matches.length > 0;

  // ── Strategy 2: grep for declarations ────────────────────────────────────
  if (matches.length === 0) {
    const declPattern = `(export\\s+)?(async\\s+)?(function|class|interface|type|enum|def|fn)\\s+${symbol}\\b`;
    const grepResult = (await grepFiles({
      pattern: declPattern,
      path: rootDir,
      output_mode: "content",
      ...(fileType ? { type: fileType } : {}),
      "-A": 3,
      head_limit: maxResults,
    })) as Record<string, unknown>;

    const grepText = (grepResult.matches as string) ?? "";
    if (grepText) {
      // Parse "filepath:linenum:content" lines
      const fileGroups = grepText.split(/\n--\n/).filter(Boolean);
      for (const group of fileGroups.slice(0, maxResults)) {
        const firstLine = group.split("\n")[0];
        const colonParts = firstLine.split(":");
        if (colonParts.length >= 3) {
          const filePath = colonParts[0];
          const lineNum = parseInt(colonParts[1], 10);
          matches.push({
            file: path.relative(rootDir, filePath),
            line: isNaN(lineNum) ? null : lineNum,
            snippet: group,
          });
        }
      }
    }
  }

  // ── Strategy 3: broad grep fallback ──────────────────────────────────────
  if (matches.length === 0) {
    const grepResult = (await grepFiles({
      pattern: `\\b${symbol}\\b`,
      path: rootDir,
      output_mode: "files_with_matches",
      ...(fileType ? { type: fileType } : {}),
      head_limit: maxResults,
    })) as Record<string, unknown>;

    const files = ((grepResult.matches as string) ?? "")
      .split("\n")
      .filter(Boolean)
      .slice(0, maxResults);

    for (const filePath of files) {
      matches.push({
        file: path.relative(rootDir, filePath),
        line: null,
        snippet: `"${symbol}" appears in this file. Use grep with output_mode: "content" for exact lines.`,
      });
    }
  }

  if (matches.length === 0) {
    return {
      symbol,
      found: false,
      message: `No matches found for "${symbol}". Check spelling or try a broader search with grep.`,
    };
  }

  // Add outline for the first (most likely) match file
  const firstMatch = matches[0];
  if (firstMatch) {
    const absPath = path.join(rootDir, firstMatch.file);
    try {
      const outline = await outlineFile({ file_path: absPath });
      firstMatch.outline = outline;
    } catch {
      /* ignore */
    }
  }

  return {
    symbol,
    found: true,
    strategy_used: lspMatched ? "lsp" : "grep",
    matches,
    total_matches: matches.length,
    note:
      matches.length === maxResults
        ? `Showing first ${maxResults} matches. Increase max_results or narrow with type filter.`
        : undefined,
  };
}

// ── analyze_file ─────────────────────────────────────────────────────────────

/**
 * Deep-dive analysis of a single file in one call.
 *
 * Returns:
 *   - Structural outline (functions, classes, exports + line numbers)
 *   - First 40 lines (imports, module docstring, top-level setup)
 *   - Files that import THIS file (reverse dependency lookup via grep)
 *   - File stats (total lines, size)
 *
 * After calling this, the LLM knows: what's in the file, how it's structured,
 * what it depends on, and who depends on it — without reading the whole thing.
 */
export async function analyzeFile(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const filePath = path.resolve(args.file_path as string);
  const rootDir = path.resolve(
    (args.root_dir as string) || path.dirname(filePath),
  );

  if (!args.file_path) return { error: "file_path is required" };

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { error: `File not found: ${filePath}` };
  }

  // Run outline + header read in parallel
  const [outlineResult, headerResult] = (await Promise.all([
    outlineFile({ file_path: filePath, workspace_root: rootDir }),
    readFile({ path: filePath, offset: 0, limit: 40 }),
  ])) as [Record<string, unknown>, Record<string, unknown>];

  // Find who imports this file
  const relPath = path.relative(rootDir, filePath);
  const baseNoExt = relPath.replace(/\.[^.]+$/, "");
  // Search for the file's relative path in import statements
  const importPattern = `['"].*${baseNoExt.replace(/\\/g, "/")}['"]`;

  const grepResult = (await grepFiles({
    pattern: importPattern,
    path: rootDir,
    output_mode: "files_with_matches",
    head_limit: 20,
  })) as Record<string, unknown>;

  const importedBy = ((grepResult.matches as string) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((f) => path.relative(rootDir, f))
    .filter((f) => f !== relPath); // exclude self-reference

  return {
    file: relPath,
    absolute_path: filePath,
    size_bytes: stat.size,
    structure: outlineResult,
    header: headerResult.content ?? headerResult,
    imported_by: importedBy,
    imported_by_count: importedBy.length,
    note:
      `Structure shows all declarations with line numbers. ` +
      `Use read_file(path, offset, limit) to read any specific section. ` +
      `${importedBy.length > 0 ? `This file is imported by ${importedBy.length} other file(s).` : "No other files import this file (entry point or unused)."}`,
  };
}
