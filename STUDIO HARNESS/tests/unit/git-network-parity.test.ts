import { describe, expect, it } from "vitest";

import { BASE_POLICY } from "../../src/permissions/policy.js";
import { NETWORK, classifyGit } from "../../src/tools/git/classify.js";

/**
 * The two lists of network-touching git subcommands must agree.
 *
 * `permissions/policy.ts` keeps its own copy and says why: permissions must not
 * import from tools, so the list is duplicated rather than shared. That is a
 * reasonable call about layering. What was missing is anything that notices
 * when the copies drift — and they drift silently, because each list is
 * internally consistent on its own.
 *
 * The failure that drift produces is specific: `policy.ts` returns `ask` for a
 * network subcommand, and policy `ask` is never resolved away by Auto-Edit
 * mode. A subcommand present in one list and absent from the other therefore
 * either reaches the network without a prompt, or prompts for something that
 * never touches a remote. The first is the one that matters.
 *
 * This is a behavioural test rather than a comparison of two arrays: it drives
 * the real policy rule, so it fails if the rule's *matching* changes as well as
 * if its list does. Meta-task #78.
 */

/**
 * The rule under test, found by id rather than by probing every rule.
 *
 * The first version of this test called `evaluate` on each rule until one
 * answered `"ask"`, which crashed: the neighbouring `third-party` rule reads
 * `capability.provenance.author`, and the stub request did not have one. Doing
 * it by id keeps this test to the one rule it is about.
 */
const gitRule = BASE_POLICY.find((rule) => rule.id === "git-network");

function verdictFor(subcommand: string): unknown {
  return gitRule?.evaluate({
    capability: { id: { namespace: "native", name: "git" } },
    resource: `git:${subcommand}`,
  } as never);
}

describe("the git network subcommand lists in policy and classify", () => {
  it("has a policy rule that asks about a known network subcommand", () => {
    // Guards the test itself. Every assertion below compares against
    // `undefined` on one side, so a renamed or removed rule would make the
    // whole file pass while checking nothing.
    expect(gitRule).toBeDefined();
    expect(verdictFor("push")).toBe("ask");
  });

  it("asks about every subcommand that classify calls network", () => {
    for (const subcommand of NETWORK) {
      expect(classifyGit(subcommand)).toBe("network");
      expect(verdictFor(subcommand)).toBe("ask");
    }
  });

  it("does not ask about a subcommand classify does not call network", () => {
    for (const subcommand of ["log", "status", "diff", "add", "commit"]) {
      expect(classifyGit(subcommand)).not.toBe("network");
      expect(verdictFor(subcommand)).toBeUndefined();
    }
  });
});
