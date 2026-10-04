import { afterEach, describe, expect, it } from "vitest";

import {
  environmentBlock,
  environmentFacts,
  isGitRepository,
  localDate,
} from "../../src/context/environment.js";
import { resolveInterpreter } from "../../src/process/interpreter.js";
import {
  ISOLATION_OFFERED,
  measuredIsolation,
  preferIsolation,
} from "../../src/sandbox/isolation/registry.js";

/** Whether turning the fence on here gets one: a backend the probe accepts. */
const FENCED: boolean = ISOLATION_OFFERED && measuredIsolation().backend !== undefined;

/**
 * The block the model is actually given.
 *
 * It rides in the instructions, so what matters is that each fact is stated,
 * that a false one is never stated confidently, and that the two facts the
 * model would otherwise go looking for - the directory and whether git works
 * here - are answered without it having to run anything.
 */

describe("the environment block", () => {
  it("names the working directory", () => {
    const block = environmentBlock({
      workspace: "/work/project",
      kind: "conversation",
      git: false,
      today: "2026-08-30",
    });

    expect(block).toContain("/work/project");
  });

  it("answers the git question in both directions", () => {
    const inside = environmentBlock({ workspace: "/w", kind: "conversation", git: true, today: "2026-08-30" });
    const outside = environmentBlock({ workspace: "/w", kind: "conversation", git: false, today: "2026-08-30" });

    expect(inside).toContain("git repository");
    // Stated rather than omitted: silence reads as unknown, and a model that
    // does not know reaches for git to find out.
    expect(outside).toContain("not a git repository");
  });

  it("states which interpreter commands run through", () => {
    // ADR 0046: the shell tool takes a command line, and the interpreter it
    // runs under is a machine fact stated here - the same answer the tool
    // itself resolves. A model told which shell it has writes that shell's
    // syntax instead of guessing.
    const block = environmentBlock({ workspace: "/w", kind: "conversation", git: false, today: "2026-08-30" });

    expect(block).toMatch(/Commands run through /);
    // The fallback interpreter's gap is stated, not left to be discovered:
    // on a machine where nothing better than PowerShell 5.1 exists, the block
    // is where the model learns `&&` will not work.
    const interpreter = resolveInterpreter();
    if (interpreter?.kind === "powershell") {
      expect(block).toContain("&& is not supported");
    }
  });

  it("carries the date it was given", () => {
    const block = environmentBlock({ workspace: "/w", kind: "conversation", git: false, today: "2026-08-30" });

    expect(block).toContain("Today is 2026-08-30.");
  });

  it("says whose directory this is, and says it differently for the two kinds", () => {
    // An evaluation run reported the harness had no scratch space while
    // standing in a directory that was exactly that. The block named a path
    // and never said whose it was, and the prompt's file guidance is written
    // about the person's project files, so "be careful" was the only reading
    // available.
    const own = environmentBlock({
      workspace: "/w",
      kind: "conversation",
      git: false,
      today: "2026-08-30",
    });
    expect(own).toContain("belongs to this conversation");
    // Permission, in the words that answer the misreading: nothing here is
    // theirs, so using it disturbs nothing.
    expect(own).toMatch(/not disturbing anything/);
    // And what the directory is FOR, which is the half that makes it usable
    // rather than merely permitted. It is where finished work goes; the
    // scratch directory beside it takes everything else, and that sentence is
    // asserted where a scratch path is actually supplied.
    expect(own).toMatch(/where finished work/);
    // And the one real limit of a private workspace: it is empty, so the
    // person's existing code is somewhere else.
    expect(own).toMatch(/open it as a project/);

    const theirs = environmentBlock({
      workspace: "/w",
      kind: "project",
      git: false,
      today: "2026-08-30",
    });
    expect(theirs).toContain("the person's project");
    // The two must not collapse into one careful paragraph: telling a model to
    // be careful everywhere is what produced the original misreading.
    expect(theirs).not.toMatch(/yours to work in/);
    expect(own).not.toContain("the person's project");
  });

  it("divides the two places by the same sentence in both kinds", () => {
    // The correction to the original split. Both kinds now name a working
    // directory that holds what was asked for and a scratch directory that
    // holds everything else, so a model does not learn one discipline in a
    // project and a different one outside it. Only the identity of the
    // working directory changes, which is what the mode means.
    const conversation = environmentBlock({
      workspace: "/w",
      kind: "conversation",
      git: false,
      today: "2026-08-30",
      scratch: "/s",
    });
    const project = environmentBlock({
      workspace: "/w",
      kind: "project",
      git: false,
      today: "2026-08-30",
      scratch: "/s",
    });

    for (const block of [conversation, project]) {
      expect(block).toContain("/s");
      expect(block).toMatch(/scratch/);
      expect(block).toMatch(/nothing else does/);
    }

    // The scratch path is never the working directory: a model handed one
    // directory under two names treats it as two places, which is the bug
    // this shape exists to prevent.
    expect(conversation).not.toMatch(/scratch directory[\s\S]{0,40}\/w\b/);
  });

  it("says who the two directories belong to, and what to do about a third", () => {
    // Three sentences a model was previously left to infer, and each one it
    // got wrong somewhere: that a plain conversation's directory is for real
    // work rather than notes, that the scratch directory is the
    // conversation's and not the project's, and that a folder it cannot reach
    // is a thing to name and ask for rather than to route around or to
    // quietly claim it checked.
    const conversation = environmentBlock({
      workspace: "/w",
      kind: "conversation",
      git: false,
      today: "2026-08-30",
      scratch: "/s",
    });
    expect(conversation).toMatch(/Real work happens here/);
    expect(conversation).toMatch(/cannot see yours/);

    const project = environmentBlock({
      workspace: "/w",
      kind: "project",
      git: false,
      today: "2026-08-30",
      scratch: "/s",
    });
    // The project's own folders are the working directory, and no second one
    // is given - the question a person kept having to ask about the layout.
    expect(project).toMatch(/does not/);
    expect(project).toMatch(/belongs to this conversation, not to the/);
  });

  it("says nothing about a scratch directory when there is none", () => {
    // The facts builder drops a scratch equal to the workspace, and a
    // composition that supplies none must not leave the two-place sentence
    // dangling with no second place named.
    const block = environmentBlock({
      workspace: "/w",
      kind: "conversation",
      git: false,
      today: "2026-08-30",
    });
    expect(block).not.toMatch(/nothing else does/);
  });

  it("defaults the workspace kind to the conversation's own", () => {
    // The projectless conversation is the common case and the safe default:
    // claiming a directory is the person's project when it is not would make
    // a model hoard, which is the failure this replaced.
    expect(environmentFacts("/w", new Date(2026, 7, 30, 12, 0, 0)).kind).toBe("conversation");
  });

  afterEach(() => {
    preferIsolation(false);
  });

  it("says nothing about containment while the fence is off, on every host", () => {
    // ADR 0057: the gate is the boundary, its refusals arrive as questions,
    // and a block that claimed a fence nobody turned on would send the model
    // explaining access errors that never happen.
    preferIsolation(false);
    const block = environmentBlock({ workspace: "/w", kind: "conversation", git: false, today: "2026-08-30" });
    expect(block).not.toContain("Commands you run are contained.");
    expect(block).not.toContain("sandbox fence is turned on");
  });

  it("says the fence is on and missing, when it is, rather than claiming it", () => {
    // Linux with the switch on and a kernel that refuses the namespace: the
    // model is told in one sentence, so it neither diagnoses the machine nor
    // treats the settings page as a promise.
    if (!ISOLATION_OFFERED || FENCED) return;
    preferIsolation(true);
    const block = environmentBlock({ workspace: "/w", kind: "conversation", git: false, today: "2026-08-30" });
    expect(block).toContain("The sandbox fence is turned on in Settings, and this machine cannot");
    expect(block).not.toContain("Commands you run are contained.");
  });

  it("says commands are contained, where the fence is on and works", () => {
    // An evaluation run read the boundary as a broken machine: `tasklist` was
    // refused, and with nothing saying there was a container the only
    // available explanation was a defect. The block has to state it, or every
    // run pays to rediscover it.
    preferIsolation(true);
    const block = environmentBlock({ workspace: "/w", kind: "conversation", git: false, today: "2026-08-30" });

    if (FENCED) {
      expect(block).toContain("Commands you run are contained.");
      // The two refusals that were misread, both named.
      expect(block).toContain("listing");
      expect(block).toContain("processes");
      expect(block).toMatch(/Python/);
      // And the instruction that keeps a refusal from becoming a diagnosis.
      expect(block).toContain("boundary doing");
      // The measured pipe limitation, and both of its workarounds. An
      // evaluation run lost most of a session to this: a program it launched
      // through another program hung to timeout with no output, and it
      // concluded the harness destroys all child output, which is not what
      // happens - a direct child speaks fine.
      expect(block).toMatch(/pipe/);
      expect(block).toMatch(/hangs/);
      expect(block).toMatch(/write to a file/);
      // And the correction to the reading that produced the last report: the
      // toolchains are reachable, so "not recognized" for a bare name is not
      // evidence that a tool is absent. Measured under containment on this
      // machine: node, npm, git, python and dotnet all run.
      expect(block).toMatch(/name programs directly/);
      expect(block).toMatch(/node, npm/);
      // Network is a stated decision, not a gap something slipped through.
      expect(block).toMatch(/Outbound network is on/);
    } else {
      // A host that cannot fence must not claim a boundary it does not have.
      expect(block).not.toContain("Commands you run are contained.");
    }
  });
});

