import { describe, expect, it } from "vitest";

import { DesktopControl, frameUses, withBatchFrame } from "../../src/computer/control.js";
import { ComputerSession } from "../../src/computer/session.js";
import { toolByName } from "../../src/computer/tools.js";

const picture = { display: 0, frameWidth: 1920, frameHeight: 1080, x: 0, y: 0, width: 1920, height: 1080, imageWidth: 1280, imageHeight: 720, mimeType: "image/jpeg", data: "AAAA" };
const observation = { observationId: "11111111-1111-4111-8111-111111111111", available: true, target: null, front: null, refsInvalidated: false };

/** A driver stand-in: records each operation, fails the ones named. */
class ScriptedSession extends ComputerSession {
  readonly calls: string[] = [];
  constructor(readonly failing: ReadonlySet<string> = new Set(), key = "isolated-batch-test") { super(key); }
  override async request(op: string): Promise<unknown> {
    this.calls.push(op);
    if (this.failing.has(op)) throw new Error(`The driver refused ${op}.`);
    if (op === "screenshot") return picture;
    if (op === "cursor") return { x: 10, y: 20, display: 0 };
    return { said: "Invoked.", typed: 5, done: true, observation };
  }
}

const FRAME = "33333333-3333-4333-8333-333333333333";
const batch = toolByName("studio_computer_batch");
if (batch === undefined) throw new Error("batch is missing");

function textOf(result: { content: readonly { readonly type: string; readonly [key: string]: unknown }[] }): string {
  return result.content.filter((block) => block.type === "text").map((block) => String(block["text"])).join("\n");
}

describe("a batch of computer steps", () => {
  it("runs the steps in order with one picture at the end, not one per step", async () => {
    const session = new ScriptedSession();
    const result = await batch.run(session, { frameId: FRAME, steps: [
      { tool: "click", x: 5, y: 6 },
      { tool: "type", text: "hello" },
      { tool: "key", keys: "return" },
    ] });
    expect(session.calls).toEqual(["click", "type", "key", "screenshot"]);
    expect(result.content.filter((block) => block.type === "image")).toHaveLength(1);
    expect(result.isError).toBeUndefined();
    const said = textOf(result);
    expect(said).toContain("1. click: Clicked.");
    expect(said).toContain("2. type: Typed 5 characters.");
    expect(said).toContain("3. key: Pressed return.");
    // The receipt's boilerplate is said once, not once per step.
    expect(said.match(/Input was dispatched/g)).toHaveLength(1);
  });

  it("stops at the first failure, names what did not run, and still shows the screen", async () => {
    const session = new ScriptedSession(new Set(["type"]));
    const result = await batch.run(session, { frameId: FRAME, steps: [
      { tool: "click", x: 5, y: 6 },
      { tool: "type", text: "hello" },
      { tool: "key", keys: "return" },
      { tool: "act", ref: "ui_x_1" },
    ] });
    expect(session.calls).toEqual(["click", "type", "screenshot"]);
    expect(result.isError).toBe(true);
    const said = textOf(result);
    expect(said).toContain("2. type failed: The driver refused type.");
    expect(said).toContain("Not run: 3. key, 4. act");
    expect(said).toContain("do not replay them automatically");
  });

  it("checks every step before any input goes out", async () => {
    const session = new ScriptedSession();
    await expect(batch.run(session, { frameId: FRAME, steps: [{ tool: "click", x: 1, y: 1 }, { tool: "stop" }] })).rejects.toThrow(/Step 2 names no tool/);
    await expect(batch.run(session, { steps: [{ tool: "batch", steps: [] }] })).rejects.toThrow(/Step 1/);
    await expect(batch.run(session, { steps: [] })).rejects.toThrow(/list/);
    await expect(batch.run(session, { steps: Array.from({ length: 21 }, () => ({ tool: "wait", seconds: 0 })) })).rejects.toThrow(/at most 20/);
    expect(session.calls).toEqual([]);
  });

  it("is desktop input, so another conversation's live ownership refuses it", async () => {
    const control = new DesktopControl();
    const owner = new ScriptedSession();
    Object.defineProperty(owner, "running", { get: () => true });
    await control.run(owner, "studio_computer_screenshot", async () => undefined);
    await control.run(owner, "studio_computer_key", async () => undefined);
    const other = new ScriptedSession(new Set(), "isolated-batch-other");
    await expect(control.run(other, "studio_computer_batch", async () => undefined)).rejects.toThrow(/Another conversation/);
  });

  it("gives coordinate steps the batch's frame unless they name their own, and leaves other steps alone", () => {
    expect(withBatchFrame("click", { x: 1, y: 1 }, FRAME)).toEqual({ x: 1, y: 1, frameId: FRAME });
    expect(withBatchFrame("scroll", { x: 1, y: 1, frameId: "own" }, FRAME)).toEqual({ x: 1, y: 1, frameId: "own" });
    expect(withBatchFrame("type", { text: "a" }, FRAME)).toEqual({ text: "a" });
    expect(withBatchFrame("mouse_button", { action: "up" }, FRAME)).toEqual({ action: "up" });
    expect(frameUses("studio_computer_batch", { frameId: FRAME, steps: [{ tool: "click", x: 1, y: 1, display: 1 }, { tool: "type", text: "a" }, { tool: "drag" }] }))
      .toEqual([{ frameId: FRAME, display: 1 }, { frameId: FRAME, display: undefined }]);
  });

  it("refuses a batch whose coordinate step has no frame before any step runs", async () => {
    const control = new DesktopControl();
    const owner = new ScriptedSession();
    Object.defineProperty(owner, "running", { get: () => true });
    await control.run(owner, "studio_computer_screenshot", async () => undefined);
    let ran = false;
    await expect(control.run(owner, "studio_computer_batch", async () => { ran = true; }, undefined, { steps: [{ tool: "type", text: "a" }, { tool: "click", x: 1, y: 1 }] }))
      .rejects.toThrow(/No input was sent: a point must name the frameId/);
    expect(ran).toBe(false);
  });

  it("gives each step's own tool its arguments, without the step's name", async () => {
    const session = new ScriptedSession();
    const result = await batch.run(session, { steps: [{ tool: "wait", seconds: 0 }, { tool: "act", ref: "ui_x_1", action: "toggle" }] });
    expect(textOf(result)).toContain("1. wait: Waited 0 seconds.");
    expect(textOf(result)).toContain("2. act: Invoked.");
  });

  it("keeps a read_ui outline on its own lines inside a batch", async () => {
    const session = new ScriptedSession();
    const outline = ['button "Save" [ui_a_1]', 'edit "Body" [ui_a_2]'].join("\n");
    session.request = async (op: string) => {
      session.calls.push(op);
      if (op === "read_ui") return { window: "Notepad", handle: 1, outline };
      return op === "screenshot" ? picture : { x: 0, y: 0, display: 0 };
    };
    const result = await batch.run(session, { steps: [{ tool: "read_ui" }] });
    expect(textOf(result)).toContain(outline);
  });
});
