/**
 * LSP tool — exposes Language Server Protocol code intelligence to the LLM.
 *
 * Supported operations:
 *   goToDefinition       — where is this symbol defined?
 *   findReferences       — who uses this symbol?
 *   hover                — type info and documentation at a position
 *   documentSymbol       — all symbols (functions, classes, vars) in a file
 *   workspaceSymbol      — find a symbol by name across the whole project
 *   goToImplementation   — find concrete implementations of an interface/abstract
 *   incomingCalls        — who calls this function?
 *   outgoingCalls        — what does this function call?
 *
 * Positions are 1-based (as shown in editors) — the tool converts to 0-based
 * internally before sending to the LSP server.
 *
 * Requires the appropriate language server to be installed:
 *   TypeScript/JS : npm install -g typescript typescript-language-server
 *   Python        : pip install python-lsp-server
 *   Rust          : install rust-analyzer
 *   Go            : go install golang.org/x/tools/gopls@latest
 */

import path from "path";
import { lspManager, EXT_TO_LANG, pathToUri } from "./manager.js";
import {
  formatLocations,
  formatHover,
  formatDocumentSymbols,
  formatWorkspaceSymbols,
  formatCallHierarchyItems,
} from "./formatters.js";
export { navigateSymbol, findSymbolRelationships, inspectSymbol, diagnostics, renameSymbol, codeActions, formatCode } from "./ide.js";

type LspOperation =
  | "goToDefinition"
  | "findReferences"
  | "hover"
  | "documentSymbol"
  | "workspaceSymbol"
  | "goToImplementation"
  | "incomingCalls"
  | "outgoingCalls";

interface LspArgs {
  operation: LspOperation;
  filePath?: string;
  line?: number;
  character?: number;
  query?: string;
  workspaceRoot?: string;
  includeDeclaration?: boolean;
}