describe("the project's folders", () => {
  it("names every folder and says which one is the working directory", () => {
    // With several roots, "your working directory" is a choice someone made
    // rather than the only place there is, so the list marks the choice; and
    // the model learns the shape of what it was opened into without running
    // a command to look.
    const block = environmentBlock({
      workspace: "D:/Work/site",
      kind: "project",
      git: false,
      today: "2026-08-30",
      projectFolders: ["D:/Work/site", "D:/Work/assets", "D:/Work/notes"],
    });

    expect(block).toContain("- D:/Work/site (your working directory)");
    expect(block).toContain("- D:/Work/assets");
    expect(block).toContain("- D:/Work/notes");
  });

  it("renders no folder list for a conversation's own tree", () => {
    const block = environmentBlock({
      workspace: "/w",
      kind: "conversation",
      git: false,
      today: "2026-08-30",
    });

    expect(block).not.toContain("(your working directory)");
    expect(block).not.toContain("opened with these folders");
  });

  it("renders no folder list for a project that is only a label", () => {
    const block = environmentBlock({
      workspace: "/w",
      kind: "project",
      git: false,
      today: "2026-08-30",
    });

    expect(block).not.toContain("opened with these folders");
  });

  it("keeps the folder list out of the conversation kind even when the facts carry it", () => {
    // The statement belongs to the project branch. The render cannot produce
    // folders for a conversation run, and the block does not render them if
    // a caller ever does.
    const block = environmentBlock({
      workspace: "/w",
      kind: "conversation",
      git: false,
      today: "2026-08-30",
      projectFolders: ["/somewhere/else"],
    });

    expect(block).not.toContain("/somewhere/else");
  });

  it("assembles project facts with the folders", () => {
    const facts = environmentFacts(
      "D:/Work/site",
      new Date(2026, 7, 30, 12, 0, 0),
      "project",
      undefined,
      ["D:/Work/site", "D:/Work/assets"],
    );

    expect(facts.kind).toBe("project");
    expect(facts.projectFolders).toEqual(["D:/Work/site", "D:/Work/assets"]);
  });
});

