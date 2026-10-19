import { describe, expect, it } from "vitest";
import { ComputerSession } from "../../src/computer/session.js";
import { toolByName } from "../../src/computer/tools.js";

const picture = { display: 0, frameWidth: 1920, frameHeight: 1080, x: 0, y: 0, width: 1920, height: 1080, imageWidth: 1280, imageHeight: 720, mimeType: "image/jpeg", data: "AAAA" };
const observation = {
  observationId: "11111111-1111-4111-8111-111111111111", available: true,
  target: null, front: { handle: 20, title: "Browser", app: "chrome", display: 0 }, targetGone: true,
  newWindows: [{ handle: 20, title: "Browser", app: "chrome", display: 0 }],
  closedWindows: [{ handle: 10, title: "Profile picker", app: "chrome", display: 0 }],
  candidates: [{ handle: 20, title: "Browser", app: "chrome", display: 0 }], refsInvalidated: true,
};

class ObservedSession extends ComputerSession {
  readonly calls: string[] = [];
  constructor(readonly sent: unknown, readonly screenshotFails = false, readonly cursorFails = false) { super("isolated-observation-test"); }
  override async request(op: string): Promise<unknown> {
    this.calls.push(op);
    if (op === "screenshot") {
      if (this.screenshotFails) throw new Error("screenshot unavailable");
      return picture;
    }
    if (op === "cursor") {
      if (this.cursorFails) throw new Error("cursor unavailable");
      return { x: 10, y: 20, display: 0 };
    }
    return this.sent;
  }
}

function tool(name: string) {
  const found = toolByName(`studio_computer_${name}`);
  if (found === undefined) throw new Error(`Missing tool ${name}`);
  return found;
}

describe("computer action observations", () => {
  it("returns replacement identity and candidates without implicitly focusing or replaying input", async () => {
    const session = new ObservedSession({ said: "Invoked.", observation });
    const result = await tool("act").run(session, { ref: "ui_11111111-1111-4111-8111-111111111111_1" });
    expect(result.structuredContent).toEqual({ observation });
    expect(result.content[0]?.["text"]).toContain("previous target has closed");
    expect(result.content[0]?.["text"]).toContain('In front: "Browser" (window 20)');
    expect(result.content[0]?.["text"]).toContain('Closed: "Profile picker" (window 10)');
    expect(result.content[0]?.["text"]).toContain("not verified");
    expect(session.calls).toEqual(["act", "cursor", "screenshot"]);
  });
  it.each(["click", "drag", "type", "key", "hold_key", "move", "scroll", "mouse_button", "set_value", "select_text", "focus", "open", "arrange"])("propagates the observation from %s", async (name) => {
    const session = new ObservedSession({ said: "Sent.", focused: true, started: false, title: "Browser", handle: 20, observation });
    const result = await tool(name).run(session, { x: 1, y: 2, from: [1, 2], to: [3, 4], text: "hello", keys: "shift", seconds: 0, direction: "down", action: name === "arrange" ? "maximize" : "up", ref: "ui_ref", value: "value", start: 0, end: 1, window: 20, app: "Chrome" });
    expect(result.structuredContent).toEqual({ observation });
  });
  it.each([[true, false], [false, true]])("preserves dispatched input when screenshot or cursor delivery fails (%s, %s)", async (screenshotFails, cursorFails) => {
    const session = new ObservedSession({ said: "Invoked.", observation }, screenshotFails, cursorFails);
    const result = await tool("act").run(session, { ref: "ui_ref" });
    expect(result.structuredContent).toEqual({ observation });
    expect(result.content[0]?.["text"]).toContain("Invoked.");
    expect(result.content.at(-1)?.["text"]).toContain("do not automatically repeat");
    expect(session.calls.filter((name) => name === "act")).toHaveLength(1);
  });
  it("reports unavailable window evidence without claiming verification", async () => {
    const session = new ObservedSession({ said: "Invoked.", observation: { available: false, observationId: observation.observationId } });
    const result = await tool("act").run(session, { ref: "ui_ref" });
    expect(result.content[0]?.["text"]).toContain("Post-action observation is unavailable");
    expect(result.content[0]?.["text"]).toContain("Do not replay");
  });
});

describe("keeping computer actions and observations in order", () => {
  it("cancels dependent queued work after failure while allowing a new explicit call", async () => {
    const session = new ComputerSession("isolated-failure");
    const failed = session.run(async () => { throw new Error("outcome unknown"); });
    let sent = false;
    const queued = session.run(async () => { sent = true; });
    await expect(failed).rejects.toThrow("outcome unknown");
    await expect(queued).rejects.toThrow("queued");
    expect(sent).toBe(false);
    await expect(session.run(async () => "new observation")).resolves.toBe("new observation");
  });
  it("finishes the previous observation before another tool can act", async () => {
    const session = new ComputerSession("isolated-queue");
    const order: string[] = [];
    let release = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const first = session.run(async () => { order.push("act"); await barrier; order.push("observe"); });
    const second = session.run(async () => { order.push("next"); });
    await Promise.resolve();
    expect(order).toEqual(["act"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["act", "observe", "next"]);
  });
  it("cancels queued input and clears old frame metadata when stopped", async () => {
    const session = new ComputerSession("isolated-stop");
    let release = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const first = session.run(async () => { await barrier; });
    let sent = false;
    const queued = session.run(async () => { sent = true; });
    const rejected = expect(queued).rejects.toThrow("queued");
    session.rememberFrame({ display: 2, width: 100, height: 100 });
    await Promise.resolve();
    await session.close();
    release();
    await first;
    await rejected;
    expect(sent).toBe(false);
    expect(session.lastFrame).toBeUndefined();
  });
  it("does not start a new driver from an interrupted tool's continuation", async () => {
    const session = new ComputerSession("isolated-continuation");
    let release = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const first = session.run(async () => { await barrier; return session.request("cursor"); });
    const rejected = expect(first).rejects.toThrow("stopped or replaced");
    await Promise.resolve();
    await session.close();
    release();
    await rejected;
    expect(session.running).toBe(false);
  });
});
