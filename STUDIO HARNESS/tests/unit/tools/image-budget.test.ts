import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExecutionScope } from "../../../src/contracts/capabilities.js";
import { PermissionGrantStore } from "../../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../../src/permissions/kernel.js";
import { LocalSandbox } from "../../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../../src/storage/database.js";
import { CallGate } from "../../../src/tools/gate.js";
import {
  FileAccessLog,
  ImageBudget,
  MAX_IMAGES_PER_CONVERSATION,
  registerFilesystemTools,
} from "../../../src/tools/filesystem/index.js";

/**
 * What a conversation may spend on pictures.
 *
 * The limit that actually breaks a request is not any single image's size -
 * it is the total, because every turn resends every image the transcript
 * holds. A per-image check cannot see that coming, which is the whole reason
 * a running budget exists rather than one more constant.
 */

let workspace: string;
let db: StudioDatabase;
let budget: ImageBudget;
let gate: CallGate;

/** A one-pixel PNG, and a filler buffer for weighing the totals. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SCOPE: ExecutionScope = {
  conversationId: "cnv_1",
  projectId: "proj-1",
  agentId: "studio",
};

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "studio-budget-"));
  db = openDatabase({ path: ":memory:" });
  budget = new ImageBudget();
  gate = new CallGate({
    kernel: new PermissionKernel({
      grants: new PermissionGrantStore(db),
      approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
    }),
    sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })),
  });
  registerFilesystemTools(gate, new FileAccessLog(), { imageBudget: budget });
});

afterEach(() => {
  db.close();
});

function picture(name: string, bytes = 0): string {
  writeFileSync(
    join(workspace, name),
    bytes === 0 ? Buffer.from(TINY_PNG, "base64") : Buffer.alloc(bytes),
  );
  return name;
}

const read = (path: string, scope: ExecutionScope = SCOPE) =>
  gate.call({ name: "native/read", input: { path }, scope });

describe("the image budget", () => {
  it("counts only pictures that were actually handed over", async () => {
    picture("a.png");
    await read("a.png");
    await read("a.png");

    expect(budget.spentOn("cnv_1").images).toBe(2);
    expect(budget.statusMessage("cnv_1")).toContain("18 remaining");
    expect(budget.statusMessage("cnv_1")).toContain("Inline uploads are not counted");
    expect(budget.statusMessage("cnv_1")).toContain("remaining allowance is unknown");
  });

  it("does not charge for a picture it refused", async () => {
    // A read that fails still touched a file. Charging the budget there lets a
    // conversation exhaust its allowance without ever having been shown one.
    picture("huge.png", 6 * 1024 * 1024);
    await expect(read("huge.png")).rejects.toThrow(/limit for one image/i);

    expect(budget.spentOn("cnv_1")).toEqual({ images: 0, bytes: 0 });
  });

  it("stops at the count where the provider changes the rules on every image", async () => {
    // Past twenty images in one request, a stricter per-image dimension limit
    // applies to all of them - including ones that were accepted on earlier
    // turns. It does not degrade gently, so the budget stops short of it.
    picture("a.png");
    for (let taken = 0; taken < MAX_IMAGES_PER_CONVERSATION; taken += 1) {
      await read("a.png");
    }

    await expect(read("a.png")).rejects.toThrow(/already taken in 20 images/i);
  });

  it("stops on the total weight even while the count is fine", async () => {
    // Four large photographs are well inside the count and well past what a
    // 32 MB request can carry once base64 has added a third.
    picture("big.png", 4_500_000);
    await read("big.png");
    await read("big.png");
    await read("big.png");

    await expect(read("big.png")).rejects.toThrow(/already carrying/i);
  });

  it("keeps one conversation's total out of another's", async () => {
    // The limit is a property of a request, and two conversations are two
    // requests. Sharing a total would refuse a fresh conversation its first
    // picture because an unrelated one had been reading screenshots.
    picture("a.png", 4_500_000);
    await read("a.png");
    await read("a.png");
    await read("a.png");

    const elsewhere = { ...SCOPE, conversationId: "cnv_2" };
    await expect(read("a.png", elsewhere)).resolves.toBeDefined();
  });
});
