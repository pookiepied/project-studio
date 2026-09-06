import { describe, expect, it } from "vitest";

import { bootLog } from "../../src/platform/boot-log.js";

describe("the boot log", () => {
  it("announces a phase on stderr with a monotonic offset", () => {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });

    try {
      bootLog("probe phase");
    } finally {
      process.stderr.write = original;
    }

    expect(written).toHaveLength(1);
    const line = written[0] ?? "";
    expect(line.startsWith("[harness-boot +")).toBe(true);
    expect(line.endsWith("ms] probe phase\n")).toBe(true);

    // The offset is a monotonic duration, not a wall clock: one decimal, no
    // sign, and it grows across calls.
    const offset = Number(line.slice("[harness-boot +".length, line.indexOf("ms]")));
    expect(Number.isFinite(offset)).toBe(true);
    expect(offset).toBeGreaterThanOrEqual(0);
  });
});
