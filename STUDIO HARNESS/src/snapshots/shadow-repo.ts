import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { runProcess } from "../process/exec.js";
import { resolveBinary } from "../vendor/resolver.js";
import { VendorError } from "../vendor/errors.js";
import { SnapshotError } from "./errors.js";

/**
 * A git repository that watches a project from outside it.
 *
 * The git directory lives in the Studio home and the work tree is the user's
 * project, so the project gains a complete history without gaining a second
 * `.git`. That separation is the whole design:
 *
 * - the user's own `git status` never mentions us
 * - the history survives the `rm -rf` it exists to recover from
 * - a project with no git at all still gets undo
 *
 * Everything here builds an argument vector directly rather than going through
 * `tools/git/argv.ts`. That module refuses `--git-dir` and `--work-tree`
 * *from a caller*, which is correct — from the model those options are an
 * escape from the project. Here they are the mechanism, set by us, from
 * values the model cannot influence.
 */

/** Two minutes. The first `add -A` on a large project is the slow one. */
const GIT_TIMEOUT_MS = 120_000;

/**
 * A hard floor of exclusions, applied through the repository's own
 * `info/exclude`.
 *
 * `.gitignore` is the real answer and this is not a replacement for it. It
 * exists for the project that has no `.gitignore` at all, where the first
 * snapshot would otherwise try to hash every dependency on disk. Force-added
 * paths override this exactly as they override `.gitignore`, so nothing the
 * agent actually touches can be lost to it.
 */
const EXCLUDE_FLOOR = [
  "node_modules/",
  ".venv/",
  "venv/",
  "target/",
  ".next/",
  ".turbo/",
  "__pycache__/",
  "",
].join("\n");

/**
 * Repository settings we impose.
 *
 * Each one is a case where the user's own configuration would otherwise reach
 * in and break a mechanism that is supposed to be invisible.
 */
function repositoryConfig(gitDir: string): readonly (readonly [string, string])[] {
  return [
  // `git init` with `GIT_DIR` pointing somewhere with no work tree of its own
  // can land on `core.bare=true`, after which every `--work-tree` command
  // refuses to run. Set explicitly so the repository's shape does not depend
  // on how git felt about the arguments at creation time.
  ["core.bare", "false"],
  // Snapshots are not authored by a person. Without an identity git refuses to
  // commit at all, and inheriting the user's would attribute our bookkeeping
  // to them.
  ["user.name", "Project Studio"],
  ["user.email", "snapshots@project-studio.local"],
  // A user with signing on globally would otherwise have every snapshot block
  // on a passphrase prompt that has no terminal to appear in.
  ["commit.gpgsign", "false"],
  ["tag.gpgsign", "false"],
  // Byte-exact restore. Line-ending translation would rewrite files we are
  // meant to return unchanged.
  ["core.autocrlf", "false"],
  ["core.safecrlf", "false"],
  // Hooks live in the git directory, so the project's own hooks are already
  // out of reach — but a global `core.hooksPath` would pull them back in.
  ["core.hooksPath", join(gitDir, "no-hooks")],
  ] as const;
}

export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * A stable, recognisable directory name for a project.
 *
 * The folder name alone would collide — everyone has more than one `app` — and
 * the hash alone would make the snapshot directory unbrowsable. Both together
 * are unique and still readable by a person looking for their own project.
 */
export function projectKey(workspaceRoot: string): string {
  const digest = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12);
  const name = basename(workspaceRoot).replace(/[^a-zA-Z0-9._-]/g, "-") || "project";
  return `${name}-${digest}`;
}

export interface ShadowRepositoryOptions {
  readonly workspaceRoot: string;
  /** The git directory. One per project, under `~/.studio/data/snapshots`. */
  readonly gitDir: string;
}

