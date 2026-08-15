import { describe, expect, it } from "vitest";

import { PassthroughContextOptimizer } from "../../src/context/context-optimizer.js";

/**
 * Moved out of `architecture.test.ts`.
 *
 * It was filed there, which made it read as an architectural guarantee about
 * the running system. It is not: nothing wires this optimizer, so no assertion
 * about it can say anything about a live turn. What it does check is the one
 * property ADR 0003 actually requires of the default implementation — that the
 * canonical conversation is never replaced — and that is a unit test of a unit.
 *
 * The port itself is declared-not-wired; see `context-optimizer.ts`.
 */
describe("the passthrough context optimizer", () => {
  it("returns the canonical context unchanged, and by identity", async () => {
    const optimizer = new PassthroughContextOptimizer();
    const context = { messages: [{ role: "user", content: "hello" }] };

    const result = await optimizer.optimize(context);

    expect(result.optimizer).toBe("passthrough");
    // Identity, not equality. ADR 0003's rule is that an optimizer preserves
    // the original content; a copy that happens to match would pass a deep
    // comparison while breaking the property for any caller holding the
    // canonical object.
    expect(result.canonical).toBe(context);
    expect(result.optimized).toBe(context);
  });
});
