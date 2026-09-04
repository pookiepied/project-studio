import { existsSync } from "node:fs";
import { platform, release } from "node:os";
import { join } from "node:path";

import { interpreterStatement } from "../process/interpreter.js";
import { ISOLATION_ENFORCED } from "../sandbox/isolation/registry.js";

/**
 * The environment block.
 *
 * What the static system prompt deliberately does not contain: where this
 * conversation is working, what machine it is on, and what day it is. The
 * prompt stays byte-identical for every conversation so that it and the tool
 * array form one cached prefix; everything that varies is composed here and
 * rides on the submission instead, after that prefix.
 *
 * ---- What is computed once, and what is computed every turn ----------------
 *
 * The machine facts - platform and OS release - cannot change while the
 * process runs, so they are read at module load and never again. A per-turn
 * `os.release()` would be the same string every time, bought with a syscall.
 *
 * Everything else is read per turn, and each for its own reason. The working
 * directory is derived from the conversation, so it is different for every
 * caller and there is nothing to cache. Whether the directory is a git
 * repository can change during a conversation - the model may run `git init`
 * itself - so a value cached at the first turn would go stale in exactly the
 * case that matters. The date must be read per turn or it would be wrong for
 * any conversation that outlives midnight, which is the whole reason it is
 * here rather than in the prompt.
 *
 * ---- Why this is in the instructions, not on the message -------------------
 *
 * Carrying the block on the submission was tried first, because that keeps the
 * system prompt byte-identical and lets every conversation on the machine
 * share one cached prefix. It was reverted for a reason no cache argument
 * survives: the webview renders a user message's text verbatim into the
 * person's own chat bubble, so a block delivered that way is a block they read
 * every time they speak.
 *
 * Appending it to the instructions costs a conversation's first turn the
 * system block at full price instead of the cached rate, in the low thousands
 * of tokens, once. Nothing else changes: the tool array still sits ahead of
 * the breakpoint and stays shared, and within a conversation the block is
 * stable until the day turns.
 */

/**
 * Facts about the machine, read once.
 *
 * `release()` rather than a marketing name: it is what the platform actually
 * reports, and a wrong friendly name is worse than a correct dull one.
 */
const MACHINE = `${platform()} ${release()}`;

export interface EnvironmentFacts {
  /** The conversation's working directory, absolute. */
  readonly workspace: string;
  /** Whether that directory is inside a git repository. */
  readonly git: boolean;
  /** Today, as the machine reckons it. */
  readonly today: string;
}

/**
 * Today in ISO form.
 *
 * The local date, not UTC: the person reading the answer lives in the
 * machine's timezone, and a conversation that opens at nine in the evening
 * should not be told it is already tomorrow.
 */
export function localDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether a directory sits in a git repository.
 *
 * Walks upward, because a project conversation may be rooted well below the
 * repository root and `.git` lives only at the top. Answered by looking rather
 * than by running git: this is on the path of every submission, and spawning a
 * process per turn to learn one boolean is not a trade worth making.
 */
export function isGitRepository(directory: string): boolean {
  let current = directory;
  for (;;) {
    if (existsSync(join(current, ".git"))) return true;
    const parent = join(current, "..");
    // `join` on a root returns the root, which is the only stop condition that
    // works the same on both platforms.
    if (parent === current) return false;
    current = parent;
  }
}

export function environmentFacts(workspace: string, now: Date): EnvironmentFacts {
  return {
    workspace,
    git: isGitRepository(workspace),
    today: localDate(now),
  };
}

/**
 * The block itself.
 *
 * Written as prose with a heading rather than as a bare key-value dump,
 * because it is read by a model that was just given several thousand words of
 * prose and reads a list of colons as data to be echoed back.
 *
 * The line about the shell is the one that earns its place most often, and
 * since ADR 0046 it names the interpreter this machine actually runs - chosen
 * once in `src/process/interpreter.ts`, the same answer the shell tool uses.
 * A model told which shell it has writes that shell's syntax; a model left to
 * guess writes bash syntax on a machine whose interpreter refuses `&&`, which
 * is exactly the confusing failure the statement exists to prevent. When no
 * interpreter could be found, that is stated rather than omitted: silence
 * reads as "any syntax works".
 */
/**
 * What containment means for the commands this conversation runs.
 *
 * Added because an evaluation run read the boundary as a broken machine. A
 * model ran `tasklist`, got "The user name or password is incorrect", and
 * filed process enumeration as a defect to fix. It found no Python and listed
 * it as a missing dependency. Both were the container working exactly as
 * designed, and nothing in this block had told it there was a container - so
 * every refusal had to be explained as breakage, because that was the only
 * explanation available.
 *
 * That is a cost paid twice: the run wastes calls diagnosing the floor it is
 * standing on, and the report that comes back proposes weakening the boundary.
 * Naming it costs four lines.
 *
 * Derived from `ISOLATION_ENFORCED` rather than the platform, so this cannot
 * claim containment on a host that has none - the constant is itself derived
 * from the backend registry, so registering a backend turns this sentence on
 * by construction. Deliberately NOT `hostIsolation()`: that probe creates and
 * deletes a real AppContainer profile, and building a prose block is not a
 * reason to touch the machine's security state.
 *
 * It says what a model can act on - which failures are the boundary and not a
 * bug - and not how containment is implemented, which is ours to change.
 */
function containmentStatement(): readonly string[] {
  if (!ISOLATION_ENFORCED) return [];
  return [
    "Commands you run are contained. They can read and write your working",
    "directory and read the programs they need, and nothing else: another",
    "project, the rest of the home directory, and the machine's own",
    "installations are refused. Queries about the machine as a whole - listing",
    "processes is the usual one - are refused too.",
    "",
    "So an access denied outside your working directory is the boundary doing",
    "its job, not a broken machine, and not something to work around. A",
    "program that reads its own installation while it runs, rather than only",
    "linking system libraries, may fail for the same reason; Python is the one",
    "to expect. Say so and move on rather than diagnosing it.",
    "",
  ];
}

export function environmentBlock(facts: EnvironmentFacts): string {
  const shell = interpreterStatement();
  return [
    "# Environment",
    "",
    "This is what is true right now. It is not part of the conversation, and",
    "you do not need to repeat it back.",
    "",
    `Today is ${facts.today}.`,
    "",
    `Your working directory is ${facts.workspace}`,
    facts.git
      ? "It is inside a git repository, so the git tools will work here."
      : "It is not a git repository.",
    "",
    ...(shell === undefined
      ? [
          "This machine has no command interpreter, so the shell tool cannot",
          "run anything here.",
        ]
      : shell),
    "",
    ...containmentStatement(),
    `Machine: ${MACHINE}`,
  ].join("\n");
}
