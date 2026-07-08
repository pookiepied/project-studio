import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { TOOL_TIMEOUTS } from "../tool-contract.js";
import { runLsp } from "../lsp/index.js";
import { resolveRipgrep } from "../shared/vendor.js";

// Regex patterns for structural declarations per language family.
// Each pattern matches at the start of a line and captures a meaningful declaration.
const DECLARATION_PATTERNS: Record<string, string> = {
  // TypeScript / JavaScript / TSX / JSX
  ts: [
    "^\\s*(export\\s+)?(default\\s+)?(async\\s+)?(function\\*?|class|interface|type|enum|abstract\\s+class)\\s+\\w+",
    "^\\s*(export\\s+)?(const|let|var)\\s+\\w+\\s*[:=(]",
    "^\\s*(export\\s+default\\s+)?(async\\s+)?function\\*?\\s+\\(",
  ].join("|"),
  // Python
  py: "^(def|class|async def)\\s+\\w+",
  // Go
  go: "^func\\s+(\\(\\w+\\s+\\*?\\w+\\)\\s+)?\\w+",
  // Rust
  rs: "^(pub\\s+)?(async\\s+)?(fn|struct|enum|trait|impl|type|const|mod)\\s+\\w+",
  // Java / Kotlin
  java: "^\\s*(public|private|protected|static|final|abstract|synchronized|native|@\\w+\\s+)*(class|interface|enum|record|@interface|void|\\w+)\\s+\\w+\\s*[({]",
  // Ruby
  rb: "^(def|class|module)\\s+\\w+",
  // C / C++
  c: "^\\w[^;\\n]*\\s\\w+\\s*\\(",
};

// Map file extension → language key
const EXT_TO_PATTERN: Record<string, string> = {
  ".ts": "ts", ".tsx": "ts", ".js": "ts", ".jsx": "ts", ".mjs": "ts", ".cjs": "ts",
  ".py": "py",
  ".go": "go",
  ".rs": "rs",
  ".java": "java", ".kt": "java",
  ".rb": "rb",
  ".c": "c", ".cpp": "c", ".cc": "c", ".h": "c", ".hpp": "c",
};

async function regexOutline(filePath: string): Promise<Record<string, unknown>> {
  const ext = path.extname(filePath).toLowerCase();
  const langKey = EXT_TO_PATTERN[ext];
  const pattern = langKey ? DECLARATION_PATTERNS[langKey] : null;

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return { error: `Cannot read file: ${filePath}` };
  }
  const totalLines = raw.split("\n").length;

  if (!pattern) {
    return {
      file: filePath,
      total_lines: totalLines,
      note: `No structural pattern available for ${ext || "this file type"}. Use read_file with offset/limit to explore.`,
      declarations: [],
    };
  }

  const OUTLINE_TIMEOUT_MS = TOOL_TIMEOUTS.FAST_QUERY;

  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const proc = spawn(resolveRipgrep(), ["-n", "-e", pattern, filePath], { stdio: "pipe" });

    function finish(result: Record<string, unknown>) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    }

    const timeoutId = setTimeout(() => {
      proc.kill();
      finish({
        file: filePath,
        total_lines: totalLines,
        error: `Outline timed out after ${OUTLINE_TIMEOUT_MS / 1000}s. Try read_file with offset/limit instead.`,
      });
    }, OUTLINE_TIMEOUT_MS);

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.on("close", () => {
      const declarations = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const colonIdx = line.indexOf(":");
          const lineNum = colonIdx > -1 ? parseInt(line.slice(0, colonIdx), 10) : null;
          const text = colonIdx > -1 ? line.slice(colonIdx + 1).trim() : line.trim();
          return lineNum ? `L${lineNum}\t${text}` : text;
        });

      finish({
        file: filePath,
        total_lines: totalLines,
        method: "regex",
        declarations,
        note:
          declarations.length === 0
            ? "No top-level declarations found. File may be data/config rather than code."
            : `${declarations.length} declaration(s) found. Use read_file with offset=<L> and limit=<N> to read any section.`,
      });
    });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      // ripgrep is bundled with Studio, so this should not happen. If it does,
      // surface a clear, actionable error rather than a degraded result.
      finish({
        file: filePath,
        total_lines: totalLines,
        error:
          err.code === "ENOENT"
            ? "ripgrep (rg) not found — the bundled binary is missing for this " +
              "platform and rg is not on PATH. Run `node scripts/vendor-sync.mjs " +
              "ripgrep` from the STUDIO root to restore it, or install ripgrep."
            : `ripgrep failed to start: ${err.message}`,
      });
    });
  });
}

export async function outlineFile(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const filePath = args.file_path as string;
  const workspaceRoot = args.workspace_root as string | undefined;

  if (!filePath) return { error: "file_path is required" };

  // Attempt LSP documentSymbol first — richest output with type info and nesting
  const lspResult = await runLsp({
    operation: "documentSymbol",
    filePath,
    ...(workspaceRoot ? { workspaceRoot } : {}),
  }) as Record<string, unknown>;

  // LSP succeeded if there's no top-level error key
  if (!lspResult.error) {
    return {
      ...lspResult,
      method: "lsp",
      note: "Symbols from Language Server Protocol. Use read_file with offset and limit to read any section.",
    };
  }

  // LSP unavailable or unsupported file type — fall back to regex
  return regexOutline(filePath);
}