describe("the facts behind it", () => {
  it("reads the local date, not UTC", () => {
    // Late evening local time is already tomorrow in UTC. The person reading
    // the answer is in the machine's timezone, so the machine's day is the
    // honest one.
    expect(localDate(new Date(2026, 7, 30, 23, 30, 0))).toBe("2026-08-30");
    expect(localDate(new Date(2026, 0, 1, 0, 5, 0))).toBe("2026-01-01");
  });

  it("finds a repository from a directory inside it", () => {
    // This test file is well below the repository root, which is the case that
    // matters: a project conversation is rarely rooted at the top.
    expect(isGitRepository(process.cwd())).toBe(true);
  });

  it("reports no repository for a directory outside one", () => {
    // The filesystem root cannot be inside a repository, and asking about it
    // also proves the upward walk terminates rather than looping.
    const root = process.platform === "win32" ? "C:\\" : "/";

    expect(isGitRepository(root)).toBe(false);
  });

  it("assembles the facts a conversation needs", () => {
    const facts = environmentFacts("/work/project", new Date(2026, 7, 30, 12, 0, 0));

    expect(facts.workspace).toBe("/work/project");
    expect(facts.today).toBe("2026-08-30");
  });
});

/**
 * Which of the two directories a project conversation is standing in, and
 * what each is for.
 *
 * The block already said "this is the person's project, be careful". What it
 * never said was that the conversation's own private directory still exists
 * while a project is open. A run told only to be careful with the repository,
 * and given no other writable place it knows about, either writes its working
 * files into the person's tree or stops to ask where a temporary file may go.
 * Both are avoidable by naming the second directory and what it is not.
 */
