import { ToolError } from "../errors.js";

/**
 * Building git's argument vector.
 *
 * The design is inverted from the usual one: **every subcommand is allowed, and
 * a small closed set of options is refused.** An allowlist of subcommands would
 * cap what git can do, and the point of shipping git is that all of it works —
 * `bisect`, `worktree`, `notes`, `rerere`, whatever the model reaches for.
 *
 * That is safe because the danger in git is not its subcommands. It is a
 * handful of options that make *any* subcommand run an arbitrary program.
 * Allowing `git log` while allowing arbitrary flags allows everything.
 */

/**
 * Options that turn git into a way to run something else.
 *
 * Matched on the option name, so `--upload-pack=sh` is refused as surely as
 * `--upload-pack sh`.
 *
 * `-c` and `--config-env` are absent deliberately: as *git's own* options they
 * set `core.pager`, `core.editor`, or `credential.helper` and are lethal, but
 * they are only interpreted that way before the subcommand — and user arguments
 * are structurally placed after it. `git commit -c HEAD` is the subcommand's
 * own flag and means "reuse this message", so blocking it here would break a
 * real feature to prevent something already impossible.
 */
const BLOCKED_OPTIONS = new Set([
  // Run a program at the other end of a transport.
  "--upload-pack",
  "--receive-pack",
  "--exec",
  // Relocate git's own helper binaries.
  "--exec-path",
  // Plant configuration before anyone can inspect it.
  "--config",
  // Redirect what repository we are operating on. We set these ourselves for
  // snapshots; from a caller they are an escape from the project.
  "--git-dir",
  "--work-tree",
  "--namespace",
  // Run arbitrary commands over history. This is `shell` wearing a git hat, and
  // there is a `shell` tool for that, gated as execution rather than as a read.
  "--tree-filter",
  "--index-filter",
  "--parent-filter",
  "--msg-filter",
  "--commit-filter",
  "--env-filter",
  "--tag-name-filter",
]);

/** Subcommands whose whole purpose is to run a command the caller supplies. */
const BLOCKED_SUBCOMMANDS = new Set(["filter-branch"]);

/**
 * Options we always apply.
 *
 * `--no-pager` because a pager waiting for a terminal that does not exist hangs
 * until the timeout kills it. The others make output stable for parsing rather
 * than pretty for a human.
 */
const FIXED_OPTIONS = ["--no-pager", "-c", "core.quotepath=false"] as const;

const SUBCOMMAND_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The option name, with any `=value` removed. */
export function optionName(argument: string): string | undefined {
  if (!argument.startsWith("-")) return undefined;
  const equals = argument.indexOf("=");
  return equals === -1 ? argument : argument.slice(0, equals);
}

export interface GitCommand {
  readonly subcommand: string;
  readonly args: readonly string[];
}

/**
 * Validates a command and produces the argument vector to run.
 *
 * User arguments are placed *after* the subcommand, always. That ordering is
 * what makes the `-c` reasoning above hold, so it is a structural property
 * rather than a convention.
 */
export function buildGitArgs(command: GitCommand): string[] {
  if (!SUBCOMMAND_PATTERN.test(command.subcommand)) {
    throw new ToolError("invalid_input", {
      message: "The git subcommand must be a plain command name such as status or log.",
    });
  }

  if (BLOCKED_SUBCOMMANDS.has(command.subcommand)) {
    throw new ToolError("invalid_input", {
      message: `git ${command.subcommand} runs arbitrary commands over your history and is not available.`,
    });
  }

  for (const argument of command.args) {
    if (typeof argument !== "string") {
      throw new ToolError("invalid_input", { message: "Every git argument must be text." });
    }

    const name = optionName(argument);
    if (name !== undefined && BLOCKED_OPTIONS.has(name)) {
      // Named rather than silently dropped: dropping it would run a command the
      // caller did not ask for, which is worse than refusing the one they did.
      throw new ToolError("invalid_input", {
        message: `The git option ${name} can run other programs and is not available.`,
      });
    }
  }

  return [...FIXED_OPTIONS, command.subcommand, ...command.args];
}
