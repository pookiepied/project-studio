import { spawn } from "child_process";
import { TOOL_TIMEOUTS } from "../tool-contract.js";
import { resolveRipgrep } from "../shared/vendor.js";

// Directories that produce noise in every search - excluded automatically.
const AUTO_EXCLUDE_GLOBS = [
  "!.git/**",
  "!node_modules/**",
  "!dist/**",
  "!.next/**",
  "!build/**",
  "!.turbo/**",
  "!out/**",
  "!coverage/**",
  "!.cache/**",
  "!.nuxt/**",
  "!.output/**",
  "!__pycache__/**",
];

interface GrepArgs {
  pattern: string;
  searchPath: string;
  globFilter?: string;
  typeFilter?: string;
  outputMode: string;
  caseInsensitive: boolean;
  contextLines?: number;
  contextAfter?: number;
  contextBefore?: number;
  multiline: boolean;
  headLimit: number;
  pageOffset: number;
}

function parseArgs(args: Record<string, unknown>): GrepArgs | { error: string } {
  const pattern = args.pattern as string;
  if (!pattern) return { error: "pattern is required" };

  return {
    pattern,
    searchPath: (args.path as string) || process.cwd(),
    globFilter: args.glob as string | undefined,
    typeFilter: args.type as string | undefined,
    outputMode: (args.output_mode as string) || "files_with_matches",
    caseInsensitive: (args.case_insensitive as boolean) || false,
    contextLines: args.context_lines as number | undefined,
    contextAfter: args["-A"] as number | undefined,
    contextBefore: args["-B"] as number | undefined,
    multiline: (args.multiline as boolean) || false,
    headLimit: (args.head_limit as number) ?? 250,
    pageOffset: (args.offset as number) ?? 0,
  };
}

function pageLines(lines: string[], headLimit: number, pageOffset: number) {
  const total = lines.length;
  const paged =
    headLimit === 0
      ? lines.slice(pageOffset)
      : lines.slice(pageOffset, pageOffset + headLimit);

  return {
    matches: paged.join("\n"),
    total_results: total,
    returned: paged.length,
    offset: pageOffset,
    has_more: total > pageOffset + paged.length,
  };
}

function rgArgsFor(parsed: GrepArgs): string[] {
  const rgArgs: string[] = [];

  if (parsed.outputMode === "files_with_matches") {
    rgArgs.push("-l");
  } else if (parsed.outputMode === "count") {
    rgArgs.push("--count");
  } else {
    rgArgs.push("-n");
    if (parsed.contextAfter !== undefined) rgArgs.push("-A", String(parsed.contextAfter));
    if (parsed.contextBefore !== undefined) rgArgs.push("-B", String(parsed.contextBefore));
    if (parsed.contextLines !== undefined) rgArgs.push("-C", String(parsed.contextLines));
  }

  if (parsed.caseInsensitive) rgArgs.push("-i");
  if (parsed.multiline) rgArgs.push("-U", "--multiline-dotall");
  if (parsed.typeFilter) rgArgs.push("--type", parsed.typeFilter);
  if (parsed.globFilter) rgArgs.push("-g", parsed.globFilter);

  for (const excl of AUTO_EXCLUDE_GLOBS) {
    rgArgs.push("-g", excl);
  }

  rgArgs.push(parsed.pattern, parsed.searchPath);
  return rgArgs;
}

// Search always runs real ripgrep — the bundled binary (vendor/) or, failing
// that, `rg` on PATH. There is deliberately no pure-JS fallback: a JS
// re-implementation diverges from ripgrep (e.g. it can't honor .gitignore), and
// a subtly-wrong search is worse than a clear error. If ripgrep genuinely can't
// be found, we say so and point at how to fix it.
async function runRipgrep(parsed: GrepArgs): Promise<Record<string, unknown>> {
  const GREP_TIMEOUT_MS = TOOL_TIMEOUTS.LOCAL_PROCESS;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const proc = spawn(resolveRipgrep(), rgArgsFor(parsed), { stdio: "pipe" });

    function finish(result: Record<string, unknown>) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    }

    const timeoutId = setTimeout(() => {
      proc.kill();
      finish({
        matches: "",
        error:
          `Search timed out after ${GREP_TIMEOUT_MS / 1000}s. ` +
          `Narrow the search: use a more specific pattern, limit to a subdirectory, ` +
          `or add a glob or type filter.`,
        exit_code: -1,
      });
    }, GREP_TIMEOUT_MS);

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== null && code > 1) {
        finish({
          matches: "",
          error: stderr.trim() || "ripgrep error",
          exit_code: code,
        });
        return;
      }

      const allLines = stdout.trim() === "" ? [] : stdout.trim().split("\n");
      finish({
        ...pageLines(allLines, parsed.headLimit, parsed.pageOffset),
        exit_code: code,
      });
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        finish({
          matches: "",
          error:
            "ripgrep (rg) not found — the bundled binary is missing for this " +
            "platform and rg is not on PATH. Run `node scripts/vendor-sync.mjs " +
            "ripgrep` from the STUDIO root to restore it, or install ripgrep.",
          exit_code: -1,
        });
        return;
      }
      finish({
        matches: "",
        error: `ripgrep failed to start: ${err.message}`,
        exit_code: -1,
      });
    });
  });
}

export async function grepFiles(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const parsed = parseArgs(args);
  if ("error" in parsed) return { error: parsed.error };

  return runRipgrep(parsed);
}
