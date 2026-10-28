import { describe, expect, it } from "vitest";

import { EVENT_WINDOW_MS, MAX_EVENTS, REST_MS, sampleFrom, ScreenWatch, type PulseSample } from "../../src/computer/screen-watch.js";

const front = { handle: 1, title: "Notes", app: "notes" };
const quiet = { buttons: 0, keys: 0, wheels: 0 };

function at(ms: number, x: number, y: number, display = 0, extra: Partial<PulseSample> = {}): PulseSample {
  return { at: ms, pointer: { x, y, display }, front, input: quiet, ...extra };
}

describe("the screen watch", () => {
  it("reports a rest once, when the pointer has stayed put long enough, and lets it grow", () => {
    const watch = new ScreenWatch();
    watch.sample(at(0, 100, 100));
    watch.sample(at(REST_MS - 100, 104, 102));
    expect(watch.recent(REST_MS)).toEqual([]);
    watch.sample(at(REST_MS, 101, 99));
    watch.sample(at(REST_MS + 500, 100, 100));
    const rests = watch.recent(REST_MS + 500).filter((event) => event.kind === "rest");
    expect(rests).toEqual([expect.objectContaining({ at: 0, x: 100, y: 100, ms: REST_MS + 500, title: "Notes" })]);
  });

  it("does not report movement that never stops", () => {
    const watch = new ScreenWatch();
    for (let step = 0; step < 20; step += 1) watch.sample(at(step * 500, step * 40, 10));
    expect(watch.recent(10_000)).toEqual([]);
  });

  it("reports crossing to another display and a new window in front, but not the window already there", () => {
    const watch = new ScreenWatch();
    watch.sample(at(0, 10, 10, 0));
    watch.sample(at(500, 10, 10, 1, { front: { handle: 2, title: "Figma", app: "figma" } }));
    expect(watch.recent(500).map((event) => event.kind)).toEqual(["display", "window"]);
    expect(watch.recent(500)[1]).toMatchObject({ app: "figma", title: "Figma" });
  });

  it("counts the person's input as differences between running totals, and a drop as a fresh run", () => {
    const watch = new ScreenWatch();
    expect(watch.sample(at(0, 0, 0, 0, { input: { buttons: 2, keys: 0, wheels: 0 } }))).toBe(true);
    expect(watch.sample(at(500, 0, 0, 0, { input: { buttons: 2, keys: 0, wheels: 0 } }))).toBe(false);
    watch.sample(at(1000, 0, 0, 0, { input: { buttons: 3, keys: 5, wheels: 0 } }));
    watch.sample(at(5000, 0, 0, 0, { input: { buttons: 1, keys: 0, wheels: 0 } }));
    const inputs = watch.recent(5000).filter((event) => event.kind === "input");
    expect(inputs).toEqual([
      expect.objectContaining({ clicks: 3, keys: 5 }),
      expect.objectContaining({ clicks: 1, keys: 0 }),
    ]);
  });

  it("forgets events past the window and keeps at most the newest few", () => {
    const watch = new ScreenWatch();
    for (let index = 0; index < MAX_EVENTS + 5; index += 1) watch.drew(index, { shape: "dot", display: 0, x: index, y: 0, width: 0, height: 0 });
    expect(watch.recent(MAX_EVENTS + 5)).toHaveLength(MAX_EVENTS);
    expect(watch.recent(MAX_EVENTS + 5)[0]).toMatchObject({ x: 5 });
    expect(watch.recent(MAX_EVENTS + 5 + EVENT_WINDOW_MS + 1)).toEqual([]);
  });

  it("reads a pulse answer, and refuses one without a pointer", () => {
    expect(sampleFrom({ pointer: { x: 1.4, y: 2, display: 0 }, front: null, input: { buttons: 1 } }, 9)).toEqual({ at: 9, pointer: { x: 1, y: 2, display: 0 }, front: null, input: { buttons: 1, keys: 0, wheels: 0 } });
    expect(sampleFrom({ front: null }, 9)).toBeUndefined();
  });
});