describe("the two directories a project conversation has", () => {
  const facts = (scratch?: string) =>
    environmentFacts(
      "/work/project",
      new Date("2026-09-07T10:00:00"),
      "project",
      undefined,
      ["/work/project"],
      scratch,
    );

  it("says which mode this is, rather than leaving it to be inferred", () => {
    const block = environmentBlock(facts("/home/studio/cnv_1/workspace"));

    expect(block).toContain("working in a project, not in a plain conversation");
  });

  it("names the scratch directory and rules it out of the project", () => {
    const block = environmentBlock(facts("/home/studio/cnv_1/workspace"));

    expect(block).toContain("/home/studio/cnv_1/workspace");
    expect(block).toContain("not part of the project");
    // The half that keeps the person's work findable. Without it the
    // scratchpad becomes somewhere finished work goes to be lost.
    expect(block).toContain("belongs in the project, and nothing else does");
  });

  it("keeps the project's own folders as the priority", () => {
    const block = environmentBlock(facts("/home/studio/cnv_1/workspace"));

    expect(block).toContain("the project comes first");
  });

  it("does not name a second directory when there is only one", () => {
    // A plain conversation stands in its own scratch directory: it is the
    // workspace. Naming it twice would present one place as two.
    const plain = environmentFacts(
      "/home/studio/cnv_1/workspace",
      new Date("2026-09-07T10:00:00"),
      "conversation",
      undefined,
      undefined,
      "/home/studio/cnv_1/workspace",
    );

    expect(environmentBlock(plain)).not.toContain("not part of the project");
  });
})

/**
 * The one thing a model cannot discover cheaply.
 *
 * A command meant never to finish - a dev server - holds the call until the
 * time limit and then loses its output with the failure. Discovering that
 * costs a full timeout and returns nothing, and the obvious workaround makes
 * it worse: launching the server into its own window still hands it the same
 * pipes, so the call waits exactly as long. Both facts belong in the block.
 */
describe("what the block says about commands that do not finish", () => {
  const block = () =>
    environmentBlock(environmentFacts("/w", new Date("2026-09-07T10:00:00"), "conversation"))

  afterEach(() => {
    preferIsolation(false)
  })

  it("names the background option rather than leaving it to be found", () => {
    if (!FENCED) return
    preferIsolation(true)
    expect(block()).toContain("background option")
  })

  it("says that detaching by hand does not avoid the wait", () => {
    // Without this the model reaches for `start` or `&`, waits out the
    // timeout anyway, and reports the tool as broken.
    if (!FENCED) return
    preferIsolation(true)
    expect(block()).toContain("Do not try to detach a command by hand")
  })
})

/**
 * The background commands, named at the top of the turn.
 *
 * The block is the cached prefix of every request, so this is the one fact in
 * it that changes while a conversation is open. It is therefore omitted
 * entirely when there are no jobs: a conversation that never starts one must
 * cost exactly what it cost before, byte for byte.
 */
describe("the background commands in the block", () => {
  const day = new Date(2026, 7, 30, 12, 0, 0)

  it("says nothing at all when the conversation has no background commands", () => {
    const without = environmentBlock(environmentFacts("/work", day))
    const withEmpty = environmentBlock(
      environmentFacts("/work", day, "conversation", undefined, undefined, undefined, []),
    )

    // Byte-identical, not merely similar. Anything else is a cache miss on
    // every turn of every conversation, paid to say nothing.
    expect(withEmpty).toBe(without)
  })

  it("names the jobs and where to read them", () => {
    const block = environmentBlock(
      environmentFacts("/work", day, "conversation", undefined, undefined, undefined, [
        "job_ab1 is running: npm run dev",
        "job_ab2 finished: curl model.bin",
      ]),
    )

    expect(block).toContain("job_ab1 is running: npm run dev")
    expect(block).toContain("job_ab2 finished: curl model.bin")
    // A model told a download finished and not told how to read its output
    // goes looking for the file by hand.
    expect(block).toContain("jobs tool")
  })
})

