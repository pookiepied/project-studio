import Parser from "web-tree-sitter";
type Language = Parser.Language;
type SyntaxNode = Parser.SyntaxNode;
type Tree = Parser.Tree;
import { createRequire } from "module";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
const require = createRequire(import.meta.url);
const LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".cs": "c_sharp",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".php": "php",
  ".swift": "swift",
  ".sh": "bash",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".html": "html",
  ".css": "css",
};
let initialized = false;
// Bound the parse cache: each entry holds a tree-sitter Tree backed by WASM
// memory that is NOT reclaimed by GC — it must be .delete()d explicitly.
const CACHE_MAX = 100;
const languages = new Map<string, Language>(),
  parsers = new Map<string, Parser>(),
  cache = new Map<
    string,
    {
      hash: string;
      tree: Tree;
      text: string;
      language: string;
      grammar: Language;
    }
  >();
async function init() {
  if (initialized) return;
  await Parser.init({
    locateFile: () => require.resolve("web-tree-sitter/tree-sitter.wasm"),
  });
  initialized = true;
}
export async function parsePath(file: string) {
  await init();
  const full = path.resolve(file),
    language = LANG[path.extname(full).toLowerCase()];
  if (!language)
    throw new Error(
      `No Tree-sitter grammar for ${path.extname(full) || "this file"}`,
    );
  const text = await fs.readFile(full, "utf8"),
    hash = crypto.createHash("sha256").update(text).digest("hex"),
    prior = cache.get(full);
  if (prior?.hash === hash) return { ...prior, path: full };
  // Content changed for this path — free the stale tree before replacing it.
  if (prior) { try { prior.tree.delete(); } catch { /* already freed */ } }
  let grammar = languages.get(language);
  if (!grammar) {
    grammar = await Parser.Language.load(
      require.resolve(`tree-sitter-wasms/out/tree-sitter-${language}.wasm`),
    );
    languages.set(language, grammar);
  }
  let parser = parsers.get(language);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(grammar);
    parsers.set(language, parser);
  }
  const tree = parser.parse(text);
  if (!tree) throw new Error("Tree-sitter returned no syntax tree");
  const entry = { hash, tree, text, language, grammar };
  cache.set(full, entry);
  // FIFO-evict the oldest entry (and free its WASM tree) once over the cap.
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest && oldest !== full) {
      const evicted = cache.get(oldest);
      try { evicted?.tree.delete(); } catch { /* already freed */ }
      cache.delete(oldest);
    }
  }
  return { ...entry, path: full };
}
export async function parseText(language: string, text: string) {
  await init();
  let grammar = languages.get(language);
  if (!grammar) {
    grammar = await Parser.Language.load(
      require.resolve(`tree-sitter-wasms/out/tree-sitter-${language}.wasm`),
    );
    languages.set(language, grammar);
  }
  let parser = parsers.get(language);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(grammar);
    parsers.set(language, parser);
  }
  const tree = parser.parse(text);
  if (!tree) throw new Error("Tree-sitter returned no syntax tree");
  return {
    tree,
    text,
    language,
    grammar,
    hash: crypto.createHash("sha256").update(text).digest("hex"),
  };
}
export function nodeResult(n: SyntaxNode, text: string, includeText = false) {
  return {
    type: n.type,
    named: n.isNamed(),
    start_line: n.startPosition.row + 1,
    start_character: n.startPosition.column + 1,
    end_line: n.endPosition.row + 1,
    end_character: n.endPosition.column + 1,
    ...(includeText ? { text: text.slice(n.startIndex, n.endIndex) } : {}),
  };
}
export function walk(
  root: SyntaxNode,
  visit: (node: SyntaxNode, depth: number) => void,
) {
  const stack: [SyntaxNode, number][] = [[root, 0]];
  while (stack.length) {
    const [n, d] = stack.pop()!;
    visit(n, d);
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i);
      if (c) stack.push([c, d + 1]);
    }
  }
}
export function compact(
  root: SyntaxNode,
  text: string,
  maxDepth: number,
  maxNodes: number,
  includeText: boolean,
  namedOnly: boolean,
) {
  let count = 0,
    truncated = false;
  function add(n: SyntaxNode, d: number): any {
    if (count >= maxNodes) {
      truncated = true;
      return;
    }
    count++;
    const out: any = nodeResult(n, text, includeText);
    if (d < maxDepth) {
      const children = [];
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (!c || (namedOnly && !c.isNamed())) continue;
        const item = add(c, d + 1);
        if (item) children.push(item);
      }
      if (children.length) out.children = children;
    } else if (n.namedChildCount) truncated = true;
    return out;
  }
  return { tree: add(root, 0), nodes_returned: count, truncated };
}
export function queryTree(
  language: Language,
  root: SyntaxNode,
  source: string,
  max: number,
) {
  const q = language.query(source);
  try {
    return q.captures(root).slice(0, max);
  } finally {
    q.delete();
  }
}
export const definitionTypes = new Set([
  "function_declaration",
  "function_definition",
  "method_definition",
  "method_declaration",
  "class_declaration",
  "class_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "struct_item",
  "function_item",
  "trait_item",
  "impl_item",
  "const_item",
  "const_declaration",
  "lexical_declaration",
  "variable_declaration",
]);
export function definitionName(node: SyntaxNode, text: string) {
  let named = node.childForFieldName("name");
  if (!named && /lexical_declaration|variable_declaration/.test(node.type)) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      const candidate = child?.childForFieldName("name");
      if (candidate) { named = candidate; break; }
    }
  }
  return named ? text.slice(named.startIndex, named.endIndex) : undefined;
}
export function structuralSignature(node: SyntaxNode) {
  const parts: string[] = [];
  walk(node, (n) => {
    if (!n.isNamed()) return;
    if (
      [
        "identifier",
        "property_identifier",
        "type_identifier",
        "string",
        "string_literal",
        "number",
        "integer",
        "float",
      ].includes(n.type)
    )
      parts.push(n.type.includes("identifier") ? "<id>" : "<literal>");
    else parts.push(n.type);
  });
  return parts.join("/");
}
