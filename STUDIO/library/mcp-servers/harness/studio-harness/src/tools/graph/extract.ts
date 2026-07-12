import Parser from "web-tree-sitter";
type SyntaxNode = Parser.SyntaxNode;
import { walk } from "../syntax/runtime.js";

/**
 * Per-file symbol and edge extraction for the code graph (TypeScript / TSX /
 * JavaScript in phase 1). Pure Tree-sitter AST work — deterministic, no LLM,
 * nothing leaves the machine. Cross-file edges are *resolved* later in build.ts
 * against the global symbol table; here we only record what a single file
 * declares, imports, and references.
 *
 * Every produced edge carries a provenance we can honestly defend:
 *   EXTRACTED  — the relationship is explicit in this file's syntax.
 *   INFERRED   — resolved by us with reasonable confidence (e.g. a heritage
 *                clause whose target we matched to a known symbol).
 *   AMBIGUOUS  — a name match with more than one plausible target.
 * (AMBIGUOUS is assigned during resolution, not here.)
 */

export type Provenance = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
export type SymbolKind = "function" | "class" | "interface" | "type" | "enum" | "method" | "variable";

export interface RawSymbol {
  /** Local id within the file: `Name` or `Class.method`. */
  local: string;
  name: string;
  kind: SymbolKind;
  start_line: number;
  end_line: number;
  exported: boolean;
}

/** An unresolved reference from one local symbol to a name used in its body. */
export interface RawRef {
  /** local id of the symbol making the reference (or "" for file-level). */
  from: string;
  /** the referenced name (callee, base class, etc.). */
  name: string;
  kind: "calls" | "extends" | "implements";
}

export interface ImportBinding {
  /** local name introduced into this file. */
  local: string;
  /** original exported name in the source module ("*" for namespace, "default"). */
  imported: string;
  /** raw module specifier as written. */
  source: string;
}

export interface FileExtraction {
  symbols: RawSymbol[];
  refs: RawRef[];
  imports: ImportBinding[];
  /** module specifiers imported (deduped) — file→file edges resolved in build. */
  importSources: string[];
}

const TS_LANGS = new Set(["typescript", "tsx", "javascript"]);

export function isSupportedLanguage(language: string): boolean {
  return TS_LANGS.has(language);
}

function nodeName(node: SyntaxNode, text: string): string | undefined {
  const n = node.childForFieldName("name");
  return n ? text.slice(n.startIndex, n.endIndex) : undefined;
}

function isExported(node: SyntaxNode): boolean {
  const p = node.parent;
  return p?.type === "export_statement";
}

/** Rightmost identifier of a call/heritage target, e.g. `a.b.c` → `c`. */
function calleeName(node: SyntaxNode, text: string): string | undefined {
  if (node.type === "identifier" || node.type === "type_identifier" || node.type === "property_identifier") {
    return text.slice(node.startIndex, node.endIndex);
  }
  if (node.type === "member_expression") {
    const prop = node.childForFieldName("property");
    if (prop) return text.slice(prop.startIndex, prop.endIndex);
  }
  // Fallback: last identifier descendant.
  let last: string | undefined;
  walk(node, (n) => {
    if (n.type === "identifier" || n.type === "property_identifier") last = text.slice(n.startIndex, n.endIndex);
  });
  return last;
}

/** Collect call references inside a symbol's body subtree. */
function collectCalls(body: SyntaxNode, text: string, fromLocal: string, out: RawRef[]): void {
  walk(body, (n) => {
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    if (!fn) return;
    const name = calleeName(fn, text);
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.push({ from: fromLocal, name, kind: "calls" });
  });
}

function heritage(node: SyntaxNode, text: string, fromLocal: string, out: RawRef[]): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    if (child.type === "class_heritage" || child.type === "extends_clause" || child.type === "implements_clause") {
      walk(child, (n) => {
        if (n.type === "identifier" || n.type === "type_identifier") {
          const name = text.slice(n.startIndex, n.endIndex);
          const kind = child.type === "implements_clause" ? "implements" : "extends";
          out.push({ from: fromLocal, name, kind });
        }
      });
    }
  }
}

