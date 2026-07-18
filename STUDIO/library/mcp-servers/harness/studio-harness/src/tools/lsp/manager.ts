/**
 * LspManager — manages language server processes for the LSP tool.
 *
 * Each (language, workspaceRoot) pair gets one long-lived server process.
 * Communication is JSON-RPC 2.0 over stdio (standard LSP transport).
 *
 * Supported servers:
 *   TypeScript/JavaScript : typescript-language-server --stdio
 *   Python                : pylsp
 *   Rust                  : rust-analyzer
 *   Go                    : gopls
 *
 * If the binary isn't found the tool returns a clear install instruction.
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { killTree } from "../execution/run_process.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LspPosition {
  /** 0-based line */
  line: number;
  /** 0-based character */
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspSymbol {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspSymbol[];
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface LspServer {
  process: ChildProcess;
  /** Set once the process exits or errors, so a dead server is never reused. */
  dead?: boolean;
  nextId: number;
  pending: Map<number, PendingRequest>;
  buffer: string;
  openedFiles: Set<string>;
  workspaceUri: string;
  language: string;
  capabilities: Record<string, any>;
  diagnostics: Map<string, any[]>;
}

// ---------------------------------------------------------------------------
// Language → server config
// ---------------------------------------------------------------------------

const LANG_SERVERS: Record<string, { bins: string[]; installHint: string }> = {
  typescript: {
    bins: ["typescript-language-server"],
    installHint: "npm install -g typescript typescript-language-server",
  },
  javascript: {
    bins: ["typescript-language-server"],
    installHint: "npm install -g typescript typescript-language-server",
  },
  python: {
    bins: ["pylsp", "pyright-langserver"],
    installHint: "pip install python-lsp-server  (or: npm install -g pyright)",
  },
  rust: {
    bins: ["rust-analyzer"],
    installHint:
      "Install rust-analyzer via rustup or from https://rust-analyzer.github.io",
  },
  go: {
    bins: ["gopls"],
    installHint: "go install golang.org/x/tools/gopls@latest",
  },
};

export const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
};

// SymbolKind number → human-readable label
export const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter",
};

// ---------------------------------------------------------------------------
// LspManager singleton
// ---------------------------------------------------------------------------

class LspManager {
  private servers = new Map<string, LspServer>();

  constructor() {
    // LSP servers (rust-analyzer, gopls, tsserver, …) are long-lived children.
    // Without cleanup they outlive the harness process. Kill them on shutdown.
    process.once("exit", () => this.killAll());
    process.once("SIGINT", () => { this.killAll(); process.exit(130); });
    process.once("SIGTERM", () => { this.killAll(); process.exit(143); });
  }

  /** Synchronously terminate every tracked server + its child tree. Shutdown path. */
  private killAll(): void {
    for (const [key, server] of this.servers) {
      this.servers.delete(key);
      const pid = server.process.pid;
      if (pid == null) continue;
      try {
        if (process.platform === "win32") execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
        else process.kill(-pid, "SIGKILL");
      } catch {
        try { server.process.kill(); } catch { /* already gone */ }
      }
    }
  }

  // ── Language helpers ──────────────────────────────────────────────────────

  detectLanguage(filePath: string): string | null {
    return EXT_TO_LANG[path.extname(filePath).toLowerCase()] ?? null;
  }

  /** Resolve the first available binary for a language. */
  private findBinary(language: string): string | null {
    const isWindows = process.platform === "win32";
    const config = LANG_SERVERS[language];
    if (!config) return null;

    for (const bin of config.bins) {
      const candidates = isWindows ? [bin + ".cmd", bin + ".ps1", bin] : [bin];
      for (const candidate of candidates) {
        try {
          execSync(isWindows ? `where ${candidate}` : `which ${candidate}`, {
            stdio: "ignore",
          });
          return candidate;
        } catch {
          /* not on PATH, try next */
        }
      }
    }
    return null;
  }

  getInstallHint(language: string): string {
    return (
      LANG_SERVERS[language]?.installHint ??
      `No LSP server known for '${language}'`
    );
  }

  // ── Server lifecycle ──────────────────────────────────────────────────────

