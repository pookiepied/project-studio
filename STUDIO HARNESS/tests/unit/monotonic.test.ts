import { describe, expect, it } from "vitest";

import { CallBounds } from "../../src/tools/bounds.js";
import { capabilityKey } from "../../src/contracts/capabilities.js";

function fakeCapability(idempotent: boolean) {
  return {
    id: { namespace: "native" as const, name: idempotent ? "read" : "write" },
    title: "test",
    description: "test",
    inputSchema: { type: "object" },
    effects: [] as string[],
    provenance: { sourceId: "test", kind: "native" as const },
    idempotent,
  };
}

describe("monotonic deadlines", () => {
  it("deadline is based on real time, not wall-clock jumps", async () => {
    const bounds = new CallBounds({ timeoutMs: 80 });
    const descriptor = fakeCapability(true) as any;

    const originalNow = Date.now;
    // Jump wall clock forward by a day — a wall-clock deadline would fire immediately.
    // A monotonic deadline must still wait ~80ms real time.
    (Date as any).now = () => originalNow() + 86_400_000;

    const start = performance.now();
    await expect(bounds.run(descriptor, undefined, () => new Promise(() => {}))).rejects.toThrow(/took too long/i);
    const elapsed = performance.now() - start;

    (Date as any).now = originalNow;

    expect(elapsed).toBeGreaterThanOrEqual(60);
    expect(elapsed).toBeLessThan(300);
  });

  it("suspend/resume does not make deadline expire immediately or never", async () => {
    const bounds = new CallBounds({ timeoutMs: 60 });
    const descriptor = fakeCapability(true) as any;

    // Simulate suspend by just waiting — performance.now continues, Date.now jump does not matter.
    const start = performance.now();
    const run = bounds.run(descriptor, undefined, () => new Promise(() => {}));
    await new Promise((r) => setTimeout(r, 10));
    // Wall clock jumps backward
    const originalNow = Date.now;
    (Date as any).now = () => originalNow() - 86_400_000;
    await expect(run).rejects.toThrow(/took too long/i);
    const elapsed = performance.now() - start;
    (Date as any).now = originalNow;
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });
});
