import { describe, expect, it } from "vitest";

import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
  type CapabilityEffect,
} from "../../src/contracts/capabilities.js";
import {
  allowedWhileUntrusted,
  EFFECT_RULES,
  hasElevatedEffect,
  isReadOnly,
  requiredIsolation,
  requiresUndoPoint,
  satisfiesIsolation,
} from "../../src/contracts/effects.js";
import { resolveAsk } from "../../src/permissions/mode.js";
import { defaultVerdict } from "../../src/permissions/policy.js";
import { EDIT_DESCRIPTOR } from "../../src/tools/filesystem/edit.js";
import { READ_DESCRIPTOR } from "../../src/tools/filesystem/read.js";
import { WRITE_DESCRIPTOR } from "../../src/tools/filesystem/write.js";
import { GIT_DESCRIPTOR } from "../../src/tools/git/index.js";
import { GLOB_DESCRIPTOR } from "../../src/tools/search/glob.js";
import { GREP_DESCRIPTOR } from "../../src/tools/search/grep.js";
import { SHELL_DESCRIPTOR } from "../../src/tools/shell/index.js";

/**
 * The table exists because six files each held their own copy of "what does
 * this effect mean", and one of them disagreed. These tests are the thing that
 * stops a seventh copy appearing: they assert the table's contents directly,
 * and then assert that each reader agrees with it.
 */

function descriptor(effects: readonly CapabilityEffect[]): CapabilityDescriptor {
  return {
    id: { namespace: "test", name: "sample" },
    title: "Sample",
    description: "For tests.",
    effects,
    provenance: NATIVE_PROVENANCE,
    idempotent: true,
  };
}

describe("the effect table", () => {
  it("answers all four questions for all four effects", () => {
    expect(EFFECT_RULES).toStrictEqual({
      read: {
        isolation: "in-process",
        undo: false,
        elevated: false,
        safeUntrusted: true,
      },
      write: {
        isolation: "in-process",
        undo: true,
        elevated: false,
        safeUntrusted: false,
      },
      execute: { isolation: "os", undo: true, elevated: true, safeUntrusted: false },
      network: { isolation: "os", undo: false, elevated: true, safeUntrusted: false },
    });
  });

  it("keeps the isolation answers the sandbox was built on", () => {
    expect(requiredIsolation("read")).toBe("in-process");
    expect(requiredIsolation("write")).toBe("in-process");
    expect(requiredIsolation("execute")).toBe("os");
    expect(requiredIsolation("network")).toBe("os");

    expect(satisfiesIsolation("remote-vm", "os")).toBe(true);
    expect(satisfiesIsolation("in-process", "os")).toBe(false);
  });
});

describe("a capability needs a restore point when any effect earns one", () => {
  it("requires one for write", () => {
    expect(requiresUndoPoint(descriptor(["write"]))).toBe(true);
  });

  // The T-14 bug, as a test. `shell` declares execute and writes anyway, so
  // the old `effects.includes("write")` check took no snapshot at all.
  it("requires one for execute, which is what T-14 was", () => {
    expect(requiresUndoPoint(descriptor(["execute"]))).toBe(true);
    expect(requiresUndoPoint(SHELL_DESCRIPTOR)).toBe(true);
  });

  it("does not require one for reading", () => {
    expect(requiresUndoPoint(descriptor(["read"]))).toBe(false);
  });

  // A request leaves the machine; it does not change the project on the way
  // out. What comes back is C-10's problem, and a snapshot is not its tool.
  it("does not require one for the network alone", () => {
    expect(requiresUndoPoint(descriptor(["network"]))).toBe(false);
  });

  it("requires one when only one of several effects earns it", () => {
    expect(requiresUndoPoint(descriptor(["read", "network", "execute"]))).toBe(true);
  });
});

describe("every reader agrees with the table", () => {
  const cases: readonly (readonly [CapabilityEffect, boolean])[] = [
    ["read", false],
    ["write", false],
    ["execute", true],
    ["network", true],
  ];

  for (const [effect, elevated] of cases) {
    it(`treats ${effect} as ${elevated ? "elevated" : "ordinary"} everywhere`, () => {
      const capability = descriptor([effect]);

      expect(hasElevatedEffect(capability)).toBe(elevated);
      // Auto Edit is exactly "nothing elevated", so it must never disagree.
      expect(resolveAsk("auto-edit", capability)).toBe(elevated ? "ask" : "allow");
    });
  }

  it("allows only reading in a folder that is not trusted", () => {
    expect(allowedWhileUntrusted(descriptor(["read"]))).toBe(true);
    expect(allowedWhileUntrusted(descriptor(["write"]))).toBe(false);
    expect(allowedWhileUntrusted(descriptor(["execute"]))).toBe(false);
    expect(allowedWhileUntrusted(descriptor(["network"]))).toBe(false);
    expect(allowedWhileUntrusted(descriptor(["read", "write"]))).toBe(false);
  });

  it("allows a native read-only capability by default and asks for the rest", () => {
    expect(isReadOnly(descriptor(["read"]))).toBe(true);
    expect(defaultVerdict(descriptor(["read"])).verdict).toBe("allow");
    expect(defaultVerdict(descriptor(["read", "write"])).verdict).toBe("ask");
  });

  it("still asks in Manual and still allows in Full Auto", () => {
    expect(resolveAsk("manual", descriptor(["read"]))).toBe("ask");
    expect(resolveAsk("full-auto", descriptor(["execute"]))).toBe("allow");
  });
});

/**
 * The declarations themselves, in one list.
 *
 * Not a restatement of the source. It is the place a change to what a tool can
 * do has to be admitted out loud — `K-04` is on this list as a known wrong
 * answer, so it cannot be forgotten quietly.
 */
describe("what each shipped tool declares", () => {
  const shipped: readonly (readonly [
    string,
    CapabilityDescriptor,
    readonly CapabilityEffect[],
  ])[] = [
    ["read", READ_DESCRIPTOR, ["read"]],
    ["glob", GLOB_DESCRIPTOR, ["read"]],
    ["grep", GREP_DESCRIPTOR, ["read"]],
    ["write", WRITE_DESCRIPTOR, ["write"]],
    ["edit", EDIT_DESCRIPTOR, ["write"]],
    ["git", GIT_DESCRIPTOR, ["read", "write"]],
    ["shell", SHELL_DESCRIPTOR, ["execute"]],
  ];

  for (const [name, capability, effects] of shipped) {
    it(`${name} declares ${effects.join(", ")}`, () => {
      expect(capability.effects).toStrictEqual(effects);
    });
  }

  it("gives every tool that changes the project a restore point", () => {
    for (const [name, capability] of shipped) {
      const changes = name !== "read" && name !== "glob" && name !== "grep";
      expect(requiresUndoPoint(capability)).toBe(changes);
    }
  });

  // K-04, recorded as a failing expectation would be a failing suite, so it is
  // recorded as an assertion of the wrong answer instead. When git's effects
  // are fixed, this test fails and points at the issue that explains why.
  it("still under-declares git, which is K-04", () => {
    expect(GIT_DESCRIPTOR.effects).not.toContain("network");
    expect(hasElevatedEffect(GIT_DESCRIPTOR)).toBe(false);
    expect(resolveAsk("auto-edit", GIT_DESCRIPTOR)).toBe("allow");
  });
});
