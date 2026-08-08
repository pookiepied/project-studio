import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { ensureDirectory, snapshotsDirectory } from "../platform/paths.js";
import { SnapshotError } from "./errors.js";
import { projectKey, ShadowRepository } from "./shadow-repo.js";

/**
 * The undo history for one project.
 *
 * There is deliberately no table for this. The shadow repository's own log
 * *is* the record, so a snapshot cannot exist in the database but not on disk,
 * or the reverse. A second source of truth here would need reconciling, and
 * the thing it would be reconciling is a recovery mechanism — the one place a
 * disagreement is least affordable.
 */

/** A point the project can be returned to. */
export interface Snapshot {
  /** The commit id in the shadow repository. */
  readonly id: string;
  readonly label: string;
  readonly takenAt: number;
}

export interface SnapshotStoreOptions {
  readonly workspaceRoot: string;
  /** Overrides where shadow repositories live. Tests use this. */
  readonly root?: string;
}

/**
 * Splits git's NUL-separated output.
 *
 * `-z` rather than newlines because a filename may legally contain one, and a
 * restore that mis-parses a filename deletes the wrong file.
 */
function splitNul(output: string): string[] {
  return output.split("\0").filter((entry) => entry !== "");
}

export class SnapshotStore {
  readonly workspaceRoot: string;
  readonly #repo: ShadowRepository;
  /**
   * Paths the agent has touched, so they can be force-added past `.gitignore`.
   *
   * Only needed until a path is first committed: once tracked, git updates it
   * on every `add --all` regardless of ignore rules. So this set covers the
   * gap between "the agent created an ignored file" and "the next snapshot
   * recorded it", and the shadow index carries it from then on — including
   * across a restart, which is why this does not need persisting.
   */
  readonly #touched = new Set<string>();

  constructor(options: SnapshotStoreOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    const root = options.root ?? snapshotsDirectory();
    this.#repo = new ShadowRepository({
      workspaceRoot: this.workspaceRoot,
      gitDir: join(ensureDirectory(root), projectKey(this.workspaceRoot)),
    });
  }

  /** Where this project's history is kept. */
  get location(): string {
    return this.#repo.gitDir;
  }

  /**
   * Records a path as agent-touched.
   *
   * Absolute, and inside the workspace, or ignored. A path outside the project
   * cannot be force-added into a repository whose work tree is the project, and
   * quietly trying would produce a confusing git failure rather than a no-op.
   */
  markTouched(path: string): void {
    if (!isAbsolute(path)) return;
    const relativePath = relative(this.workspaceRoot, path);
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return;
    }
    this.#touched.add(relativePath.split(sep).join("/"));
  }

  /**
   * Records the project as it is right now.
   *
   * Empty snapshots are allowed. The alternative — skipping a commit when
   * nothing changed — makes the history disagree with the trigger, so "the
   * point before turn 12" would sometimes not exist and the caller would have
   * to reason about why.
   */
  async capture(label: string, signal?: AbortSignal): Promise<Snapshot> {
    return this.#repo.transaction(() => this.#capture(label, signal));
  }

  /**
   * The capture itself, without taking the lock.
   *
   * Split out because `restore` has to capture *inside* its own transaction —
   * an undo point taken under a separate lock could have another turn's write
   * land between it and the restore it exists to protect.
   */
  async #capture(label: string, signal?: AbortSignal): Promise<Snapshot> {
    await this.#repo.ensure(signal);

    await this.#repo.expect(["add", "--all", "--", "."], "capture_failed", signal);

    // Ignored files the agent made. Filtered to what exists, because
    // `--force` on a path that was never created fails the whole call, and a
    // path that was created and then deleted is already tracked, so the
    // `add --all` above recorded its removal.
    const present = [...this.#touched].filter((entry) =>
      existsSync(join(this.workspaceRoot, entry)),
    );
    if (present.length > 0) {
      await this.#repo.expect(
        ["add", "--force", "--", ...present],
        "capture_failed",
        signal,
      );
    }

    await this.#repo.expect(
      ["commit", "--quiet", "--allow-empty", "--message", label],
      "capture_failed",
      signal,
    );

    const id = (
      await this.#repo.expect(["rev-parse", "HEAD"], "capture_failed", signal)
    ).trim();

    return { id, label, takenAt: Date.now() };
  }

  /** The most recent points, newest first. */
  async list(limit = 50, signal?: AbortSignal): Promise<readonly Snapshot[]> {
    return this.#repo.transaction(() => this.#list(limit, signal));
  }

  async #list(limit: number, signal?: AbortSignal): Promise<readonly Snapshot[]> {
    await this.#repo.ensure(signal);

    const result = await this.#repo.run(
      ["log", `--max-count=${limit}`, "--format=%H%x00%at%x00%s%x00"],
      signal,
    );
    // An empty history is not a failure — it is a project nothing has written
    // to yet, and `git log` reports that as a non-zero exit.
    if (result.exitCode !== 0) return [];

    const fields = splitNul(result.stdout.replace(/\n/g, ""));
    const snapshots: Snapshot[] = [];
    for (let index = 0; index + 2 < fields.length; index += 3) {
      const [id, seconds, label] = fields.slice(index, index + 3) as [
        string,
        string,
        string,
      ];
      snapshots.push({ id, label, takenAt: Number(seconds) * 1000 });
    }
    return snapshots;
  }

  /**
   * Returns the project to a recorded point.
   *
   * The current state is snapshotted first, always. Undo that cannot itself be
   * undone is a second way to lose work, and a user reaching for undo is
   * already in the situation where that matters.
   */
  async restore(id: string, signal?: AbortSignal): Promise<{ undo: Snapshot }> {
    return this.#repo.transaction(() => this.#restore(id, signal));
  }

  async #restore(id: string, signal?: AbortSignal): Promise<{ undo: Snapshot }> {
    await this.#repo.ensure(signal);

    const exists = await this.#repo.run(["cat-file", "-e", `${id}^{commit}`], signal);
    if (exists.exitCode !== 0) {
      throw new SnapshotError("unknown_snapshot", {
        message: `There is no recorded point ${id} for this project.`,
      });
    }

    // The unlocked capture: we already hold the repository, and taking it
    // again here would wait for a lock this call is holding.
    const undo = await this.#capture(`before restoring ${id.slice(0, 8)}`, signal);

    // Files that exist now and did not then. `restore` below rewrites and
    // recreates, but it has nothing to say about a file the target commit
    // never contained, so those are removed explicitly.
    const added = await this.#repo.expect(
      ["diff", "--name-only", "--diff-filter=A", "-z", id, "HEAD"],
      "restore_failed",
      signal,
    );

    await this.#repo.expect(
      ["restore", "--source", id, "--worktree", "--", "."],
      "restore_failed",
      signal,
    );

    for (const entry of splitNul(added)) {
      const target = join(this.workspaceRoot, entry);
      // Re-checked rather than trusted. This list came from git, but it drives
      // a delete, and a path traversal here removes a file outside the project.
      const inside = relative(this.workspaceRoot, target);
      if (inside.startsWith("..") || isAbsolute(inside)) continue;
      await rm(target, { force: true });
    }

    return { undo };
  }
}
