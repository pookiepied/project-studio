import { describe, expect, it } from "vitest";

import {
  environmentBlock,
  environmentFacts,
  isGitRepository,
  localDate,
} from "../../src/context/environment.js";
import { resolveInterpreter } from "../../src/process/interpreter.js";
import { ISOLATION_ENFORCED } from "../../src/sandbox/isolation/registry.js";

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
    expect(own).toMatch(/yours to work in/);
    // The instruction that makes it usable, not just permitted.
    expect(own).toMatch(/intermediate/);
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

  it("defaults the workspace kind to the conversation's own", () => {
    // The projectless conversation is the common case and the safe default:
    // claiming a directory is the person's project when it is not would make
    // a model hoard, which is the failure this replaced.
    expect(environmentFacts("/w", new Date(2026, 7, 30, 12, 0, 0)).kind).toBe("conversation");
  });

  it("says commands are contained, where containment is enforced", () => {
    // An evaluation run read the boundary as a broken machine: `tasklist` was
    // refused, and with nothing saying there was a container the only
    // available explanation was a defect. The block has to state it, or every
    // run pays to rediscover it.
    const block = environmentBlock({ workspace: "/w", kind: "conversation", git: false, today: "2026-08-30" });

    if (ISOLATION_ENFORCED) {
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
      // A host with no backend must not claim a boundary it does not have.
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
    expect(block).not.toContain("folders");
  });

  it("renders no folder list for a project that is only a label", () => {
    const block = environmentBlock({
      workspace: "/w",
      kind: "project",
      git: false,
      today: "2026-08-30",
    });

    expect(block).not.toContain("folders");
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
