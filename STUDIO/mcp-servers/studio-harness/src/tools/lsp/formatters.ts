/**
 * LSP result formatters — convert raw LSP protocol responses into
 * human-readable strings suitable for LLM consumption.
 */

import { readFile } from "fs/promises";
import path from "path";
import { uriToPath, SYMBOL_KIND_NAMES, type LspLocation, type LspSymbol } from "./manager.js";

const MAX_LOCATIONS = 50;
const CONTEXT_LINES = 2;

// ---------------------------------------------------------------------------
// Location list (goToDefinition, findReferences, goToImplementation)
// ---------------------------------------------------------------------------

export async function formatLocations(
  locations: LspLocation | LspLocation[] | null,
  label: string
): Promise<string> {
  if (!locations) return `No ${label} found.`;

  const list = Array.isArray(locations) ? locations : [locations];
  if (list.length === 0) return `No ${label} found.`;

  const truncated = list.length > MAX_LOCATIONS;
  const toShow = list.slice(0, MAX_LOCATIONS);

  const lines: string[] = [`${label} (${list.length}${truncated ? "+" : ""} results):\n`];

  for (const loc of toShow) {
    const filePath = uriToPath(loc.uri);
    const line1 = loc.range.start.line + 1; // 1-based for display
    const col1 = loc.range.start.character + 1;

    let snippet = "";
    try {
      const content = await readFile(filePath, "utf8");
      const fileLines = content.split("\n");
      const ctx = fileLines
        .slice(
          Math.max(0, loc.range.start.line - CONTEXT_LINES),
          loc.range.start.line + CONTEXT_LINES + 1
        )
        .map((l, i) => {
          const lineNo = loc.range.start.line - CONTEXT_LINES + i + 1;
          const marker = lineNo === line1 ? "▶" : " ";
          return `  ${marker} ${lineNo.toString().padStart(4)}: ${l}`;
        })
        .join("\n");
      snippet = `\n${ctx}`;
    } catch {
      // File unreadable — show location only
    }

    lines.push(`${filePath}:${line1}:${col1}${snippet}\n`);
  }

  if (truncated) {
    lines.push(`... and ${list.length - MAX_LOCATIONS} more results (use findReferences with a more specific symbol)`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export function formatHover(hover: any): string {
  if (!hover) return "No hover information available.";

  const contents = hover.contents;

  if (typeof contents === "string") return contents;

  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === "string" ? c : c.value ?? ""))
      .filter(Boolean)
      .join("\n\n");
  }

  if (contents && typeof contents === "object") {
    // MarkedString or MarkupContent
    return contents.value ?? contents.language ? `\`\`\`${contents.language}\n${contents.value}\n\`\`\`` : String(contents);
  }

  return "No hover information available.";
}

// ---------------------------------------------------------------------------
// Document symbols
// ---------------------------------------------------------------------------

export function formatDocumentSymbols(symbols: LspSymbol[] | null, filePath: string): string {
  if (!symbols || symbols.length === 0) {
    return `No symbols found in ${path.basename(filePath)}.`;
  }

  const lines: string[] = [`Symbols in ${filePath}:\n`];
  renderSymbolTree(symbols, lines, 0);
  return lines.join("\n");
}

function renderSymbolTree(symbols: LspSymbol[], lines: string[], depth: number): void {
  for (const sym of symbols) {
    const indent = "  ".repeat(depth);
    const kind = SYMBOL_KIND_NAMES[sym.kind] ?? `Kind(${sym.kind})`;
    const line = sym.selectionRange.start.line + 1;
    lines.push(`${indent}${kind.padEnd(14)} ${sym.name}  (line ${line})`);
    if (sym.children?.length) {
      renderSymbolTree(sym.children, lines, depth + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Workspace symbols
// ---------------------------------------------------------------------------

export async function formatWorkspaceSymbols(symbols: any[] | null, query: string): Promise<string> {
  if (!symbols || symbols.length === 0) {
    return `No workspace symbols matching '${query}'.`;
  }

  const lines: string[] = [`Workspace symbols matching '${query}' (${symbols.length} results):\n`];

  for (const sym of symbols.slice(0, MAX_LOCATIONS)) {
    const kind = SYMBOL_KIND_NAMES[sym.kind] ?? `Kind(${sym.kind})`;
    const filePath = uriToPath(sym.location.uri);
    const line = sym.location.range.start.line + 1;
    const container = sym.containerName ? `${sym.containerName}.` : "";
    lines.push(`${kind.padEnd(14)} ${container}${sym.name}  —  ${filePath}:${line}`);
  }

  if (symbols.length > MAX_LOCATIONS) {
    lines.push(`\n... and ${symbols.length - MAX_LOCATIONS} more. Narrow your query for fewer results.`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Call hierarchy
// ---------------------------------------------------------------------------

export async function formatCallHierarchyItems(items: any[] | null, operation: string): Promise<string> {
  if (!items || items.length === 0) return `No ${operation} found.`;

  const lines: string[] = [`${operation} (${items.length} results):\n`];

  for (const item of items.slice(0, MAX_LOCATIONS)) {
    const from = item.from ?? item;
    const filePath = uriToPath(from.uri);
    const line = from.range.start.line + 1;
    const kind = SYMBOL_KIND_NAMES[from.kind] ?? "Symbol";
    lines.push(`${kind.padEnd(14)} ${from.name}  —  ${filePath}:${line}`);
  }

  return lines.join("\n");
}