  async getOrCreate(
    language: string,
    workspaceRoot: string,
  ): Promise<LspServer> {
    const key = `${language}:${workspaceRoot}`;
    const existing = this.servers.get(key);
    // `process.killed` is only true after an explicit .kill() — a server that
    // crashed on its own reports killed=false, so we track a `dead` flag instead
    // and evict it, otherwise every later request hangs until its timeout.
    if (existing && !existing.dead) return existing;
    if (existing) this.servers.delete(key);

    if (!LANG_SERVERS[language]) {
      throw new Error(
        `Language '${language}' is not supported. ` +
          `Supported: ${Object.keys(LANG_SERVERS).join(", ")}`,
      );
    }

    const bin = this.findBinary(language);
    if (!bin) {
      throw new Error(
        `No server binary for '${language}'. ${this.getInstallHint(language)}`,
      );
    }

    const server = await this.spawnServer(bin, language, workspaceRoot);
    this.servers.set(key, server);
    return server;
  }

  private spawnServer(
    bin: string,
    language: string,
    workspaceRoot: string,
  ): Promise<LspServer> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32";
      const key = `${language}:${workspaceRoot}`;
      const args =
        language === "typescript" || language === "javascript"
          ? ["--stdio"]
          : [];

      const proc = spawn(bin, args, {
        cwd: workspaceRoot,
        stdio: ["pipe", "pipe", "pipe"],
        shell: isWindows,
      });

      const server: LspServer = {
        process: proc,
        nextId: 1,
        pending: new Map(),
        buffer: "",
        openedFiles: new Set(),
        workspaceUri: pathToUri(workspaceRoot),
        language,
        capabilities: {},
        diagnostics: new Map(),
      };

      proc.stdout!.on("data", (chunk: Buffer) => {
        server.buffer += chunk.toString("utf8");
        this.drainBuffer(server);
      });

      proc.stderr!.on("data", () => {
        /* suppress LSP server debug output */
      });

      proc.on("error", (err) => {
        server.dead = true;
        if (this.servers.get(key) === server) this.servers.delete(key);
        const hint = this.getInstallHint(language);
        const msg = `LSP server '${bin}' failed to start: ${err.message}. Install: ${hint}`;
        reject(new Error(msg));
        this.rejectAll(server, new Error(msg));
      });

      proc.on("exit", (code) => {
        // Mark dead and evict so getOrCreate spawns a fresh server next time
        // instead of handing back a corpse whose requests will only ever time out.
        server.dead = true;
        if (this.servers.get(key) === server) this.servers.delete(key);
        this.rejectAll(
          server,
          new Error(`LSP server exited with code ${code}`),
        );
      });

