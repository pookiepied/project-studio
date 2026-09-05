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

/**
 * Which of the two kinds of place this conversation is standing in.
 *
 * `conversation` - the directory belongs to this conversation and nothing
 * else. It starts empty, nobody else reads it, and it is the right place to
 * put working files.
 *
 * `project` - the directory is the person's own project, opened deliberately.
 * The files in it are theirs, they existed before this conversation, and they
 * outlive it.
 *
 * The difference decides how freely the model may write, so it is stated
 * rather than left to be inferred from a path. A model that cannot tell the
 * two apart has to treat every directory as precious, which is why an
 * evaluation run reported having no scratch space while standing in a
 * directory that was exactly that.
 */
export type WorkspaceKind = "conversation" | "project";

export interface EnvironmentFacts {
  /** The conversation's working directory, absolute. */
  readonly workspace: string;
  /** Whose directory it is, and therefore what may be written in it. */
  readonly kind: WorkspaceKind;
  /** Whether that directory is inside a git repository. */
  readonly git: boolean;
  /** Today, as the machine reckons it. */
  readonly today: string;
  /**
   * The extra roots this conversation may reach beyond its workspace.
   *
   * Paths only, no explanation of how they got there. A run that knows it can
   * write `~/.cargo` does not spend a call discovering it. Kept short - the
   * block is paid for on every conversation.
   */
  readonly extraRoots?: readonly string[];
  /**
   * The folders of the person's project, in the order they arranged them.
   *
   * Present only for a project conversation, and the first entry is the
   * working directory. Named in the block so the model learns the shape of
   * the thing it was opened into without running a command to look.
   */
  readonly projectFolders?: readonly string[];
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

export function environmentFacts(
  workspace: string,
  now: Date,
  kind: WorkspaceKind = "conversation",
  extraRoots?: readonly string[],
  projectFolders?: readonly string[],
): EnvironmentFacts {
  return {
    workspace,
    kind,
    git: isGitRepository(workspace),
    today: localDate(now),
    ...(extraRoots === undefined || extraRoots.length === 0 ? {} : { extraRoots }),
    ...(projectFolders === undefined || projectFolders.length === 0 ? {} : { projectFolders }),
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
/**
 * Whose directory this is, and what that permits.
 *
 * Added because an evaluation run reported that the harness had no scratch
 * space, while standing in a directory that is exactly that and nobody
 * else's. It was a fair reading of what it had been told: the block named a
 * path, the prompt's file guidance is written about the person's project
 * files - look before you change, do not write through the shell - and
 * nothing anywhere said which of those two it was standing in. Told only to
 * be careful, it was careful, and paid for an interpreter it could have put
 * anywhere.
 *
 * The wrong fix is a scratchpad tool. The directory is already private, it
 * already persists across turns, and `write` already writes to it. What was
 * missing was one sentence saying so.
 *
 * The two cases say opposite things on purpose. In a conversation the
 * instruction is "this is yours, use it"; in a project it is "these are
 * theirs, and a working file goes somewhere you were asked to put it".
 * Collapsing them into one careful paragraph would restore the original
 * problem, which was a model that could not tell which it was in.
 */
function workspaceStatement(kind: WorkspaceKind): readonly string[] {
  if (kind === "project") {
    return [
      "This directory is the person's project, opened deliberately. The files",
      "in it are theirs and existed before this conversation, so change them",
      "only as the task asks, and do not scatter working files through the",
      "tree. If you need somewhere to put intermediate output, ask where it",
      "should go, or use a path the person named.",
      "",
    ];
  }
  return [
    "This directory belongs to this conversation and to nothing else. It",
    "started empty, no other conversation reads it, and it persists between",
    "turns and across restarts. It is yours to work in: write intermediate",
    "files, notes, scripts and downloads here as freely as you need, and read",
    "them back later. Nothing here is the person's own work unless they put",
    "it here, so you are not disturbing anything by using it.",
    "",
    "It starts empty, which is the one thing to keep in mind: the person's own",
    "code is not here. If they want work done on a codebase they already have,",
    "say so and ask them to open it as a project, rather than rebuilding part",
    "of it here from what they have told you.",
    "",
  ];
}

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
    "What you can run is not narrow. Your commands start with no PATH, and a",
    "program you name is looked up on the machine's own PATH and granted just",
    "before the line runs - so name programs directly and they work. Real",
    "toolchains are reachable this way: on a machine that has them, node, npm,",
    "git, python and dotnet all run normally under containment. So do not",
    "conclude a tool is missing because a bare name was not found; name it and",
    "try it. What genuinely fails is narrower: a program that installs or",
    "configures itself outside your working directory, and one that reads its",
    "own data files from a protected directory.",
    "",
    "Outbound network is on, deliberately, for the same reason. Fetching a",
    "package, an API, or a file is expected and is not a workaround.",
    "",
    "One measured limitation, so you do not spend a timeout finding it. A",
    "program you run may itself run another program, but if it captures that",
    "program's output through a pipe, the call hangs until it times out and",
    "you see nothing. Writing to a file works, and so does letting the inner",
    "program inherit the outer one's output. So prefer running each program",
    "directly with its own call; when one really must launch another, have",
    "the inner one write to a file and read the file afterwards.",
    "",
  ];
}

/**
 * The person's folders, named.
 *
 * Added when a project conversation began running in the project's own
 * folders for the first time. With several roots, "your working directory"
 * is a choice someone made rather than the only place there is, so the list
 * says which one it is; and a model that can see the whole shape of what it
 * was opened into does not spend calls discovering it. One line per folder,
 * the same way the extra roots are listed. It belongs to the project branch
 * of the block and renders for no other kind.
 */
function projectFoldersStatement(facts: EnvironmentFacts): readonly string[] {
  if (facts.kind !== "project") return [];
  const folders = facts.projectFolders ?? [];
  if (folders.length === 0) return [];
  return [
    "The project was opened with these folders:",
    ...folders.map((folder, index) =>
      index === 0 ? `- ${folder} (your working directory)` : `- ${folder}`,
    ),
    "",
  ];
}

function extraRootsStatement(extraRoots: readonly string[] | undefined): readonly string[] {
  if (extraRoots === undefined || extraRoots.length === 0) return [];
  // Paths only, no explanation of how they got there. The block is paid for on
  // every conversation, so this stays one line per root rather than a story.
  return [
    "Beyond your working directory you may also reach:",
    ...extraRoots.map((root) => `- ${root}`),
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
    ...workspaceStatement(facts.kind),
    ...projectFoldersStatement(facts),
    ...extraRootsStatement(facts.extraRoots),
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