export class ShadowRepository {
  readonly workspaceRoot: string;
  readonly gitDir: string;
  #git: string | undefined;
  #initialized = false;
  /**
   * A queue of one.
   *
   * Git keeps a single index per repository and locks it with `index.lock`, so
   * two overlapping `add` or `commit` runs do not interleave — one of them
   * simply fails. Three callers can overlap: a new turn clears the pending
   * capture while the old one is still running, `restore` captures before it
   * restores, and the gate admits eight calls at once.
   *
   * The result was an undo point that silently did not exist, or under Full
   * Auto a write refused for a reason unrelated to the write. So every command
   * joins one chain. See `T-17`.
   */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: ShadowRepositoryOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.gitDir = options.gitDir;
  }

  /**
   * Runs a whole operation with the repository to itself.
   *
   * The unit is the operation, not the command. A capture is `add`, then
   * `commit`, then `rev-parse`, and a second capture starting between the
   * `add` and the `commit` would fold two states into one snapshot — which
   * `index.lock` does not prevent, because each individual command succeeds.
   *
   * Not re-entrant: `work` must call `run` and `expect`, never `transaction`.
   * A nested call would wait for the outer one and neither would finish.
   *
   * The chain records completion rather than success. A failed capture must
   * not stop the next one from being attempted, which a rejected link would do.
   */
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(work, work);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Locates git, once.
   *
   * Raised as `unavailable` rather than passed through as a `VendorError`
   * because the caller's decision differs: a missing search binary is a broken
   * install, a missing git means undo is off and work can still continue.
   */
  #executable(): string {
    if (this.#git !== undefined) return this.#git;

    try {
      this.#git = resolveBinary("git").path;
      return this.#git;
    } catch (error) {
      if (error instanceof VendorError) {
        throw new SnapshotError("unavailable", { cause: error });
      }
      throw error;
    }
  }

  /** Runs git against this repository. Non-zero exit is returned, not thrown. */
  async run(args: readonly string[], signal?: AbortSignal): Promise<GitResult> {
    return runProcess({
      executable: this.#executable(),
      args: [
        `--git-dir=${this.gitDir}`,
        `--work-tree=${this.workspaceRoot}`,
        "--no-pager",
        "-c",
        "core.quotepath=false",
        ...args,
      ],
      cwd: this.workspaceRoot,
      timeoutMs: GIT_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
  }

  /** Runs git and treats a non-zero exit as the given failure. */
  async expect(
    args: readonly string[],
    kind: "store_failed" | "capture_failed" | "restore_failed",
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.run(args, signal);
    if (result.exitCode !== 0) {
      const detail = (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
      throw new SnapshotError(kind, {
        message: `git ${args[0] ?? ""} failed: ${detail}`,
      });
    }
    return result.stdout;
  }

  /**
   * Creates the repository if it is not there, and applies our settings.
   *
   * Settings are reapplied on every open rather than only at creation. A
   * repository created by an older build would otherwise keep whatever
   * defaults that build chose, and the failure would appear much later as a
   * snapshot that silently hangs on a signing prompt.
   */
  async ensure(signal?: AbortSignal): Promise<void> {
    if (this.#initialized) return;

    try {
      mkdirSync(this.gitDir, { recursive: true });
      mkdirSync(join(this.gitDir, "info"), { recursive: true });
    } catch (error) {
      throw new SnapshotError("store_failed", { cause: error });
    }

    const head = await this.run(["rev-parse", "--git-dir"], signal);
    if (head.exitCode !== 0) {
      await this.expect(["init", "--quiet"], "store_failed", signal);
    }

    const excludePath = join(this.gitDir, "info", "exclude");
    try {
      let existing: string | undefined;
      try {
        existing = readFileSync(excludePath, "utf8");
      } catch {}
      if (existing !== EXCLUDE_FLOOR) {
        writeFileSync(excludePath, EXCLUDE_FLOOR, "utf8");
      }
    } catch (error) {
      throw new SnapshotError("store_failed", { cause: error });
    }

    for (const [key, value] of repositoryConfig(this.gitDir)) {
      await this.expect(["config", key, value], "store_failed", signal);
    }

    this.#initialized = true;
  }
}
