import { describe, expect, it } from "vitest";

import { offerScopes, resolveScope } from "../../src/permissions/scopes.js";

const ROOT = "C:/work/app";

// No default parameter: passing `undefined` explicitly would trigger it, and
// the "no known workspace" case would silently run with one.
const paths = (resource: string, root: string | undefined) =>
  offerScopes({ resource, kind: "path", root });

const inRoot = (resource: string) => paths(resource, ROOT);

describe("what a user may be offered for a file", () => {
  it("offers this file, its folder, and the project", () => {
    const scopes = inRoot(`${ROOT}/src/tools/read.ts`);

    expect(scopes.map((scope) => scope.id)).toEqual([
      "this-file",
      "this-folder",
      "this-project",
    ]);
  });

  it("puts the narrowest first, where a hurried click lands", () => {
    const [first] = inRoot(`${ROOT}/src/a.ts`);

    expect(first?.pattern).toBe(`${ROOT}/src/a.ts`);
  });

  it("never offers anything above the workspace", () => {
    // The rung that must not exist. One click authorizing the user's home
    // directory cannot be phrased honestly in a dialog, so it is not offered.
    const scopes = inRoot(`${ROOT}/src/a.ts`);

    for (const scope of scopes) {
      expect(scope.pattern?.startsWith(ROOT)).toBe(true);
    }
  });

  it("does not climb out of the workspace for a file at its root", () => {
    const scopes = inRoot(`${ROOT}/config.json`);

    expect(scopes.map((scope) => scope.pattern)).toEqual([
      `${ROOT}/config.json`,
      `${ROOT}/**`,
    ]);
  });

  it("collapses two rungs that describe the same set", () => {
    // Asking a question with one real answer wastes the user's attention on
    // the occasion we most need it.
    const scopes = inRoot(ROOT);
    const patterns = scopes.map((scope) => scope.pattern);

    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("stops at the folder when there is no known workspace", () => {
    const scopes = paths("C:/loose/file.ts", undefined);

    expect(scopes.map((scope) => scope.id)).toEqual(["this-file", "this-folder"]);
  });

  it("describes each choice without showing a glob", () => {
    // Patterns are ours; labels are the user's. A dialog that renders `src/**`
    // is asking someone to evaluate a pattern language mid-task.
    for (const scope of inRoot(`${ROOT}/src/a.ts`)) {
      expect(scope.label).not.toMatch(/[*]/);
      expect(scope.detail).not.toMatch(/[*]/);
    }
  });
});

describe("what a user may be offered for a command", () => {
  it("offers only the command itself", () => {
    const scopes = offerScopes({ resource: "git:push", kind: "command", root: ROOT });

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.pattern).toBe("git:push");
  });

  it("never offers a whole command family", () => {
    // `git:*` contains push, reset, and clean. Approving `git status` must not
    // be one click away from authorizing a history rewrite; widening to a whole
    // family belongs in settings, read in full and away from a waiting agent.
    const scopes = offerScopes({ resource: "git:status", kind: "command", root: ROOT });

    for (const scope of scopes) {
      expect(scope.pattern).not.toContain("*");
    }
  });
});

describe("a capability whose arguments narrow nothing", () => {
  it("offers the capability itself and says so", () => {
    const scopes = offerScopes({ resource: undefined, kind: "path", root: ROOT });

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.pattern).toBeUndefined();
  });
});

describe("resolving what the approver chose", () => {
  const offered = inRoot(`${ROOT}/src/a.ts`);

  it("returns the chosen scope", () => {
    const { scope, recognized } = resolveScope(offered, "this-folder");

    expect(recognized).toBe(true);
    expect(scope?.pattern).toBe(`${ROOT}/src/**`);
  });

  it("treats no answer as the narrowest", () => {
    expect(resolveScope(offered, undefined).scope?.pattern).toBe(`${ROOT}/src/a.ts`);
  });

  it("narrows an answer we never offered, and says it was not recognized", () => {
    // The safety property: a broken approver makes the product repetitive, not
    // permissive. The flag exists so the breakage is reportable rather than
    // invisible.
    const { scope, recognized } = resolveScope(offered, "this-whole-disk");

    expect(recognized).toBe(false);
    expect(scope?.pattern).toBe(`${ROOT}/src/a.ts`);
  });
});
