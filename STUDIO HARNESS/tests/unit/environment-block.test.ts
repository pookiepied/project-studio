import { describe, expect, it } from "vitest";

import {
  environmentBlock,
  environmentFacts,
  isGitRepository,
  localDate,
} from "../../src/context/environment.js";
import { resolveInterpreter } from "../../src/process/interpreter.js";

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
      git: false,
      today: "2026-08-30",
    });

    expect(block).toContain("/work/project");
  });

  it("answers the git question in both directions", () => {
    const inside = environmentBlock({ workspace: "/w", git: true, today: "2026-08-30" });
    const outside = environmentBlock({ workspace: "/w", git: false, today: "2026-08-30" });

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
    const block = environmentBlock({ workspace: "/w", git: false, today: "2026-08-30" });

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
    const block = environmentBlock({ workspace: "/w", git: false, today: "2026-08-30" });

    expect(block).toContain("Today is 2026-08-30.");
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
