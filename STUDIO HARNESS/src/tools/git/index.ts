import type { CapabilityDescriptor } from "../../contracts/capabilities.js";
import { runProcess } from "../../process/exec.js";
import { resolveBinary } from "../../vendor/resolver.js";
import { ToolError } from "../errors.js";
import type { CallGate } from "../gate.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import { buildGitArgs } from "./argv.js";
import { classifyGit, gitResource, isKnownSubcommand } from "./classify.js";

export { buildGitArgs, optionName } from "./argv.js";
export { classifyGit, gitResource, isKnownSubcommand } from "./classify.js";

/**
 * Git, as one capability with complete subcommand coverage.
 *
 * Not `git_status` + `git_diff` + `git_log`: that would be a dozen tools, a
 * dozen permission surfaces, and a dozen places to keep consistent, for one
 * capability. Permission granularity comes from the resource (`git:push` versus
 * `git:log`), which is what the argument-level matching in the kernel is for.
 *
 * Effects are `read` and `write`, not `execute` or `network`, and that is the
 * substrate rule from ADR 0013 applied consistently: running a known binary
 * with an argument vector we built is not arbitrary execution, and git talking
 * to a remote is not the agent opening a socket. What governs `git push` is
 * *permission* — a rule on `git:push` — rather than isolation, because
 * isolation exists to contain code we did not write.
 */

/** Output beyond this is a repository dump, not an answer. */
const MAX_OUTPUT_LINES = 400;

export interface GitInput {
  readonly subcommand: string;
  readonly args: readonly string[];
}

export const GIT_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "git" },
  title: "Run git",
  description:
    "Runs a git command in the project. Supply the subcommand and its arguments separately, " +
    "for example subcommand \"log\" with args [\"--oneline\", \"-n\", \"20\"]. " +
    "Arguments are passed directly to git; no shell is involved.",
  effects: ["read", "write"],
  provenance: { origin: "native", sourceId: "project-studio", trusted: true },
  // `git commit` twice makes two commits; `git push` twice is a no-op. The
  // capability as a whole cannot promise a safe retry.
  idempotent: false,
};

/**
 * How far an alias chain is followed before we give up and refuse.
 *
 * Git's own limit is the same idea: an alias that never lands on a real
 * subcommand is a loop, and a loop is not something to keep resolving.
 */
const MAX_ALIAS_DEPTH = 10;

/**
 * Refuses a subcommand that resolves to a shell alias.
 *
 * A repository's own config can define `alias.x = !sh -c '…'`, which would make
 * "every subcommand is allowed" mean "every command is allowed". Git ignores
 * aliases that shadow built-in commands, so only an unrecognised subcommand can
 * possibly be one — which is also why this costs an extra git call almost
 * never.
 *
 * **Aliases chain.** `alias.a = b` with `alias.b = !sh` runs the shell, because
 * git expands the result again. Reading one level therefore proves nothing:
 * level one is a plain word, and the shell is at level two. So follow the chain
 * to its end.
 *
 * The expansion's own arguments are checked too. `alias.a = log --upload-pack=sh`
 * would otherwise reach a blocked option by a route that never passes through
 * `buildGitArgs`, since the caller only ever typed `a`.
 */
async function assertNotShellAlias(
  executable: string,
  cwd: string,
  subcommand: string,
): Promise<void> {
  const seen = new Set<string>();
  let current = subcommand;

  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
    if (isKnownSubcommand(current)) return;
    if (seen.has(current)) {
      throw new ToolError("invalid_input", {
        message: `git ${subcommand} is an alias that refers back to itself, and cannot run.`,
      });
    }
    seen.add(current);

    const result = await runProcess({
      executable,
      args: ["config", "--get", `alias.${current}`],
      cwd,
      timeoutMs: 10_000,
    });

    // Not an alias and not a known subcommand: git will reject it itself, and
    // its own message says more than ours would.
    if (result.exitCode !== 0) return;

    const expansion = result.stdout.trim();
    if (expansion.startsWith("!")) {
      throw new ToolError("invalid_input", {
        message: `git ${subcommand} is an alias that runs a shell command, and is not available.`,
      });
    }

    const tokens = expansion.split(/\s+/).filter((token) => token !== "");
    if (tokens.length === 0) return;

    // Whitespace splitting is coarse for a shell-quoted string, but it cannot
    // hide an option name: a blocked option that survives git's own parsing has
    // to appear as its own word here too.
    const head = tokens[0] as string;
    if (head.startsWith("-")) {
      // An expansion that begins with an option adds arguments to whatever the
      // caller wrote. There is no further name to follow.
      buildGitArgs({ subcommand: "log", args: tokens });
      return;
    }

    // Validated as a command so the expansion is held to every rule the caller
    // is held to, blocked subcommands included.
    buildGitArgs({ subcommand: head, args: tokens.slice(1) });
    current = head;
  }

  throw new ToolError("invalid_input", {
    message: `git ${subcommand} is an alias chain too long to follow, and is not available.`,
  });
}

function clip(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_OUTPUT_LINES) return output;

  return [
    ...lines.slice(0, MAX_OUTPUT_LINES),
    `\n[showing ${MAX_OUTPUT_LINES} of ${lines.length} lines; narrow the command for more]`,
  ].join("\n");
}

export function createGitTool(): ToolDefinition<GitInput, string> {
  return defineStudioTool({
    descriptor: GIT_DESCRIPTOR,
    resourceKind: "command",

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;

      if (typeof value.subcommand !== "string" || value.subcommand.trim() === "") {
        throw new ToolError("invalid_input", {
          message: "subcommand is required, for example \"status\".",
        });
      }
      if (value.args !== undefined && !Array.isArray(value.args)) {
        throw new ToolError("invalid_input", {
          message: "args must be a list of separate arguments, not one string.",
        });
      }

      const args = (value.args ?? []) as unknown[];
      for (const argument of args) {
        if (typeof argument !== "string") {
          throw new ToolError("invalid_input", {
            message: "Every git argument must be text.",
          });
        }
      }

      // Validated here so a refused option fails before authorization, and the
      // user is never asked to approve something that cannot run.
      buildGitArgs({ subcommand: value.subcommand, args: args as string[] });

      const parsed: GitInput = {
        subcommand: value.subcommand,
        args: args as readonly string[],
      };
      return parsed;
    },

    resource: (input) => gitResource(input.subcommand),

    execute: async (input, context) => {
      const binary = resolveBinary("git");
      const cwd = context.sandbox.policy.workspaceRoot;

      await assertNotShellAlias(binary.path, cwd, input.subcommand);

      const result = await runProcess({
        executable: binary.path,
        args: buildGitArgs(input),
        cwd,
        ...(context.signal ? { signal: context.signal } : {}),
      });

      // git exits non-zero for ordinary outcomes — 1 from `diff --quiet` means
      // "there are differences" — so the exit code is reported rather than
      // thrown, and the model decides what it meant.
      if (result.exitCode !== 0) {
        const detail = (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
        return clip(
          `git ${input.subcommand} exited with code ${result.exitCode}.\n${detail}`,
        );
      }

      const output = result.stdout.trim();
      return output === ""
        ? `git ${input.subcommand} completed with no output.`
        : clip(output);
    },
  });
}

/**
 * The version-control family.
 *
 * One tool, its own folder, because unlike `read` it genuinely is several
 * modules: argument construction, classification, and the alias check each
 * change for different reasons.
 */
export function registerGitTools(gate: CallGate): void {
  gate.register(createGitTool());
}

/** Access classification, re-exported for policy authoring. */
export type { GitAccess } from "./classify.js";
