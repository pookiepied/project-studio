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
  /**
   * The conversation's own private directory, when it is not the workspace.
   *
   * Only meaningful on a project conversation. The directory exists for every
   * conversation - a project one simply stands somewhere else - and a run
   * that has not been told about it treats the person's repository as the
   * only writable surface it has, which is how working files end up
   * scattered through a tree that was clean before the turn.
   */
  readonly scratch?: string;
  /**
   * The conversation's `attachments/` and `artifacts/` directories, when the
   * caller names them to the model.
   *
   * Every conversation has both - the sandbox factory creates the pair
   * wherever it creates the workspace - but a block composed without them
   * stays byte-identical to what it was before this fact existed, the same
   * deal the background jobs' absence strikes. Present, the note tells the
   * model where an upload's copy and a generation's output can be read
   * from: the two things its file tools could not reach at all until the
   * read roots were granted, because neither folder sits inside the
   * workspace.
   */
  readonly attachmentsDirectory?: string;
  readonly artifactsDirectory?: string;
  /**
   * The background commands this conversation has, as lines to render.
   *
   * Present only when there are any, and that condition is the whole design.
   * The block is the cached prefix of every request, so a fact that changes
   * every turn would cost a cache miss on every turn - for every conversation,
   * including the overwhelming majority that never start a background command
   * at all. Omitted when the list is empty, the prefix is byte-identical to
   * what it has always been, and only a conversation that actually has jobs
   * pays. On that conversation the miss buys the model knowing, at the top of
   * the turn, that its download finished - which is worth more than the cache.
   */
  readonly backgroundJobs?: readonly string[];
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
  scratch?: string,
  backgroundJobs?: readonly string[],
  attachmentsDirectory?: string,
  artifactsDirectory?: string,
): EnvironmentFacts {
  return {
    workspace,
    kind,
    git: isGitRepository(workspace),
    today: localDate(now),
    ...(extraRoots === undefined || extraRoots.length === 0 ? {} : { extraRoots }),
    ...(projectFolders === undefined || projectFolders.length === 0 ? {} : { projectFolders }),
    // A guard that no longer fires, kept because the failure it prevents is
    // silent. The scratch directory is a sibling of the workspace, so the two
    // are different paths in both modes; earlier the workspace was passed
    // here on a plain conversation and the model was handed one directory
    // under two names, which it reasonably treated as two places. Should a
    // caller ever pass the workspace again, dropping it is still the right
    // answer.
    ...(scratch === undefined || scratch === workspace ? {} : { scratch }),
    ...(attachmentsDirectory === undefined ? {} : { attachmentsDirectory }),
    ...(artifactsDirectory === undefined ? {} : { artifactsDirectory }),
    ...(backgroundJobs === undefined || backgroundJobs.length === 0
      ? {}
      : { backgroundJobs }),
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
 * The two cases now say the same thing about the same two places, and that
 * is the correction. Both name a working directory that holds what the person
 * asked for, and a scratch directory beside it that holds everything else,
 * with one identical sentence dividing them. Only the *identity* of the
 * working directory changes with the mode - the person's repository in a
 * project, the conversation's own folder otherwise - which is what the mode
 * means and needs no separate discipline to reason about.
 *
 * What must not collapse is the surrounding warning. A project conversation
 * is standing in files that existed before it and belong to someone else, and
 * that paragraph stays. A plain conversation is standing in an empty
 * directory it owns, and saying so is what stopped a model from treating its
 * own scratch space as somebody's source tree. The shared part is the
 * two-place rule; the different part is who owns what it is standing in.
 */
function workspaceStatement(facts: EnvironmentFacts): readonly string[] {
  if (facts.kind === "project") {
    return [
      "You are working in a project, not in a plain conversation. The",
      "difference matters. A plain conversation stands in an empty directory",
      "of its own and owns everything in it. Here you are standing in",
      "the person's project: a codebase they already had and opened",
      "deliberately. That project is the work - it is what you are here to",
      "read and change, and it is where anything you produce for them",
      "belongs.",
      "",
      "The project they opened is your working directory. Studio does not",
      "give you a second one here, because you do not need one: their project",
      "is the place the work goes. That is the only difference between this",
      "and a plain conversation, where there is no project and Studio gives",
      "you a directory to build in instead.",
      "",
      "So the project comes first, and this directory is where it starts.",
      "The files here are theirs and existed before this conversation. Change",
      "them as the task asks, and do not scatter working files through the",
      "tree: a file that is not part of what was asked for should not be left",
      "behind in their code.",
      "",
      ...(facts.scratch === undefined
        ? [
            "If you need somewhere to put intermediate output, ask where it",
            "should go, or use a path the person named.",
            "",
          ]
        : [
            "You also have a private directory of your own. It is",
            "not part of the project and never will be, and it is yours:",
            `${facts.scratch}`,
            "",
            "Nothing in it is shipped, committed, or seen by anyone, and the",
            "person is not looking at it. Use it as a scratchpad - a throwaway",
            "script, a downloaded file, notes to yourself between turns, the",
            "output of a command you want to read back later. It persists",
            "across turns and restarts, so it is a real place to keep working",
            "state.",
            "",
            "It belongs to this conversation, not to the project. Another",
            "conversation in this same project has its own, and cannot see",
            "yours; when this conversation is gone, so is it. So it is the",
            "right place for what only this piece of work needs, and the wrong",
            "place for anything the project should still have tomorrow.",
            "",
            "The rule between the two is one sentence: work the person asked",
            "for belongs in the project, and nothing else does. Do not leave",
            "temporary files in their code, and do not put finished work in",
            "the scratchpad, where they will never find it.",
            "",
          ]),
    ];
  }

  return [
    "There is no project open, so Studio has given you a working directory of",
    "your own, and this is it. It belongs to this conversation and to nothing",
    "else. It started empty, no other conversation reads it, and it persists",
    "between turns and across restarts. Nothing here is the person's own work",
    "unless they put it here, so you are not disturbing anything by using it.",
    "",
    "Real work happens here, not only notes. If they ask you to build",
    "something - a script, a small site, a program, a document, anything you",
    "are making for them - this is where it goes, and you should build it",
    "properly rather than describing it. What you make here is what they will",
    "come looking for, so this is where finished work belongs.",
    "",
    ...(facts.scratch === undefined
      ? []
      : [
          "Beside it you have a scratch directory, and it is not this one:",
          `${facts.scratch}`,
          "",
          "That is where everything else goes - a throwaway script, a file you",
          "downloaded to look at once, the output of a command you want to",
          "read back later, notes to yourself between turns. It persists the",
          "same way, and the person is not looking at it.",
          "",
          "Both of these are this conversation's own. Another conversation has",
          "its own pair and cannot see yours, and you cannot see theirs.",
          "",
          "The rule between the two is one sentence: work the person asked for",
          "belongs in the working directory, and nothing else does. Keeping",
          "them apart is what lets someone open this conversation's folder and",
          "see what they asked for rather than what it took to get there.",
          "",
        ]),
    "The working directory starts empty, which is the one thing to keep in",
    "mind: the person's own code is not here. If they want work done on a",
    "codebase they already have, say so and ask them to open it as a project,",
    "rather than rebuilding part of it here from what they have told you.",
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
    "Another conversation's directories are outside the boundary like anything",
    "else, and that includes ones in this same project. You cannot read what",
    "another conversation built or the notes it left itself, and it cannot",
    "read yours. If the work genuinely needs something out there, do not go",
    "looking for a way in and do not pretend you looked. Say plainly that it",
    "is outside what you can reach, name the exact folder or file, and say",
    "that the person can give you access to it in Settings, under Coding, in",
    "Environments - then it is reachable and you can carry on. Granting it is",
    "theirs to do; asking clearly is yours.",
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
    "A command runs until it finishes, so anything that is not meant to",
    "finish - a dev server, a watcher, a long download - needs the shell",
    "tool's background option. It hands back a job id straight away, and the",
    "jobs tool reads that job's output or stops it. Start a server that way",
    "and the very next call can fetch a page from it.",
    "",
    "Do not try to detach a command by hand instead. Launching one into its",
    "own window still passes it these pipes, so the call waits for it exactly",
    "as if it had run in the foreground, and when the time limit ends the",
    "call its output is lost with it. That is the same reason a program which",
    "runs another program and captures its output through a pipe hangs: the",
    "wait is on the pipe, not on the process. When one command really must",
    "launch another, have the inner one write to a file and read the file",
    "afterwards.",
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
/**
 * The background commands, when there are any.
 *
 * Both the running and the just-ended ones, because the two answer different
 * questions and a model given only one of them asks for the other. A running
 * job is something the turn can use - the dev server is up, so fetch the page.
 * An ended one is news, and it is delivered here exactly once: the caller
 * drains the ended list to build these lines, so the next turn's block carries
 * only what is still true.
 */
function backgroundJobsStatement(facts: EnvironmentFacts): readonly string[] {
  if (facts.backgroundJobs === undefined || facts.backgroundJobs.length === 0) return [];
  return [
    "Background commands you started:",
    ...facts.backgroundJobs,
    "Read output or stop one with the jobs tool.",
    "",
  ];
}

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

/**
 * The two folders this conversation keeps what crosses between the person
 * and the model in.
 *
 * Added with the read roots that made them reachable, because a root granted
 * but never named is a call spent discovering it. Before this note an
 * attachment reached the model only as the pixels riding its message - no
 * path existed for a tool to be handed, which is why an edit of an uploaded
 * picture needed the person to copy the file somewhere themselves. The note
 * is conditional on the facts, not on any conversation: both directories
 * exist for every conversation, so when they are named at all the lines are
 * conversation-stable and land in the cached prefix.
 */
function conversationFoldersStatement(facts: EnvironmentFacts): readonly string[] {
  if (facts.attachmentsDirectory === undefined || facts.artifactsDirectory === undefined) {
    return [];
  }
  return [
    "Two more folders of this conversation's own stand beside the ones above,",
    "and both are yours to read. What the person attaches to a message is",
    "also copied, under its own name, into",
    `${facts.attachmentsDirectory},`,
    "so a tool can be handed the file rather than the picture. What you",
    "generate - the image or video an Artifact line names - is kept, under",
    "the very file names those lines report, in",
    `${facts.artifactsDirectory}.`,
    "Both persist with the conversation.",
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
    ...workspaceStatement(facts),
    ...conversationFoldersStatement(facts),
    ...projectFoldersStatement(facts),
    ...backgroundJobsStatement(facts),
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
