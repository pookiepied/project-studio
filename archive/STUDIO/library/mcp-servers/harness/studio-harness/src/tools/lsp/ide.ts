import path from "path";
import { existsSync, promises as fs } from "fs";
import { lspManager, uriToPath, type LspServer } from "./manager.js";
import { getFileRevision, staleResult } from "../filesystem/revision.js";
function rootFor(file: string, provided?: string) {
  if (provided) return path.resolve(provided);
  let d = path.dirname(path.resolve(file));
  for (;;) {
    if (
      [
        "package.json",
        "tsconfig.json",
        "pyproject.toml",
        "Cargo.toml",
        "go.mod",
      ].some((x) => existsSync(path.join(d, x)))
    )
      return d;
    const p = path.dirname(d);
    if (p === d) return path.dirname(path.resolve(file));
    d = p;
  }
}
async function session(args: Record<string, unknown>) {
  const file = args.path as string;
  if (!file) return { error: "path is required" } as const;
  const full = path.resolve(file),
    language = lspManager.detectLanguage(full);
  if (!language)
    return {
      error: `Unsupported LSP file extension: ${path.extname(full)}`,
    } as const;
  const root = rootFor(full, args.workspace_root as string);
  try {
    const server = await lspManager.getOrCreate(language, root),
      uri = await lspManager.ensureFileOpen(server, full);
    return { server, uri, full, root, language };
  } catch (e: any) {
    return {
      error: e.message,
      tip: lspManager.getInstallHint(language),
    } as const;
  }
}
const pos = (a: Record<string, unknown>) => ({
  line: Math.max(0, ((a.line as number) || 1) - 1),
  character: Math.max(0, ((a.character as number) || 1) - 1),
});
const range = (a: Record<string, unknown>) => ({
  start: {
    line: Math.max(
      0,
      ((a.start_line as number) || (a.line as number) || 1) - 1,
    ),
    character: Math.max(
      0,
      ((a.start_character as number) || (a.character as number) || 1) - 1,
    ),
  },
  end: {
    line: Math.max(0, ((a.end_line as number) || (a.line as number) || 1) - 1),
    character: Math.max(
      0,
      ((a.end_character as number) || (a.character as number) || 1) - 1,
    ),
  },
});
function locations(raw: any, max = 100) {
  const list = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  return {
    locations: list.slice(0, max).map((x: any) => {
      const r = x.range ?? x.targetSelectionRange ?? x.targetRange,
        u = x.uri ?? x.targetUri;
      return {
        path: path.resolve(uriToPath(u)),
        start_line: r.start.line + 1,
        start_character: r.start.character + 1,
        end_line: r.end.line + 1,
        end_character: r.end.character + 1,
      };
    }),
    total: list.length,
    truncated: list.length > max,
  };
}
function unsupported(server: LspServer, cap: string) {
  return {
    error: "unsupported_lsp_capability",
    capability: cap,
    language: server.language,
    fallback:
      "Use exact search, symbol index, or compiler tools where appropriate.",
  };
}
export async function navigateSymbol(args: Record<string, unknown>) {
  const s: any = await session(args);
  if (s.error) return s;
  const op = (args.operation as string) || "definition",
    map: any = {
      definition: ["textDocument/definition", "definitionProvider"],
      declaration: ["textDocument/declaration", "declarationProvider"],
      implementation: ["textDocument/implementation", "implementationProvider"],
      type_definition: [
        "textDocument/typeDefinition",
        "typeDefinitionProvider",
      ],
    },
    entry = map[op];
  if (!entry) return { error: "Unknown navigation operation" };
  if (!s.server.capabilities[entry[1]]) return unsupported(s.server, entry[1]);
  try {
    return {
      operation: op,
      ...locations(
        await lspManager.request(s.server, entry[0], {
          textDocument: { uri: s.uri },
          position: pos(args),
        }),
        Math.min((args.max_results as number) || 100, 1000),
      ),
      server: { language: s.language, workspace_root: s.root },
    };
  } catch (e: any) {
    return { error: `LSP ${op}: ${e.message}` };
  }
}
export async function findSymbolRelationships(args: Record<string, unknown>) {
  const s: any = await session(args);
  if (s.error) return s;
  const op = (args.operation as string) || "references";
  try {
    if (op === "references") {
      if (!s.server.capabilities.referencesProvider)
        return unsupported(s.server, "referencesProvider");
      const raw = await lspManager.request(
        s.server,
        "textDocument/references",
        {
          textDocument: { uri: s.uri },
          position: pos(args),
          context: {
            includeDeclaration: (args.include_declaration as boolean) ?? true,
          },
        },
      );
      return {
        operation: op,
        ...locations(raw, Math.min((args.max_results as number) || 100, 1000)),
      };
    }
    if (!["incoming_calls", "outgoing_calls"].includes(op))
      return {
        error:
          "operation must be references, incoming_calls, or outgoing_calls",
      };
    if (!s.server.capabilities.callHierarchyProvider)
      return unsupported(s.server, "callHierarchyProvider");
    const prepared: any[] = await lspManager.request(
      s.server,
      "textDocument/prepareCallHierarchy",
      { textDocument: { uri: s.uri }, position: pos(args) },
    );
    if (!prepared?.length)
      return { operation: op, relationships: [], total: 0 };
    const raw: any[] = await lspManager.request(
      s.server,
      op === "incoming_calls"
        ? "callHierarchy/incomingCalls"
        : "callHierarchy/outgoingCalls",
      { item: prepared[0] },
    );
    const normalized = raw?.map((x) => x.from ?? x.to ?? x) ?? [];
    return {
      operation: op,
      ...locations(
        normalized.map((x) => ({
          uri: x.uri,
          range: x.selectionRange ?? x.range,
        })),
        Math.min((args.max_results as number) || 100, 1000),
      ),
    };
  } catch (e: any) {
    return { error: `LSP ${op}: ${e.message}` };
  }
}
function hoverText(raw: any) {
  const c = raw?.contents;
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .map((x) => (typeof x === "string" ? x : x.value))
      .filter(Boolean)
      .join("\n\n");
  return c?.value ?? null;
}
export async function inspectSymbol(args: Record<string, unknown>) {
  const s: any = await session(args);
  if (s.error) return s;
  const op = (args.operation as string) || "hover";
  try {
    if (op === "hover") {
      const raw: any = await lspManager.request(
        s.server,
        "textDocument/hover",
        { textDocument: { uri: s.uri }, position: pos(args) },
      );
      return { operation: op, contents: hoverText(raw), range: raw?.range };
    }
    if (op === "signature_help")
      if (!s.server.capabilities.signatureHelpProvider)
        return unsupported(s.server, "signatureHelpProvider");
      else
        return {
          operation: op,
          signature_help: await lspManager.request(
            s.server,
            "textDocument/signatureHelp",
            { textDocument: { uri: s.uri }, position: pos(args) },
          ),
        };
    if (op === "inlay_hints") {
      if (!s.server.capabilities.inlayHintProvider)
        return unsupported(s.server, "inlayHintProvider");
      return {
        operation: op,
        hints: await lspManager.request(s.server, "textDocument/inlayHint", {
          textDocument: { uri: s.uri },
          range: range(args),
        }),
      };
    }
    if (op === "semantic_tokens") {
      if (!s.server.capabilities.semanticTokensProvider)
        return unsupported(s.server, "semanticTokensProvider");
      return {
        operation: op,
        tokens: await lspManager.request(
          s.server,
          "textDocument/semanticTokens/range",
          { textDocument: { uri: s.uri }, range: range(args) },
        ),
        legend: s.server.capabilities.semanticTokensProvider?.legend,
      };
    }
    return {
      error:
        "operation must be hover, signature_help, inlay_hints, or semantic_tokens",
    };
  } catch (e: any) {
    return { error: `LSP ${op}: ${e.message}` };
  }
}
export async function diagnostics(args: Record<string, unknown>) {
  const s: any = await session(args);
  if (s.error) return s;
  await new Promise((r) => setTimeout(r, 300));
  const severity = (args.severity as number) | 0,
    max = Math.min((args.max_results as number) || 500, 5000),
    items: any[] = [];
  for (const [uri, list] of s.server.diagnostics)
    for (const d of list) {
      if (severity && d.severity !== severity) continue;
      items.push({
        path: path.resolve(uriToPath(uri)),
        start_line: d.range.start.line + 1,
        start_character: d.range.start.character + 1,
        end_line: d.range.end.line + 1,
        end_character: d.range.end.character + 1,
        severity: d.severity,
        code: d.code,
        source: d.source,
        message: d.message,
      });
    }
  return {
    diagnostics: items.slice(0, max),
    total: items.length,
    truncated: items.length > max,
    server: { language: s.language, workspace_root: s.root },
  };
}
type Edit = { path: string; range: any; newText: string };
function editsFromWorkspace(raw: any) {
  const out: Edit[] = [];
  for (const [uri, edits] of Object.entries(raw?.changes ?? {}))
    for (const e of edits as any[])
      out.push({
        path: path.resolve(uriToPath(uri)),
        range: e.range,
        newText: e.newText,
      });
  for (const change of raw?.documentChanges ?? []) {
    if (!change.textDocument) continue;
    for (const e of change.edits ?? [])
      out.push({
        path: path.resolve(uriToPath(change.textDocument.uri)),
        range: e.range,
        newText: e.newText,
      });
  }
  return out;
}
async function applyEdits(edits: Edit[], expected: any, server?: LspServer) {
  const grouped = new Map<string, Edit[]>();
  for (const e of edits)
    grouped.set(e.path, [...(grouped.get(e.path) ?? []), e]);
  const originals = new Map<string, string>();
  for (const [file] of grouped) {
    const revision = await getFileRevision(file),
      want = expected?.hash
        ? expected
        : (expected?.[file] ?? expected?.[path.relative(process.cwd(), file)]);
    if (!want)
      return {
        error: "missing_expected_revision",
        path: file,
        message:
          "Every affected file requires an expected revision before applying a workspace edit.",
      };
    const stale = staleResult(want, revision);
    if (stale) return { ...stale, path: file };
    originals.set(file, await fs.readFile(file, "utf8"));
  }
  const updated = new Map<string, string>();
  for (const [file, list] of grouped) {
    let text = originals.get(file)!;
    const lines = text.split(/(?<=\n)/);
    // Clamp both coordinates. LSP full-document edits routinely use an end
    // position one line past the last line (e.g. {line: lineCount, character: 0});
    // an unclamped `lines[p.line].slice(...)` yields undefined → NaN offset →
    // the edit truncates or duplicates the whole file. Clamping to the end of the
    // text makes an out-of-range position mean "end of document".
    const offset = (p: any) => {
      const line = Math.max(0, Math.min(p.line ?? 0, lines.length));
      const lineText = lines[line] ?? "";
      const col = Math.max(0, Math.min(p.character ?? 0, lineText.length));
      return lines.slice(0, line).join("").length + col;
    };
    for (const e of [...list].sort(
      (a, b) => offset(b.range.start) - offset(a.range.start),
    )) {
      const a = offset(e.range.start),
        b = offset(e.range.end);
      text = text.slice(0, a) + e.newText + text.slice(b);
    }
    updated.set(file, text);
  }
  const written: string[] = [];
  try {
    for (const [file, text] of updated) {
      await fs.writeFile(file, text, "utf8");
      written.push(file);
    }
  } catch (e: any) {
    for (const file of written.reverse())
      await fs.writeFile(file, originals.get(file)!, "utf8").catch(() => {});
    return { error: `workspace_edit_failed: ${e.message}`, rolled_back: true };
  }
  if (server)
    for (const file of updated.keys()) await lspManager.syncFile(server, file);
  return {
    applied: true,
    files: [...updated.keys()],
    revisions: Object.fromEntries(
      await Promise.all(
        [...updated.keys()].map(async (f) => [f, await getFileRevision(f)]),
      ),
    ),
  };
}
export async function renameSymbol(args: Record<string, unknown>) {
  const s: any = await session(args);
  if (s.error) return s;
  const name = args.new_name as string;
  if (!name) return { error: "new_name is required" };
  if (args.apply && !args.expected_revisions)
    return { error: "expected_revisions is required when apply is true" };
  if (!s.server.capabilities.renameProvider)
    return unsupported(s.server, "renameProvider");
  try {
    const prepared: any = await lspManager
      .request(s.server, "textDocument/prepareRename", {
        textDocument: { uri: s.uri },
        position: pos(args),
      })
      .catch(() => null);
    const workspace: any = await lspManager.request(
      s.server,
      "textDocument/rename",
      { textDocument: { uri: s.uri }, position: pos(args), newName: name },
    );
    const edits = editsFromWorkspace(workspace);
    const preview = {
      valid: true,
      placeholder: prepared?.placeholder,
      range: prepared?.range,
      edits,
      affected_files: [...new Set(edits.map((e) => e.path))],
      applied: false,
    };
    return args.apply
      ? {
          ...preview,
          ...(await applyEdits(edits, args.expected_revisions, s.server)),
        }
      : preview;
  } catch (e: any) {
    return { error: `LSP rename: ${e.message}` };
  }
}
export async function codeActions(args: Record<string, unknown>) {
  const s: any = await session(args);
  if (s.error) return s;
  if (args.apply && !args.expected_revisions)
    return { error: "expected_revisions is required when apply is true" };
  if (!s.server.capabilities.codeActionProvider)
    return unsupported(s.server, "codeActionProvider");
  try {
    const actions: any[] = await lspManager.request(
      s.server,
      "textDocument/codeAction",
      {
        textDocument: { uri: s.uri },
        range: range(args),
        context: {
          diagnostics: args.diagnostics ?? [],
          only: args.only ? [args.only] : undefined,
        },
      },
    );
    const summarized = (actions ?? []).map((a, i) => ({
      index: i,
      title: a.title,
      kind: a.kind,
      is_preferred: a.isPreferred,
      disabled: a.disabled,
      has_edit: Boolean(a.edit),
      command: a.command?.command ?? a.command,
    }));
    if (args.action_index === undefined) return { actions: summarized };
    const action = actions[args.action_index as number];
    if (!action) return { error: "action_index is out of range" };
    if (!action.edit)
      return {
        error: "Selected action has no previewable workspace edit",
        command: action.command,
      };
    const edits = editsFromWorkspace(action.edit),
      preview = {
        action: summarized[args.action_index as number],
        edits,
        applied: false,
      };
    return args.apply
      ? {
          ...preview,
          ...(await applyEdits(edits, args.expected_revisions, s.server)),
        }
      : preview;
  } catch (e: any) {
    return { error: `LSP code actions: ${e.message}` };
  }
}
export async function formatCode(args: Record<string, unknown>) {
  const s: any = await session(args);
  if (s.error) return s;
  if (args.apply && !args.expected_revision)
    return { error: "expected_revision is required when apply is true" };
  const op = (args.operation as string) || "document";
  const capability =
    op === "document"
      ? "documentFormattingProvider"
      : op === "range"
        ? "documentRangeFormattingProvider"
        : "codeActionProvider";
  if (!s.server.capabilities[capability])
    return unsupported(s.server, capability);
  try {
    let raw: any;
    if (op === "document")
      raw = await lspManager.request(s.server, "textDocument/formatting", {
        textDocument: { uri: s.uri },
        options: {
          tabSize: (args.tab_size as number) || 2,
          insertSpaces: (args.insert_spaces as boolean) ?? true,
        },
      });
    else if (op === "range")
      raw = await lspManager.request(s.server, "textDocument/rangeFormatting", {
        textDocument: { uri: s.uri },
        range: range(args),
        options: {
          tabSize: (args.tab_size as number) || 2,
          insertSpaces: (args.insert_spaces as boolean) ?? true,
        },
      });
    else if (op === "organize_imports") {
      const actions: any[] = await lspManager.request(
        s.server,
        "textDocument/codeAction",
        {
          textDocument: { uri: s.uri },
          range: range(args),
          context: { diagnostics: [], only: ["source.organizeImports"] },
        },
      );
      const action = actions?.find((a) => a.edit);
      raw = action?.edit;
      const edits = editsFromWorkspace(raw);
      const preview = { operation: op, edits, applied: false };
      return args.apply
        ? {
            ...preview,
            ...(await applyEdits(edits, args.expected_revision, s.server)),
          }
        : preview;
    } else
      return {
        error: "operation must be document, range, or organize_imports",
      };
    const edits = (raw ?? []).map((e: any) => ({
        path: s.full,
        range: e.range,
        newText: e.newText,
      })),
      preview = { operation: op, edits, applied: false };
    return args.apply
      ? {
          ...preview,
          ...(await applyEdits(edits, args.expected_revision, s.server)),
        }
      : preview;
  } catch (e: any) {
    return { error: `LSP formatting: ${e.message}` };
  }
}
