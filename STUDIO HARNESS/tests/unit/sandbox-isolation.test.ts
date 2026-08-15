import { describe, expect, it } from "vitest";

import { SandboxError } from "../../src/sandbox/errors.js";
import {
  assertIsolationAvailable,
  isolationAvailable,
  isolationForKind,
  ISOLATION_ENFORCED,
  OS_ISOLATION_BACKENDS,
  selectIsolation,
  type IsolationBackend,
} from "../../src/sandbox/isolation.js";
import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
  type CapabilityEffect,
} from "../../src/contracts/capabilities.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";

/**
 * The seam meta-task #15 is built on, and the gate that stops it being
 * half-built.
 *
 * `LocalSandbox.assertSupports` used to compare the isolation an effect needs
 * against the isolation it has, find it short, and fall through to a comment
 * saying so. True and inert. This file covers the replacement: one place that
 * measures what the host can contain, and one refusal that fires when it cannot.
 *
 * The last block is the important one. No backend exists yet, so nothing is
 * enforced yet, and a transitional state written as a comment is a state
 * somebody ships past. Written as an assertion, the first backend to land
 * cannot land with enforcement still off.
 */

const workspace = process.cwd();

/** A whole descriptor; only `effects` matters to anything in this file. */
function capability(name: string, effects: readonly CapabilityEffect[]): CapabilityDescriptor {
  return {
    id: { namespace: "native", name },
    title: name,
    description: `${name} for the isolation tests`,
    effects,
    provenance: NATIVE_PROVENANCE,
    idempotent: false,
  };
}

function backend(name: string, available: boolean): IsolationBackend {
  return { name, level: "os", available: () => available };
}

describe("the kind of a child decides what contains it", () => {
  it("does not contain first-party tools", () => {
    // Not an oversight, and the reason is concrete: `runProcess` is the single
    // spawn point for the model's shell commands *and* for the `git` calls the
    // snapshot system depends on. Containing this row takes undo down with it.
    expect(isolationForKind("tool")).toBe("in-process");
  });

  it("requires OS isolation for anything we did not choose", () => {
    expect(isolationForKind("shell")).toBe("os");
    expect(isolationForKind("mcp-server")).toBe("os");
  });
});

describe("selectIsolation", () => {
  it("reports in-process with no backend, and enforces nothing", () => {
    // Today's real state. Enforcing here would refuse every execute and
    // network capability on every platform, which is not a safer product.
    const support = selectIsolation([]);
    expect(support.level).toBe("in-process");
    expect(support.backend).toBeUndefined();
    expect(support.enforcing).toBe(false);
  });

  it("enforces once a backend exists, even when this host cannot run it", () => {
    // The #32 case, stated exactly: the build believes containment exists and
    // this machine cannot supply it. That is a refusal, not a fall-through.
    const support = selectIsolation([backend("bwrap", false)]);
    expect(support.level).toBe("in-process");
    expect(support.enforcing).toBe(true);
  });

  it("uses a backend that probes as available", () => {
    const support = selectIsolation([backend("appcontainer", true)]);
    expect(support.level).toBe("os");
    expect(support.backend).toBe("appcontainer");
  });

  it("ignores an unavailable backend in favour of an available one", () => {
    // Order matters here in a way that is easy to get wrong: the first entry
    // must not win merely by being first.
    const support = selectIsolation([backend("bwrap", false), backend("appcontainer", true)]);
    expect(support.backend).toBe("appcontainer");
  });
});

describe("assertIsolationAvailable", () => {
  it("throws unsupported_isolation when a backend exists and cannot deliver", () => {
    const support = selectIsolation([backend("bwrap", false)]);
    expect(() => {
      assertIsolationAvailable("os", support);
    }).toThrow(SandboxError);

    try {
      assertIsolationAvailable("os", support);
      expect.unreachable("should have thrown");
    } catch (error) {
      // The kind matters, not just that something threw: `unsupported_isolation`
      // was declared in `sandbox/errors.ts` and raised nowhere at all until now.
      expect((error as SandboxError).kind).toBe("unsupported_isolation");
    }
  });

  it("permits the shortfall while nothing is enforced", () => {
    expect(() => {
      assertIsolationAvailable("os", selectIsolation([]));
    }).not.toThrow();
  });

  it("permits anything the host already satisfies", () => {
    expect(isolationAvailable("in-process", selectIsolation([]))).toBe(true);
    expect(isolationAvailable("os", selectIsolation([backend("x", true)]))).toBe(true);
  });
});

describe("LocalSandbox consults the measured support", () => {
  const policy = createSandboxPolicy({ workspaceRoot: workspace });

  it("still admits execute while nothing is enforced", () => {
    const sandbox = new LocalSandbox(policy, selectIsolation([]));
    expect(
      sandbox.supports(capability("shell", ["execute"])),
    ).toBe(true);
  });

  it("refuses execute once a backend exists that this host cannot run", () => {
    // The behaviour the whole seam is for, exercised on a machine that has no
    // backend at all. A refusal first seen on the day it ships is a refusal
    // nobody has watched work.
    const sandbox = new LocalSandbox(policy, selectIsolation([backend("bwrap", false)]));
    expect(
      sandbox.supports(capability("shell", ["execute"])),
    ).toBe(false);
  });

  it("keeps admitting read, which needs no isolation at all", () => {
    const sandbox = new LocalSandbox(policy, selectIsolation([backend("bwrap", false)]));
    expect(
      sandbox.supports(capability("read", ["read"])),
    ).toBe(true);
  });
});

describe("the transitional state cannot outlive the first backend", () => {
  it("records that nothing is contained yet, and fails when that changes", () => {
    // Reads as a strange thing to assert, and is deliberate. This is the
    // recorded state of #15: no OS backend exists, so `execute` and `network`
    // run uncontained. It fails the moment that stops being true — which is
    // exactly when the documentation still claiming containment has to be
    // corrected (#41) and when this file's expectations need rewriting.
    //
    // Mutation-verified: adding a backend to the registry fails here.
    expect(OS_ISOLATION_BACKENDS).toHaveLength(0);
    expect(ISOLATION_ENFORCED).toBe(false);
  });

  it("derives enforcement from the registry rather than from a second switch", () => {
    // Deliberately *not* asserted as `ISOLATION_ENFORCED === length > 0`. That
    // was the first version of this test and it was a tautology — the constant
    // is computed from exactly that expression, so nothing could ever make it
    // fail. Caught by mutating the registry and watching it pass.
    //
    // What is worth pinning is the property that made the tautology tempting:
    // there is no way to register a backend and leave enforcement off, because
    // there is no independent switch to forget. So the check is that the two
    // agree *through* `selectIsolation`, which is what callers actually use.
    expect(selectIsolation(OS_ISOLATION_BACKENDS).enforcing).toBe(ISOLATION_ENFORCED);
    expect(selectIsolation([backend("any", false)]).enforcing).toBe(true);
  });
});
