import path from "path";
import {
  uriToPath,
  SYMBOL_KIND_NAMES,
  type LspLocation,
  type LspSymbol,
} from "./manager.js";
const MAX = 100;
function location(loc: any) {
  const range = loc.range ?? loc.targetSelectionRange ?? loc.targetRange,
    uri = loc.uri ?? loc.targetUri;
  return {
    path: path.resolve(uriToPath(uri)),
    start_line: range.start.line + 1,
    start_character: range.start.character + 1,
    end_line: range.end.line + 1,
    end_character: range.end.character + 1,
  };
}
export async function formatLocations(
  locations: LspLocation | LspLocation[] | null,
  label: string,
): Promise<Record<string, unknown>> {
  const all = !locations
    ? []
    : Array.isArray(locations)
      ? locations
      : [locations];
  return {
    kind: label.toLowerCase(),
    locations: all.slice(0, MAX).map(location),
    total: all.length,
    truncated: all.length > MAX,
  };
}
export function formatHover(hover: any): Record<string, unknown> {
  const c = hover?.contents;
  const contents =
    typeof c === "string"
      ? c
      : Array.isArray(c)
        ? c
            .map((x) => (typeof x === "string" ? x : x.value))
            .filter(Boolean)
            .join("\n\n")
        : (c?.value ?? null);
  return { contents, range: hover?.range };
}
function symbolsTree(items: LspSymbol[]): any[] {
  return items.map((s) => ({
    name: s.name,
    kind: SYMBOL_KIND_NAMES[s.kind] ?? `Kind(${s.kind})`,
    start_line: s.range.start.line + 1,
    start_character: s.range.start.character + 1,
    end_line: s.range.end.line + 1,
    end_character: s.range.end.character + 1,
    selection_line: s.selectionRange.start.line + 1,
    children: s.children ? symbolsTree(s.children) : undefined,
  }));
}
export function formatDocumentSymbols(
  symbols: LspSymbol[] | null,
  filePath: string,
): Record<string, unknown> {
  return {
    path: path.resolve(filePath),
    symbols: symbolsTree(symbols ?? []),
    total: (symbols ?? []).length,
  };
}
export async function formatWorkspaceSymbols(
  symbols: any[] | null,
  query: string,
): Promise<Record<string, unknown>> {
  const all = symbols ?? [];
  return {
    query,
    symbols: all.slice(0, MAX).map((s) => ({
      name: s.name,
      kind: SYMBOL_KIND_NAMES[s.kind] ?? `Kind(${s.kind})`,
      container: s.containerName,
      ...location(s.location),
    })),
    total: all.length,
    truncated: all.length > MAX,
  };
}
export async function formatCallHierarchyItems(
  items: any[] | null,
  operation: string,
): Promise<Record<string, unknown>> {
  const all = items ?? [];
  return {
    operation,
    items: all.slice(0, MAX).map((x) => {
      const s = x.from ?? x.to ?? x;
      return {
        name: s.name,
        kind: SYMBOL_KIND_NAMES[s.kind] ?? `Kind(${s.kind})`,
        ...location({ uri: s.uri, range: s.selectionRange ?? s.range }),
      };
    }),
    total: all.length,
    truncated: all.length > MAX,
  };
}
