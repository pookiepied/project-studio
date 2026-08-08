import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import {
  parsePath,
  parseText,
  compact,
  nodeResult,
  walk,
  queryTree,
  definitionTypes,
  definitionName,
  structuralSignature,
} from "./runtime.js";
import { getFileRevision, staleResult } from "../filesystem/revision.js";
export async function syntaxDefinitions(filePath: string) {
  const p = await parsePath(filePath),
    definitions: any[] = [];
  walk(p.tree.rootNode, (node, depth) => {
    if (!definitionTypes.has(node.type)) return;
    definitions.push({
      name: definitionName(node, p.text),
      node_type: node.type,
      depth,
      ...nodeResult(node, p.text, false),
    });
  });
  return {
    path: p.path,
    language: p.language,
    method: "tree_sitter",
    definitions,
    total: definitions.length,
    content_hash: p.hash,
  };
}
export async function parseFile(args: Record<string, unknown>) {
  const p = await parsePath(args.path as string),
    maxDepth = Math.min((args.max_depth as number) || 6, 30),
    maxNodes = Math.min((args.max_nodes as number) || 1000, 10000);
  let root = p.tree.rootNode;
  if (args.start_line) {
    root = root.namedDescendantForPosition(
      { row: (args.start_line as number) - 1, column: 0 },
      {
        row: ((args.end_line as number) || (args.start_line as number)) - 1,
        column: 999999,
      },
    );
  }
  return {
    path: p.path,
    language: p.language,
    content_hash: p.hash,
    ...compact(
      root,
      p.text,
      maxDepth,
      maxNodes,
      args.include_text as boolean,
      (args.named_nodes_only as boolean) ?? true,
    ),
  };
}
export async function querySyntaxTree(args: Record<string, unknown>) {
  const source = args.query as string;
  if (!source) return { error: "query is required" };
  const p = await parsePath(args.path as string),
    max = Math.min((args.max_results as number) || 250, 5000);
  const captures = queryTree(p.grammar, p.tree.rootNode, source, max).map(
    (c: any) => ({
      capture: c.name,
      ...nodeResult(c.node, p.text, (args.include_text as boolean) ?? true),
    }),
  );
  return {
    path: p.path,
    language: p.language,
    captures,
    total: captures.length,
    truncated: captures.length >= max,
    content_hash: p.hash,
  };
}
export async function extractSymbolBody(args: Record<string, unknown>) {
  const symbol = args.symbol as string;
  if (!symbol) return { error: "symbol is required" };
  const p = await parsePath(args.path as string),
    found: any[] = [];
  walk(p.tree.rootNode, (n) => {
    if (definitionTypes.has(n.type) && definitionName(n, p.text) === symbol)
      found.push(n);
  });
  if (found.length !== 1)
    return {
      error: found.length ? "ambiguous_symbol" : "symbol_not_found",
      candidates: found.map((n) => nodeResult(n, p.text, false)),
    };
  const n = found[0];
  return {
    path: p.path,
    symbol,
    node_type: n.type,
    ...nodeResult(n, p.text, true),
    content_hash: p.hash,
    revision: await getFileRevision(p.path),
  };
}
export async function detectSyntaxErrors(args: Record<string, unknown>) {
  const p = await parsePath(args.path as string),
    errors: any[] = [];
  walk(p.tree.rootNode, (n) => {
    if (n.type === "ERROR" || n.isMissing())
      errors.push({
        ...nodeResult(n, p.text, true),
        kind: n.isMissing() ? "missing_node" : "error_node",
      });
  });
  const max = Math.min((args.max_results as number) || 200, 2000);
  return {
    path: p.path,
    language: p.language,
    valid: errors.length === 0,
    errors: errors.slice(0, max),
    total: errors.length,
    truncated: errors.length > max,
    content_hash: p.hash,
  };
}
export async function calculateComplexity(args: Record<string, unknown>) {
  const p = await parsePath(args.path as string),
    items: any[] = [];
  walk(p.tree.rootNode, (n) => {
    if (!definitionTypes.has(n.type) || !/function|method/.test(n.type)) return;
    let complexity = 1,
      maxNesting = 0,
      branches = 0;
    const branchTypes = new Set([
      "if_statement",
      "for_statement",
      "for_in_statement",
      "while_statement",
      "do_statement",
      "switch_case",
      "case_clause",
      "catch_clause",
      "conditional_expression",
      "match_expression",
      "match_arm",
    ]);
    const visit = (node: any, nesting: number) => {
      const branch = branchTypes.has(node.type);
      const next = branch ? nesting + 1 : nesting;
      if (branch) {
        complexity++;
        branches++;
        maxNesting = Math.max(maxNesting, next);
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) visit(child, next);
      }
    };
    visit(n, 0);
    items.push({
      symbol: definitionName(n, p.text),
      node_type: n.type,
      start_line: n.startPosition.row + 1,
      end_line: n.endPosition.row + 1,
      lines: n.endPosition.row - n.startPosition.row + 1,
      cyclomatic_complexity: complexity,
      max_nesting: maxNesting,
      branch_nodes: branches,
    });
  });
  return {
    path: p.path,
    language: p.language,
    symbols: items,
    summary: {
      symbols: items.length,
      max_complexity: Math.max(0, ...items.map((x) => x.cyclomatic_complexity)),
      average_complexity: items.length
        ? items.reduce((s, x) => s + x.cyclomatic_complexity, 0) / items.length
        : 0,
    },
    formula:
      "Cyclomatic approximation: 1 + Tree-sitter branch/loop/catch/match nodes.",
  };
}
function firstPatternNode(root: any) {
  return (
    root.namedChildren?.find((x: any) => x.type !== "ERROR") ??
    root.namedChild(0) ??
    root
  );
}
export async function findStructuralPattern(args: Record<string, unknown>) {
  const pattern = args.pattern as string;
  if (!pattern) return { error: "pattern is required" };
  const target = await parsePath(args.path as string);
  const parsed = await parseText(target.language, pattern);
  const patternNode = firstPatternNode(parsed.tree.rootNode);
  const signature = structuralSignature(patternNode);
  const matches: any[] = [];
  walk(target.tree.rootNode, (n) => {
    if (
      n.isNamed() &&
      n.type === patternNode.type &&
      structuralSignature(n) === signature
    )
      matches.push({ ...nodeResult(n, target.text, true), signature });
  });
  const max = Math.min((args.max_results as number) || 100, 1000);
  return {
    path: target.path,
    matches: matches.slice(0, max),
    total: matches.length,
    truncated: matches.length > max,
    pattern_signature: signature,
    content_hash: target.hash,
  };
}
export async function structuralReplace(args: Record<string, unknown>) {
  const found: any = await findStructuralPattern(args);
  if (found.error) return found;
  const replacement = args.replacement as string;
  if (replacement === undefined) return { error: "replacement is required" };
  const edits = (found.matches as any[]).map((m) => ({
    start_line: m.start_line,
    start_character: m.start_character,
    end_line: m.end_line,
    end_character: m.end_character,
    old_text: m.text,
    new_text: replacement,
  }));
  const preview = {
    path: found.path,
    matches: found.total,
    edits,
    applied: false,
  };
  if (!args.apply) return preview;
  if (!args.expected_revision)
    return {
      error: "expected_revision is required when apply is true",
      ...preview,
    };
  const current = await getFileRevision(found.path),
    stale = staleResult(args.expected_revision, current);
  if (stale) return { ...stale, path: found.path };
  let text = await fs.readFile(found.path, "utf8");
  const lines = text.split(/(?<=\n)/),
    offset = (l: number, c: number) =>
      lines.slice(0, l - 1).join("").length +
      (lines[l - 1]?.slice(0, c - 1).length || 0);
  for (const e of [...edits].sort(
    (a, b) =>
      offset(b.start_line, b.start_character) -
      offset(a.start_line, a.start_character),
  )) {
    const a = offset(e.start_line, e.start_character),
      b = offset(e.end_line, e.end_character);
    text = text.slice(0, a) + replacement + text.slice(b);
  }
  const before = await fs.readFile(found.path, "utf8");
  await fs.writeFile(found.path, text, "utf8");
  const syntax: any = await detectSyntaxErrors({ path: found.path });
  if (!syntax.valid) {
    await fs.writeFile(found.path, before, "utf8");
    return {
      error: "replacement_introduced_syntax_errors",
      syntax_errors: syntax.errors,
      rolled_back: true,
    };
  }
  return {
    ...preview,
    applied: true,
    revision: await getFileRevision(found.path),
  };
}
const SOURCE_GLOB = "**/*.{ts,tsx,js,jsx,py,go,rs,java,kt,rb,cs,c,cpp,h,hpp}";
export async function findDuplicateStructure(args: Record<string, unknown>) {
  const root = (args.root_dir as string) || process.cwd(),
    files = await glob((args.glob as string) || SOURCE_GLOB, {
      cwd: root,
      absolute: true,
      nodir: true,
      ignore: [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/vendor/**",
      ],
    }),
    groups = new Map<string, any[]>();
  for (const file of files.slice(
    0,
    Math.min((args.max_files as number) || 500, 2000),
  )) {
    try {
      const p = await parsePath(file);
      walk(p.tree.rootNode, (n) => {
        if (definitionTypes.has(n.type) && /function|method/.test(n.type)) {
          const sig = structuralSignature(n),
            a = groups.get(sig) || [];
          a.push({
            path: p.path,
            symbol: definitionName(n, p.text),
            start_line: n.startPosition.row + 1,
            end_line: n.endPosition.row + 1,
          });
          groups.set(sig, a);
        }
      });
    } catch {}
  }
  const duplicates = [...groups.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([signature, implementations]) => ({
      signature_hash: Buffer.from(signature).toString("base64url").slice(0, 24),
      implementations,
    }))
    .slice(0, Math.min((args.max_groups as number) || 50, 500));
  return { root, groups: duplicates, total: duplicates.length };
}
export async function findDeadExports(args: Record<string, unknown>) {
  const root = (args.root_dir as string) || process.cwd(),
    files = await glob((args.glob as string) || "**/*.{ts,tsx,js,jsx}", {
      cwd: root,
      absolute: true,
      nodir: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    }),
    exports: any[] = [],
    identifierCounts = new Map<string, number>();
  for (const file of files.slice(
    0,
    Math.min((args.max_files as number) || 500, 2000),
  )) {
    const text = await fs.readFile(file, "utf8");
    for (const token of text.match(/[A-Za-z_$][\w$]*/g) ?? [])
      identifierCounts.set(token, (identifierCounts.get(token) ?? 0) + 1);
    try {
      const parsed = await parsePath(file);
      walk(parsed.tree.rootNode, (node) => {
        if (!definitionTypes.has(node.type) || node.parent?.type !== "export_statement") return;
        const symbol = definitionName(node, parsed.text);
        if (symbol) exports.push({ path: file, symbol, line: node.startPosition.row + 1, node_type: node.type });
      });
    } catch {
      // Unsupported grammar or parse failure: the file contributes references but no export candidates.
    }
  }
  const candidates = [];
  for (const item of exports) {
    if ((identifierCounts.get(item.symbol) ?? 0) <= 1)
      candidates.push({
        ...item,
        confidence: 0.65,
        reasons: ["No additional lexical identifier occurrence found"],
        possible_dynamic_usage: true,
      });
  }
  return {
    root,
    candidates,
    total_exports: exports.length,
    candidate_count: candidates.length,
    note: "Candidates are conservative hints, not deletion proof; dynamic imports, reflection, package entry points, and external consumers may be invisible.",
  };
}