/**
 * The background agent tasks, beside the commands.
 *
 * The same cached-prefix argument, one stricter consequence: the section is
 * a different one from the commands', because the two kinds answer different
 * questions and there is no jobs tool for a task to read back with. It is
 * also a read and not a drain - running tasks only, named every turn while
 * they run, because the ending arrives by itself.
 */
describe("the background agent tasks in the block", () => {
  const day = new Date(2026, 7, 30, 12, 0, 0)

  it("says nothing at all when no task is under way", () => {
    const without = environmentBlock(environmentFacts("/work", day))
    const withEmpty = environmentBlock(
      environmentFacts("/work", day, "conversation", undefined, undefined, undefined, undefined, undefined, undefined, undefined, []),
    )

    expect(withEmpty).toBe(without)
  })

  it("names the running tasks and says the ending arrives on its own", () => {
    const block = environmentBlock(
      environmentFacts(
        "/work",
        day,
        "conversation",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ['Task "Titler" is running in the background.'],
      ),
    )

    expect(block).toContain("Background agent tasks under way:")
    expect(block).toContain('Task "Titler" is running in the background.')
    expect(block).toContain("nothing to poll")
    // The commands' reader does not claim a task: no jobs-tool sentence in
    // the tasks' own section.
    const section = block.split("Background agent tasks under way:")[1] ?? ""
    expect(section).not.toContain("jobs tool")
  })

  it("renders the tasks and the commands as two sections, not one list", () => {
    const block = environmentBlock(
      environmentFacts(
        "/work",
        day,
        "conversation",
        undefined,
        undefined,
        undefined,
        ["job_ab1 is running: npm run dev"],
        undefined,
        undefined,
        undefined,
        ['Task "Titler" is running in the background.'],
      ),
    )

    expect(block).toContain("Background work you started:")
    expect(block).toContain("Background agent tasks under way:")
  })
})

/**
 * The two folders this conversation keeps what crosses between the person and
 * the model in.
 *
 * Until the read roots were granted, neither folder was reachable: an
 * attachment reached the model only as the pixels riding its message, and a
 * generation's output lived behind a route nobody's file tools could resolve.
 * The note exists because a root granted but never named is a call spent
 * discovering it - and it is conditional on the facts, so a composition that
 * does not name the folders costs exactly what it cost before, byte for byte.
 */
describe("the conversation's kept pictures in the block", () => {
  const day = new Date(2026, 7, 30, 12, 0, 0)
  const attachments = "/home/pooki/.studio/data/conversations/cnv_1/attachments"
  const artifacts = "/home/pooki/.studio/data/conversations/cnv_1/artifacts"

  it("names where an upload's copy and a generation's output are read from", () => {
    const block = environmentBlock(
      environmentFacts(
        "/work",
        day,
        "conversation",
        undefined,
        undefined,
        "/work/scratch",
        undefined,
        attachments,
        artifacts,
      ),
    )

    expect(block).toContain("copied, under its own name, into")
    expect(block).toContain(attachments)
    expect(block).toContain("the very file names those lines report, in")
    expect(block).toContain(artifacts)
    expect(block).toMatch(/yours to read/)
  })

  it("says nothing while the folders go unnamed, as every earlier composition did", () => {
    const before = environmentBlock(environmentFacts("/work", day))
    // One without the other is the pair's own condition: the statement waits
    // for both, so a partially supplied facts object halves into silence
    // rather than a note about one folder and a question about the other.
    const half = environmentBlock(
      environmentFacts("/work", day, "conversation", undefined, undefined, undefined, undefined, attachments),
    )

    expect(before).not.toContain("Two more folders")
    expect(half).not.toContain("Two more folders")
  })
})

describe("the reach statement", () => {
  it("names the folder question in both conversation kinds", () => {
    // ADR 0057: the gate is the boundary, and the model is told how to ask
    // for more before it meets the refusal - the same way whether or not a
    // project is open, because the tool and the rule are the same for both.
    for (const kind of ["conversation", "project"] as const) {
      const block = environmentBlock({ workspace: "/w", kind, git: false, today: "2026-08-30" });
      expect(block).toContain("ask for it with");
      expect(block).toContain("the request_folder tool before touching it");
    }
  });
});
