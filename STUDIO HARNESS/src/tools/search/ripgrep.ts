import { relative } from "node:path";

import { runProcess } from "../../process/exec.js";
import { resolveBinary } from "../../vendor/resolver.js";
import { ToolError } from "../errors.js";

/**
 * The ripgrep substrate.
 *
 * Every flag ripgrep receives is chosen here, from structured parameters. The
 * model supplies values — a pattern, a glob, a line count — and never a flag,
 * so there is no argument it can send that becomes an option. That is what
 * keeps search a `read` capability rather than an `execute` one: this spawns a
 * process, but the process is a fixed program with an argument vector we built
 * (ADR 0013).
 *
 * The two flags that would break that guarantee are deliberately unreachable:
 * `--pre` and `--hostname-bin` make ripgrep run an arbitrary command, and
 * nothing here can produce either.
 */

/**
 * Directories excluded unless the caller asks for them.
 *
 * ripgrep already respects `.gitignore`, but a dependency directory that is not
 * ignored — a fresh checkout, a project without a gitignore — would otherwise
 * be the first thing a search returns, and tens of thousands of vendored files
 * fill a context window with nothing the agent asked about.
 */
export const DEFAULT_EXCLUDES = [
  "!node_modules",
  "!.git",
  "!dist",
  "!build",
  "!.next",
  "!target",
  "!vendor",
] as const;

/**
 * Encodes an option and its value as one argument.
 *
 * `--glob=<value>` rather than `--glob <value>`, for every value that came from
 * the model. With a separate argument, a value beginning with `-` depends on
 * ripgrep's own parser to be read as a value rather than as the next option;
 * with `=`, everything after the equals sign is the value and there is nothing
 * left to interpret. The guarantee should not rest on a third party's argument
 * parser.
 */
function option(name: string, value: string): string {
  return `${name}=${value}`;
}

export type SearchOutputMode = "files" | "content" | "count";

export interface SearchArgsInput {
  readonly pattern: string;
  readonly searchPath: string;
  readonly outputMode: SearchOutputMode;
  readonly glob: string | undefined;
  readonly type: string | undefined;
  readonly caseInsensitive: boolean;
  readonly multiline: boolean;
  readonly contextBefore: number;
  readonly contextAfter: number;
  readonly includeIgnored: boolean;
}

export interface FilesArgsInput {
  readonly pattern: string;
  readonly searchPath: string;
  readonly includeIgnored: boolean;
}

/**
 * Builds the argument vector for a content search.
 *
 * Pure, and tested as such: this is where a mistake would silently widen what
 * ripgrep does, and an argument vector is far easier to assert on than the
 * behaviour it produces.
 */
export function buildSearchArgs(input: SearchArgsInput): string[] {
  const args: string[] = ["--color", "never"];

  if (input.outputMode === "files") args.push("--files-with-matches");
  else if (input.outputMode === "count") args.push("--count-matches");
  // JSON rather than `path:line:text`: a Windows path contains a colon, so the
  // plain format cannot be parsed unambiguously.
  else args.push("--json");

  if (input.caseInsensitive) args.push("--ignore-case");
  if (input.multiline) args.push("--multiline", "--multiline-dotall");

  if (input.outputMode === "content") {
    if (input.contextBefore > 0) args.push(option("--before-context", String(input.contextBefore)));
    if (input.contextAfter > 0) args.push(option("--after-context", String(input.contextAfter)));
  }

  if (input.glob !== undefined) args.push(option("--glob", input.glob));
  if (input.type !== undefined) args.push(option("--type", input.type));

  args.push(...visibilityArgs(input.includeIgnored));

  // `--regexp=` rather than a positional: a pattern beginning with `-` would
  // otherwise be read as a flag.
  args.push(option("--regexp", input.pattern), "--", input.searchPath);
  return args;
}

/** Builds the argument vector for listing files by name pattern. */
export function buildFilesArgs(input: FilesArgsInput): string[] {
  const args: string[] = ["--files", "--color", "never", option("--glob", input.pattern)];

  args.push(...visibilityArgs(input.includeIgnored));

  args.push("--", input.searchPath);
  return args;
}

/**
 * What a search is allowed to see, in one place for both argument builders.
 *
 * `--hidden` always. A dotfile is not a private file: `.env.example`,
 * `.github/workflows/*`, `.eslintrc`, `.gitignore` itself are ordinary parts
 * of a project, and they used to be reachable only by also passing
 * `--no-ignore`, which drags `node_modules` back in. Answering "No files
 * matched" for a file that is sitting right there teaches the model the file
 * does not exist, and it goes on to create a second one.
 *
 * Ignore rules and the default excludes are untouched by this: a caller that
 * asked for the ignored files still gets them all, and a caller that did not
 * still gets `.git` and `node_modules` kept out. The only thing that changed
 * is that a dotfile is no longer invisible by default.
 */
function visibilityArgs(includeIgnored: boolean): string[] {
  const args = ["--hidden"];
  if (includeIgnored) {
    args.push("--no-ignore");
    return args;
  }
  for (const exclude of DEFAULT_EXCLUDES) args.push(option("--glob", exclude));
  return args;
}

export interface RipgrepMatch {
  readonly path: string;
  readonly lineNumber: number;
  readonly text: string;
  /** False for a line included only as surrounding context. */
  readonly isMatch: boolean;
}

interface JsonRecord {
  type?: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
  };
}

/**
 * Parses ripgrep's JSON stream.
 *
 * Records whose path is not valid UTF-8 arrive as bytes rather than text and
 * are skipped: a filename we cannot represent is one we cannot hand back for
 * the agent to read.
 */
export function parseMatches(stdout: string): RipgrepMatch[] {
  const matches: RipgrepMatch[] = [];

  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;

    let record: JsonRecord;
    try {
      record = JSON.parse(line) as JsonRecord;
    } catch {
      continue;
    }

    if (record.type !== "match" && record.type !== "context") continue;

    const path = record.data?.path?.text;
    const text = record.data?.lines?.text;
    const lineNumber = record.data?.line_number;
    if (path === undefined || text === undefined || lineNumber === undefined) continue;

    matches.push({
      path,
      lineNumber,
      text: text.replace(/\r?\n$/, ""),
      isMatch: record.type === "match",
    });
  }

  return matches;
}

/** Turns absolute results back into project-relative paths. */
export function toRelative(root: string, path: string): string {
  const result = relative(root, path);
  return result === "" ? "." : result.replaceAll("\\", "/");
}

export interface RipgrepRun {
  readonly stdout: string;
  /** True when ripgrep found nothing, which is exit code 1 and not a failure. */
  readonly empty: boolean;
}

export async function runRipgrep(
  args: readonly string[],
  options: { cwd: string; signal?: AbortSignal },
): Promise<RipgrepRun> {
  const binary = resolveBinary("rg");

  const result = await runProcess({
    executable: binary.path,
    args,
    cwd: options.cwd,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  // ripgrep exits 1 for "no matches" and 2 for a real error. Treating 1 as a
  // failure would report every empty search as broken.
  if (result.exitCode === 1) return { stdout: "", empty: true };

  if (result.exitCode !== 0) {
    throw new ToolError("invalid_input", {
      message:
        result.stderr.trim() === ""
          ? "The search could not be run."
          : `The search was rejected: ${result.stderr.trim().split("\n")[0]}`,
    });
  }

  return { stdout: result.stdout, empty: result.stdout.trim() === "" };
}
