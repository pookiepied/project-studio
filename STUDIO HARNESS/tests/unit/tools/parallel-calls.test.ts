import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExecutionScope } from "../../../src/contracts/capabilities.js";
import type { PermissionAnswer } from "../../../src/permissions/kernel.js";
import { PermissionGrantStore } from "../../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../../src/permissions/kernel.js";
import { LocalSandbox } from "../../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../../src/storage/database.js";
import { CallGate } from "../../../src/tools/gate.js";
import { registerFilesystemTools } from "../../../src/tools/filesystem/index.js";
import { registerSearchTools } from "../../../src/tools/search/index.js";

/**
 * A whole batch of tool calls, not two of the same tool.
 *
 * `path-locks.test.ts` covers the one file two writers can collide on, and
 * `harness.test.ts` drives two calls through a real harness end to end. What
 * is left is the shape a model actually produces when it decides to work in
 * parallel: several different tools at once, some of which need the person's
 * permission and some of which do not.
 *
 * The property that matters here is that a call parked on an approval does not
 * hold up the rest of its batch. The permission question is answered by a
 * human, so it can be parked for a long time - a minute, or until someone
 * comes back to their desk. If the gate could only carry one question, or if a
 * parked call blocked its siblings, then a batch containing one write would
 * stall every read beside it and parallel tool calling would be parallel only
 * when nothing needed asking.
 *
 * The approver here never answers until the test lets it, which is what makes
 * "both are parked at the same time" observable rather than a race.
 */

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

let db: StudioDatabase;
let workspace: string;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  workspace = mkdtempSync(join(tmpdir(), "studio-parallel-"));
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "a.ts"), "const a = 1;\n");
  writeFileSync(join(workspace, "src", "b.ts"), "const b = 2;\n");
});

afterEach(() => {
  db.close();
  rmSync(workspace, { recursive: true, force: true });
});

/** A gate whose approver parks every question until `answer()` is called. */
function gateWithHeldApprovals(): {
  gate: CallGate;
  asked: () => number;
  answer: () => void;
} {
  const questions: (() => void)[] = [];
  let held = 0;

  const kernel = new PermissionKernel({
    grants: new PermissionGrantStore(db),
    approver: {
      request: async (): Promise<PermissionAnswer> => {
        held += 1;
        await new Promise<void>((resolve) => questions.push(resolve));
        return { verdict: "allow", duration: "once" };
      },
    },
  });
  const gate = new CallGate({
    kernel,
    sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })),
  });
  registerFilesystemTools(gate);
  registerSearchTools(gate);

  return {
    gate,
    asked: () => held,
    answer: () => {
      for (const resolve of questions.splice(0)) resolve();
    },
  };
}

/** Long enough for every parked call to have reached its approval. */
const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

describe("a batch of different tools", () => {
  it("asks for every writing call at once instead of one at a time", async () => {
    const { gate, asked, answer } = gateWithHeldApprovals();

    const calls = [
      gate.call({ name: "native/write", input: { path: "x.txt", content: "1" }, scope: SCOPE }),
      gate.call({ name: "native/write", input: { path: "y.txt", content: "2" }, scope: SCOPE }),
    ];

    await breathe();
    // Both questions are outstanding together. One at a time would mean the
    // second write only asks after the first is answered, so a batch of five
    // writes would be five sequential prompts with a wait between each.
    expect(asked()).toBe(2);

    answer();
    const settled = await Promise.all(calls);
    expect(settled).toHaveLength(2);
  });

  it("lets read-only calls finish while a writing call waits to be allowed", async () => {
    const { gate, asked, answer } = gateWithHeldApprovals();

    const write = gate.call({
      name: "native/write",
      input: { path: "x.txt", content: "1" },
      scope: SCOPE,
    });
    const glob = gate.call({ name: "native/glob", input: { pattern: "**/*.ts" }, scope: SCOPE });
    const read = gate.call({ name: "native/read", input: { path: "src/a.ts" }, scope: SCOPE });

    // Neither read-only call is behind the unanswered question: reading is
    // allowed without asking, and a batch is not a queue. If it were, every
    // parallel batch containing a single write would be as slow as the person
    // taking to notice the prompt.
    await expect(glob).resolves.toBeDefined();
    await expect(read).resolves.toContain("const a = 1;");
    expect(asked()).toBe(1);

    answer();
    await expect(write).resolves.toBeDefined();
  });

  it("runs four different tools together and answers all of them", async () => {
    const { gate, answer } = gateWithHeldApprovals();

    const calls = [
      gate.call({ name: "native/write", input: { path: "x.txt", content: "1" }, scope: SCOPE }),
      gate.call({ name: "native/glob", input: { pattern: "**/*.ts" }, scope: SCOPE }),
      gate.call({ name: "native/read", input: { path: "src/b.ts" }, scope: SCOPE }),
      gate.call({ name: "native/write", input: { path: "z.txt", content: "3" }, scope: SCOPE }),
    ];

    await breathe();
    answer();

    const settled = await Promise.allSettled(calls);
    // The mixed batch is the ordinary case, not an exotic one: a model that
    // has decided what to do next usually reads several things and writes
    // several others in the same breath.
    expect(settled.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
  });
});
