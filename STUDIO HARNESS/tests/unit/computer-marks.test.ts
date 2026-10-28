import { describe, expect, it } from "vitest";

import { displaysFrom, markSet, MAX_MARK_SECONDS } from "../../src/computer/marks.js";

const displays = displaysFrom([{ index: 0, x: 0, y: 0, width: 1920, height: 1080 }, { index: 1, x: 1920, y: 0, width: 2560, height: 1440 }, { index: 2, width: 0 }]);

describe("marks on the person's screen", () => {
  it("keeps only displays with a place and a size", () => {
    expect(displays.map((display) => display.index)).toEqual([0, 1]);
  });

  it("places marks on the display named, with its place on the desktop", () => {
    const set = markSet({ display: 1, marks: [{ kind: "arrow", x: 10, y: 10, toX: 200, toY: 300, label: "here" }] }, displays, 1_000);
    expect(set.display).toEqual({ index: 1, x: 1920, y: 0, width: 2560, height: 1440 });
    expect(set.marks).toEqual([{ kind: "arrow", x: 10, y: 10, toX: 200, toY: 300, label: "here" }]);
    expect(set.expiresAt).toBe(7_000);
  });

  it("refuses marks off the display rather than clamping them somewhere else", () => {
    expect(() => markSet({ display: 0, marks: [{ kind: "point", x: 1920, y: 5 }] }, displays, 0)).toThrow(/not on display 0/);
    expect(() => markSet({ display: 0, marks: [{ kind: "box", x: 1900, y: 5, width: 40, height: 10 }] }, displays, 0)).toThrow(/stay on the display/);
    expect(() => markSet({ display: 0, marks: [{ kind: "arrow", x: 5, y: 5 }] }, displays, 0)).toThrow(/toX and toY/);
    expect(() => markSet({ display: 3, marks: [{ kind: "point", x: 5, y: 5 }] }, displays, 0)).toThrow(/no display 3/);
    expect(() => markSet({ marks: [{ kind: "point", x: 5, y: 5 }] }, displays, 0)).toThrow(/Give the display/);
  });

  it("keeps a handful of marks, a short life and a one-line label", () => {
    const point = { kind: "point", x: 1, y: 1 };
    expect(() => markSet({ display: 0, marks: Array.from({ length: 7 }, () => point) }, displays, 0)).toThrow(/at most 6/);
    const set = markSet({ display: 0, seconds: 999, marks: [{ ...point, label: `line\nbreak${"x".repeat(80)}` }] }, displays, 0);
    expect(set.expiresAt).toBe(MAX_MARK_SECONDS * 1_000);
    expect(set.marks[0]?.label).toMatch(/^line break/);
    expect(set.marks[0]?.label?.length).toBeLessThanOrEqual(48);
  });
});