      // Initialize
      this.sendInitialize(server, workspaceRoot)
        .then(() => resolve(server))
        .catch((e) => {
          server.dead = true;
          if (this.servers.get(key) === server) this.servers.delete(key);
          killTree(proc); // shell:true wraps the server in cmd.exe on Windows — kill the tree
          reject(e);
        });
    });
  }

  private rejectAll(server: LspServer, err: Error): void {
    for (const { reject, timer } of server.pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    server.pending.clear();
  }

  // ── JSON-RPC transport ────────────────────────────────────────────────────

  private drainBuffer(server: LspServer): void {
    while (true) {
      const headerEnd = server.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = server.buffer.slice(0, headerEnd);
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        // Malformed header — skip past it
        server.buffer = server.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;

      if (server.buffer.length < bodyStart + contentLength) return; // wait for more data

      const body = server.buffer.slice(bodyStart, bodyStart + contentLength);
      server.buffer = server.buffer.slice(bodyStart + contentLength);

      try {
        const msg: any = JSON.parse(body);
        if (msg.id !== undefined && server.pending.has(msg.id)) {
          const { resolve, reject, timer } = server.pending.get(msg.id)!;
          server.pending.delete(msg.id);
          clearTimeout(timer);
          if (msg.error) {
            reject(new Error(`LSP ${msg.error.code}: ${msg.error.message}`));
          } else {
            resolve(msg.result);
          }
        } else if (msg.method === "textDocument/publishDiagnostics") {
          server.diagnostics.set(
            msg.params?.uri,
            msg.params?.diagnostics ?? [],
          );
        }
        // Notifications (no id) — ignored
      } catch {
        // Malformed JSON — ignore
      }
    }
  }

  private write(server: LspServer, msg: object): void {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
    server.process.stdin!.write(header + body);
  }

  request<T = unknown>(
    server: LspServer,
    method: string,
    params: unknown,
    timeoutMs = 20_000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = server.nextId++;
      const timer = setTimeout(() => {
        server.pending.delete(id);
        reject(
          new Error(`LSP '${method}' timed out after ${timeoutMs / 1000}s`),
        );
      }, timeoutMs);

      server.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this.write(server, { jsonrpc: "2.0", id, method, params });
    });
  }

  notify(server: LspServer, method: string, params: unknown): void {
    this.write(server, { jsonrpc: "2.0", method, params });
  }

  // ── LSP handshake ─────────────────────────────────────────────────────────

  private async sendInitialize(
    server: LspServer,
    workspaceRoot: string,
  ): Promise<void> {
    const initialized: any = await this.request(
      server,
      "initialize",
      {
        processId: process.pid,
        clientInfo: { name: "studio-harness", version: "1.0.0" },
        rootUri: server.workspaceUri,
        capabilities: {
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: false,
            },
            definition: { linkSupport: false },
            references: { dynamicRegistration: false },
            hover: {
              dynamicRegistration: false,
              contentFormat: ["plaintext", "markdown"],
            },
            documentSymbol: {
              dynamicRegistration: false,
              hierarchicalDocumentSymbolSupport: true,
            },
            implementation: { dynamicRegistration: false, linkSupport: false },
            declaration: { dynamicRegistration: false, linkSupport: false },
            typeDefinition: { dynamicRegistration: false, linkSupport: false },
            callHierarchy: { dynamicRegistration: false },
            signatureHelp: { dynamicRegistration: false },
            rename: { dynamicRegistration: false, prepareSupport: true },
            codeAction: {
              dynamicRegistration: false,
              resolveSupport: { properties: ["edit"] },
            },
            formatting: { dynamicRegistration: false },
            rangeFormatting: { dynamicRegistration: false },
            semanticTokens: {
              dynamicRegistration: false,
              requests: { range: true, full: false },
              tokenTypes: [],
              tokenModifiers: [],
              formats: ["relative"],
            },
            inlayHint: {
              dynamicRegistration: false,
              resolveSupport: {
                properties: [
                  "tooltip",
                  "textEdits",
                  "label.tooltip",
                  "label.location",
                  "label.command",
                ],
              },
            },
          },
          workspace: {
            symbol: { dynamicRegistration: false },
            workspaceFolders: true,
          },
        },
        workspaceFolders: [
          { uri: server.workspaceUri, name: path.basename(workspaceRoot) },
        ],
      },
      30_000,
    );

    server.capabilities = initialized?.capabilities ?? {};

    this.notify(server, "initialized", {});
  }

  // ── File management ───────────────────────────────────────────────────────

  async ensureFileOpen(server: LspServer, filePath: string): Promise<string> {
    const uri = pathToUri(filePath);
    if (!server.openedFiles.has(uri)) {
      const text = await readFile(filePath, "utf8");
      this.notify(server, "textDocument/didOpen", {
        textDocument: {
          uri,
          languageId:
            server.language === "typescript" ? "typescript" : server.language,
          version: 1,
          text,
        },
      });
      server.openedFiles.add(uri);
      // Small delay so the server can index the file
      await new Promise<void>((r) => setTimeout(r, 500));
    }
    return uri;
  }

  async syncFile(server: LspServer, filePath: string): Promise<void> {
    const uri = pathToUri(filePath);
    const text = await readFile(filePath, "utf8");
    if (!server.openedFiles.has(uri)) {
      await this.ensureFileOpen(server, filePath);
      return;
    }
    this.notify(server, "textDocument/didChange", {
      textDocument: { uri, version: Date.now() },
      contentChanges: [{ text }],
    });
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  terminate(language: string, workspaceRoot: string): void {
    const key = `${language}:${workspaceRoot}`;
    const server = this.servers.get(key);
    if (server) {
      server.dead = true;
      // killTree, not process.kill: on Windows the server runs under a cmd.exe
      // wrapper (shell:true), so a bare kill would orphan the real server.
      try { killTree(server.process); } catch { /* already gone */ }
      this.servers.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Path ↔ URI helpers
// ---------------------------------------------------------------------------

export function pathToUri(filePath: string): string {
  // Already a URI? leave it. Otherwise let Node percent-encode spaces/non-ASCII
  // and handle Windows drive letters — a hand-rolled string join does neither,
  // which breaks every location + edit under a path containing a space.
  if (/^[a-z]+:\/\//i.test(filePath)) return filePath;
  try {
    return pathToFileURL(filePath).href;
  } catch {
    return filePath;
  }
}

export function uriToPath(uri: string): string {
  if (!uri.startsWith("file:")) return uri;
  try {
    return fileURLToPath(uri); // percent-decodes and resolves Windows/UNC paths
  } catch {
    return uri;
  }
}

// ---------------------------------------------------------------------------
// Export singleton
// ---------------------------------------------------------------------------

export const lspManager = new LspManager();
