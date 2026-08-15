/**
 * What a git subcommand does, for the permission system to decide about.
 *
 * Classification, not restriction. An unknown subcommand still runs — it is
 * simply treated as one that changes something, so it asks rather than
 * proceeding silently. Failing safe without failing closed is the whole point:
 * git gains subcommands, and a list that has to be complete to be correct is a
 * list that is wrong the day after it is written.
 */

export type GitAccess =
  /** Observes the repository. */
  | "read"
  /** Changes the repository or the working tree. */
  | "write"
  /** Talks to a remote. */
  | "network";

const READ: readonly string[] = [
  "status", "log", "diff", "show", "blame", "reflog", "shortlog", "describe",
  "rev-parse", "rev-list", "cat-file", "ls-files", "ls-tree", "grep",
  "whatchanged", "count-objects", "verify-commit", "verify-tag", "annotate",
  "check-ignore", "check-attr", "check-mailmap", "merge-base", "name-rev",
  "symbolic-ref", "var", "version", "help",
];

/**
 * Exported so a test can hold this list against the copy in
 * `permissions/policy.ts`, which cannot import it — permissions must not depend
 * on tools. The duplication is deliberate and stays; what was missing was
 * anything that notices when the two stop agreeing. See meta-task #78.
 */
export const NETWORK: readonly string[] = [
  "fetch", "pull", "push", "clone", "ls-remote", "remote", "submodule",
  "request-pull", "send-pack", "fetch-pack",
];

/**
 * Subcommands that both read and write depending on how they are called.
 *
 * Treated as writing. `git config --get` only reads, but distinguishing that
 * from `git config --global user.email` needs argument analysis we would have
 * to keep in step with git forever, and being asked once about a read is a
 * far smaller cost than a silent write.
 */
const AMBIGUOUS: readonly string[] = ["config", "branch", "tag", "stash", "notes", "bisect"];

export function classifyGit(subcommand: string): GitAccess {
  if (NETWORK.includes(subcommand)) return "network";
  if (AMBIGUOUS.includes(subcommand)) return "write";
  if (READ.includes(subcommand)) return "read";
  return "write";
}

/** True when we recognise the subcommand as a real git command. */
export function isKnownSubcommand(subcommand: string): boolean {
  return (
    READ.includes(subcommand) ||
    NETWORK.includes(subcommand) ||
    AMBIGUOUS.includes(subcommand) ||
    WRITE.includes(subcommand)
  );
}

const WRITE: readonly string[] = [
  "add", "commit", "merge", "rebase", "reset", "restore", "checkout", "switch",
  "cherry-pick", "revert", "rm", "mv", "clean", "apply", "am", "format-patch",
  "worktree", "init", "gc", "prune", "repack", "update-ref", "update-index",
  "write-tree", "read-tree", "commit-tree", "hash-object", "mktree", "replace",
  "rerere", "sparse-checkout", "maintenance", "fsck",
];

/**
 * The resource a permission rule matches against.
 *
 * `git:push`, `git:log` — the command kind, not its arguments. Including the
 * arguments would make every commit a distinct resource, so "always allow
 * commits" could never be expressed and the user would be asked forever.
 */
export function gitResource(subcommand: string): string {
  return `git:${subcommand}`;
}
