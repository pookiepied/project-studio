import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StudioRuntime } from "../../src/application/studio-runtime.js";
import { exploreDefinition } from "../../src/agents/definitions/explore.js";
import { generalDefinition } from "../../src/agents/definitions/general.js";
import { ExtensionSelectionStore, conversationScope } from "../../src/extend/selection.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The delegate skills intersection (S5.3), against the real runtime.
 *
 * The definition names bundled skills; the conversation's selection chain
 * decides which of them are on. The intersection — and nothing else — is
 * what the delegate's render mounts, so the tests drive both sides of it:
 * a definition naming a skill the conversation has not switched on mounts
 * nothing, a switched-on skill a definition does not name mounts nothing,
 * and the two agreeing is the one row that mounts. The registry refuses a
 * definition naming a non-bundled skill at load, so the named side is
 * always real; the enablement side is the live half, which is why these
 * tests write the selection rows themselves.
 */

let database: StudioDatabase;
let home: string;
let previousHome: string | undefined;
let runtime: StudioRuntime;
let selection: ExtensionSelectionStore;

const CONVERSATION = "cnv_skills";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "studio-delegate-skills-"));
  previousHome = process.env.PROJECT_STUDIO_HOME;
  process.env.PROJECT_STUDIO_HOME = join(home, "home");
  database = openDatabase({ path: join(home, "studio.db") });
  runtime = new StudioRuntime({ database });
  selection = new ExtensionSelectionStore(database);
});

afterEach(async () => {
  await runtime.stop();
  database.close();
  process.env.PROJECT_STUDIO_HOME = previousHome;
  await rm(home, { recursive: true, force: true });
});

describe("the delegate skills intersection", () => {
  it("mounts a bundled skill the conversation switched on and the definition names", async () => {
    selection.set(
      { kind: "skill", extensionId: "create-skill", scope: conversationScope(CONVERSATION) },
      true,
    );
    const mounted = runtime.delegateSkills(CONVERSATION, {
      ...generalDefinition,
      skills: { ids: ["create-skill"] },
    });
    // The mounted reference's id is Flue's packaged form
    // (`skill:<name>:<hash>`); the name is the definition's vocabulary.
    expect(mounted.map((skill) => skill.name)).toEqual(["create-skill"]);
  });

  it("mounts nothing a definition does not name, however enabled", async () => {
    selection.set(
      { kind: "skill", extensionId: "create-skill", scope: conversationScope(CONVERSATION) },
      true,
    );
    // The explorer's own list is empty: the enabled skill stays the
    // conversation agent's, because the intersection is the whole policy.
    expect(runtime.delegateSkills(CONVERSATION, exploreDefinition)).toEqual([]);
  });

  it("mounts nothing a conversation has not switched on, however named", async () => {
    const mounted = runtime.delegateSkills(CONVERSATION, {
      ...generalDefinition,
      skills: { ids: ["create-skill"] },
    });
    expect(mounted).toEqual([]);
  });

  it("mounts nothing without a conversation to stand in", async () => {
    // The undefined-conversation arm: a delegate whose frame carries no
    // parent instance link cannot say which chain to intersect with, and
    // mounting nothing is the honest answer.
    const mounted = runtime.delegateSkills(undefined, {
      ...generalDefinition,
      skills: { ids: ["create-skill"] },
    });
    expect(mounted).toEqual([]);
  });
});