export async function runLsp(args: Record<string, unknown>): Promise<unknown> {
  const {
    operation,
    filePath,
    line,
    character,
    query,
    workspaceRoot,
    includeDeclaration = true,
  } = args as unknown as LspArgs;

  // ── Validate common params ──────────────────────────────────────────────

  if (!operation) {
    return { error: "operation is required. Choose one of: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, incomingCalls, outgoingCalls" };
  }

  // workspaceSymbol only needs query; all others need filePath
  if (operation === "workspaceSymbol") {
    if (!query) return { error: "query is required for workspaceSymbol" };
  } else {
    if (!filePath) return { error: "filePath is required for " + operation };
  }

  // Resolve workspace root
  const resolvedWorkspace = workspaceRoot
    ? path.resolve(workspaceRoot)
    : filePath
    ? findWorkspaceRoot(path.resolve(filePath))
    : process.cwd();

  // Detect language
  const targetFile = filePath ? path.resolve(filePath) : null;
  const language = targetFile
    ? lspManager.detectLanguage(targetFile)
    : detectWorkspaceLanguage(resolvedWorkspace);

  if (!language) {
    const ext = targetFile ? path.extname(targetFile) : "unknown";
    return {
      error: `File extension '${ext}' is not supported by the LSP tool.`,
      supportedExtensions: Object.keys(EXT_TO_LANG).join(", "),
    };
  }

  // ── Get or start the server ─────────────────────────────────────────────

  let server: Awaited<ReturnType<typeof lspManager.getOrCreate>>;
  try {
    server = await lspManager.getOrCreate(language, resolvedWorkspace);
  } catch (e: any) {
    return {
      error: e.message,
      tip: lspManager.getInstallHint(language),
    };
  }

  // ── Dispatch by operation ───────────────────────────────────────────────

  try {
    switch (operation) {
      case "goToDefinition":
      case "findReferences":
      case "hover":
      case "goToImplementation":
      case "incomingCalls":
      case "outgoingCalls": {
        if (line === undefined || character === undefined) {
          return { error: `line and character are required for ${operation}` };
        }
        if (!targetFile) return { error: "filePath is required" };

        const fileUri = await lspManager.ensureFileOpen(server, targetFile);
        // Convert 1-based editor positions to 0-based LSP positions
        const pos = { line: line - 1, character: character - 1 };

        if (operation === "goToDefinition") {
          const result = await lspManager.request(server, "textDocument/definition", {
            textDocument: { uri: fileUri },
            position: pos,
          });
          return formatLocations(result as any, "Definition");
        }

        if (operation === "findReferences") {
          const result = await lspManager.request(server, "textDocument/references", {
            textDocument: { uri: fileUri },
            position: pos,
            context: { includeDeclaration },
          });
          return formatLocations(result as any, "References");
        }

        if (operation === "hover") {
          const result = await lspManager.request(server, "textDocument/hover", {
            textDocument: { uri: fileUri },
            position: pos,
          });
          return formatHover(result);
        }

        if (operation === "goToImplementation") {
          const result = await lspManager.request(server, "textDocument/implementation", {
            textDocument: { uri: fileUri },
            position: pos,
          });
          return formatLocations(result as any, "Implementations");
        }

        if (operation === "incomingCalls" || operation === "outgoingCalls") {
          // Step 1: prepareCallHierarchy
          const items: any[] = await lspManager.request(server, "textDocument/prepareCallHierarchy", {
            textDocument: { uri: fileUri },
            position: pos,
          }) as any[];

          if (!items?.length) {
            return `No call hierarchy item found at ${targetFile}:${line}:${character}`;
          }

          const method = operation === "incomingCalls"
            ? "callHierarchy/incomingCalls"
            : "callHierarchy/outgoingCalls";
          const label = operation === "incomingCalls" ? "Incoming calls" : "Outgoing calls";

          const calls: any[] = await lspManager.request(server, method, { item: items[0] }) as any[];
          const normalized = calls?.map((c: any) => c.from ?? c.to ?? c) ?? [];
          return formatCallHierarchyItems(normalized, label);
        }
        break;
      }

      case "documentSymbol": {
        if (!targetFile) return { error: "filePath is required" };
        const fileUri = await lspManager.ensureFileOpen(server, targetFile);
        const symbols: any = await lspManager.request(server, "textDocument/documentSymbol", {
          textDocument: { uri: fileUri },
        });
        return formatDocumentSymbols(symbols, targetFile);
      }

      case "workspaceSymbol": {
        const symbols: any = await lspManager.request(server, "workspace/symbol", {
          query: query ?? "",
        });
        return formatWorkspaceSymbols(symbols, query ?? "");
      }

      default:
        return { error: `Unknown operation: ${operation}` };
    }
  } catch (e: any) {
    return { error: `LSP error during ${operation}: ${e.message}` };
  }

  return { error: "Unexpected end of operation handler" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk up the directory tree to find a package.json or tsconfig.json root. */
function findWorkspaceRoot(startPath: string): string {
  let dir = path.dirname(startPath);
  const markers = ["package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml", "go.mod"];

  while (true) {
    for (const marker of markers) {
      try {
        // sync check — we want this fast and it's a small lookup
        require("fs").statSync(path.join(dir, marker));
        return dir;
      } catch {
        // not here
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return startPath; // filesystem root — give up
    dir = parent;
  }
}

/** Detect dominant language in a workspace by counting extensions. */
function detectWorkspaceLanguage(workspaceRoot: string): string | null {
  // For workspaceSymbol calls where we don't have a target file,
  // try to detect from package.json or pyproject.toml presence.
  try {
    const fs = require("fs");
    if (fs.existsSync(path.join(workspaceRoot, "package.json"))) return "typescript";
    if (fs.existsSync(path.join(workspaceRoot, "pyproject.toml"))) return "python";
    if (fs.existsSync(path.join(workspaceRoot, "Cargo.toml"))) return "rust";
    if (fs.existsSync(path.join(workspaceRoot, "go.mod"))) return "go";
  } catch { /* ignore */ }
  return null;
}