export function extractFile(root: SyntaxNode, text: string, language: string): FileExtraction {
  const symbols: RawSymbol[] = [];
  const refs: RawRef[] = [];
  const imports: ImportBinding[] = [];
  const importSources = new Set<string>();
  if (!isSupportedLanguage(language)) {
    return { symbols, refs, imports, importSources: [] };
  }

  const line = (n: SyntaxNode) => n.startPosition.row + 1;
  const endLine = (n: SyntaxNode) => n.endPosition.row + 1;

  const pushSymbol = (node: SyntaxNode, name: string, kind: SymbolKind, local: string) => {
    symbols.push({ local, name, kind, start_line: line(node), end_line: endLine(node), exported: isExported(node) });
  };

  // Top-level declarations. We iterate the program's children (and unwrap
  // export_statement) rather than walking the whole tree, so we capture
  // module-level symbols and class members without nested-function noise.
  const topLevel: SyntaxNode[] = [];
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i);
    if (!c) continue;
    if (c.type === "export_statement") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const d = c.namedChild(j);
        if (d) topLevel.push(d);
      }
    } else {
      topLevel.push(c);
    }
  }

  for (const node of topLevel) {
    switch (node.type) {
      case "import_statement": {
        const src = node.childForFieldName("source");
        const source = src ? text.slice(src.startIndex + 1, src.endIndex - 1) : undefined;
        if (!source) break;
        importSources.add(source);
        const clause = node.namedChildren.find((c) => c.type === "import_clause");
        if (clause) {
          walk(clause, (n) => {
            if (n.type === "import_specifier") {
              const nameNode = n.childForFieldName("name");
              const aliasNode = n.childForFieldName("alias");
              const imported = nameNode ? text.slice(nameNode.startIndex, nameNode.endIndex) : undefined;
              const local = aliasNode ? text.slice(aliasNode.startIndex, aliasNode.endIndex) : imported;
              if (imported && local) imports.push({ local, imported, source });
            } else if (n.type === "namespace_import") {
              const id = n.namedChildren.find((c) => c.type === "identifier");
              if (id) imports.push({ local: text.slice(id.startIndex, id.endIndex), imported: "*", source });
            }
          });
          // default import: `import Foo from '...'`
          const def = clause.namedChildren.find((c) => c.type === "identifier");
          if (def) imports.push({ local: text.slice(def.startIndex, def.endIndex), imported: "default", source });
        }
        break;
      }
      case "function_declaration": {
        const name = nodeName(node, text);
        if (!name) break;
        pushSymbol(node, name, "function", name);
        const body = node.childForFieldName("body");
        if (body) collectCalls(body, text, name, refs);
        break;
      }
      case "class_declaration": {
        const name = nodeName(node, text);
        if (!name) break;
        pushSymbol(node, name, "class", name);
        heritage(node, text, name, refs);
        const body = node.childForFieldName("body");
        if (body) {
          for (let i = 0; i < body.namedChildCount; i++) {
            const m = body.namedChild(i);
            if (!m || (m.type !== "method_definition")) continue;
            const mName = nodeName(m, text);
            if (!mName) continue;
            const local = `${name}.${mName}`;
            pushSymbol(m, mName, "method", local);
            const mBody = m.childForFieldName("body");
            if (mBody) collectCalls(mBody, text, local, refs);
          }
        }
        break;
      }
      case "interface_declaration": {
        const name = nodeName(node, text);
        if (name) { pushSymbol(node, name, "interface", name); heritage(node, text, name, refs); }
        break;
      }
      case "type_alias_declaration": {
        const name = nodeName(node, text);
        if (name) pushSymbol(node, name, "type", name);
        break;
      }
      case "enum_declaration": {
        const name = nodeName(node, text);
        if (name) pushSymbol(node, name, "enum", name);
        break;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        // Capture top-level bindings (const X = ..., often an arrow fn/component).
        for (let i = 0; i < node.namedChildCount; i++) {
          const decl = node.namedChild(i);
          if (!decl || decl.type !== "variable_declarator") continue;
          const nameNode = decl.childForFieldName("name");
          if (!nameNode || nameNode.type !== "identifier") continue;
          const name = text.slice(nameNode.startIndex, nameNode.endIndex);
          pushSymbol(node, name, "variable", name);
          const value = decl.childForFieldName("value");
          if (value && (value.type === "arrow_function" || value.type === "function_expression")) {
            const body = value.childForFieldName("body");
            if (body) collectCalls(body, text, name, refs);
          }
        }
        break;
      }
    }
  }

  return { symbols, refs, imports, importSources: [...importSources] };
}
