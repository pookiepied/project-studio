import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  CapabilityAuthor,
  CapabilityDescriptor,
  CapabilityEffect,
  ExecutionScope,
} from "../../src/contracts/capabilities.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../src/permissions/kernel.js";
import {
  describeMode,
  isExecutionMode,
  requiresUndo,
  resolveAsk,
  type ExecutionMode,
} from "../../src/permissions/mode.js";
import {
  posture,
  UNGATED_POSTURE,
  WorkspaceTrustStore,
  trustKey,
} from "../../src/permissions/trust.js";
import { conversationWorkspaceDirectory } from "../../src/platform/paths.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

const ROOT = "/work/project";

function capability(
  name: string,
  effects: CapabilityEffect[],
  author: CapabilityAuthor = "studio",
): CapabilityDescriptor {
  const ours = author === "studio";
  return {
    id: { namespace: ours ? "native" : "mcp:example", name },
    title: name,
    description: name,
    effects,
    provenance: {
      origin: ours ? "native" : "mcp",
      sourceId: ours ? "project-studio" : "example-server",
      author,
    },
    idempotent: true,
  };
}

const READ = capability("read", ["read"]);
const WRITE = capability("write", ["write"]);
const SHELL = capability("shell", ["execute"]);
const CONNECTED_SHELL = capability("run", ["execute"], "third-party");

let db: StudioDatabase;
let grants: PermissionGrantStore;
let trust: WorkspaceTrustStore;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  grants = new PermissionGrantStore(db);
  trust = new WorkspaceTrustStore(db);
});

afterEach(() => {
  db.close();
});

function kernel(mode: ExecutionMode = "manual") {
  const instance = new PermissionKernel({
    grants,
    posture: posture({ mode: () => mode, trust }),
  });
  for (const descriptor of [READ, WRITE, SHELL, CONNECTED_SHELL]) {
    instance.register(descriptor);
  }
  return instance;
}

function verdict(instance: PermissionKernel, descriptor: CapabilityDescriptor) {
  return instance.evaluate(descriptor.id, SCOPE, {
    resource: `${ROOT}/a.txt`,
    kind: "path",
    root: ROOT,
  });
}

describe("workspace trust", () => {
  it("starts undecided, which is not trusted", () => {
    expect(trust.decision(ROOT)).toBe("undecided");
  });

  it("still allows reading, so the folder can be looked at before it is trusted", () => {
    expect(verdict(kernel(), READ).verdict).toBe("allow");
  });

  it("denies writing rather than asking about it", () => {
    // Asking would let a model that keeps trying collect the same authority one
    // click at a time, which is what deciding once about the folder prevents.
    const decision = verdict(kernel(), WRITE);

    expect(decision.verdict).toBe("deny");
    expect(decision.reason).toMatch(/has not been trusted/i);
  });

  it("allows writing once the folder is trusted", () => {
    trust.set(ROOT, true);

    expect(verdict(kernel(), WRITE).verdict).toBe("ask");
  });

  it("distinguishes a declined folder from one never asked about", () => {
    trust.set(ROOT, false);

    expect(trust.decision(ROOT)).toBe("untrusted");
    expect(verdict(kernel(), WRITE).reason).toMatch(/marked as not trusted/i);
  });

  it("outranks a stored grant, so distrusting a folder takes effect", () => {
    trust.set(ROOT, true);
    grants.grant(WRITE.id, SCOPE, "always", undefined);
    expect(verdict(kernel(), WRITE).verdict).toBe("allow");

    trust.set(ROOT, false);

    expect(verdict(kernel(), WRITE).verdict).toBe("deny");
  });

  it("treats the same folder spelled differently as one folder", () => {
    // Only meaningful on Windows, where the check is case-insensitive; on other
    // platforms this asserts that resolution alone still normalises.
    expect(trustKey(`${ROOT}/nested/..`)).toBe(trustKey(ROOT));
  });
});

describe("execution modes", () => {
  beforeEach(() => {
    trust.set(ROOT, true);
  });

  it("asks about a write in Manual", () => {
    expect(verdict(kernel("manual"), WRITE).verdict).toBe("ask");
  });

  it("allows a write in Auto Edit", () => {
    expect(verdict(kernel("auto-edit"), WRITE).verdict).toBe("allow");
  });

  it("still asks before running code in Auto Edit", () => {
    expect(verdict(kernel("auto-edit"), SHELL).verdict).toBe("ask");
  });

  it("allows running code in Full Auto", () => {
    expect(verdict(kernel("full-auto"), SHELL).verdict).toBe("allow");
  });

  it("explains itself with the mode rather than with a default", () => {
    const decision = verdict(kernel("auto-edit"), WRITE);

    expect(decision.source).toBe("default");
    expect(decision.reason).toBe(describeMode("auto-edit"));
  });
});

describe("what a mode may not do", () => {
  beforeEach(() => {
    trust.set(ROOT, true);
  });

  it("does not override a policy ask, even in Full Auto", () => {
    // BASE_POLICY forces an ask before a connected server runs code. If a mode
    // could resolve that, every rule in the policy would be advisory.
    expect(verdict(kernel("full-auto"), CONNECTED_SHELL).verdict).toBe("ask");
  });

  it("leaves a policy ask sourced to the policy, not the mode", () => {
    expect(verdict(kernel("full-auto"), CONNECTED_SHELL).source).toBe("policy");
  });
});

describe("the mode resolver on its own", () => {
  it("never resolves an ask in Manual", () => {
    expect(resolveAsk("manual", WRITE)).toBe("ask");
    expect(resolveAsk("manual", READ)).toBe("ask");
  });

  it("bounds Auto Edit by effect", () => {
    expect(resolveAsk("auto-edit", WRITE)).toBe("allow");
    expect(resolveAsk("auto-edit", SHELL)).toBe("ask");
  });

  it("does not check provenance, because the policy already did", () => {
    // A connected server's write tool is resolved like any other write here.
    // What protects it is the policy rule above, in one place rather than two.
    expect(resolveAsk("auto-edit", capability("w", ["write"], "third-party"))).toBe("allow");
  });

  it("requires undo only where nobody is watching", () => {
    expect(requiresUndo("manual")).toBe(false);
    expect(requiresUndo("auto-edit")).toBe(false);
    expect(requiresUndo("full-auto")).toBe(true);
  });

  it("recognises only the three modes", () => {
    expect(isExecutionMode("full-auto")).toBe(true);
    expect(isExecutionMode("yolo")).toBe(false);
  });
});

describe("a workspace this application made for itself", () => {
  let db: StudioDatabase;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  it("is trusted without anyone having been asked", () => {
    const store = new WorkspaceTrustStore(db);
    const workspace = conversationWorkspaceDirectory("cnv_example");

    expect(store.decision(workspace)).toBe("trusted");
    // Structural, not stored: the table still holds only decisions a person
    // made, so this folder never appears beside one the user really approved.
    expect(store.list()).toEqual([]);
  });

  it("still asks about a folder the user pointed at", () => {
    const store = new WorkspaceTrustStore(db);

    expect(store.decision(ROOT)).toBe("undecided");
  });
});

describe("the ungated posture", () => {
  it("is what the harness did before trust existed", () => {
    // Named rather than inlined so it is visible in review that a caller using
    // it has skipped a safeguard.
    expect(UNGATED_POSTURE.mode()).toBe("manual");
    expect(UNGATED_POSTURE.trust(undefined)).toBe("trusted");
  });
});
