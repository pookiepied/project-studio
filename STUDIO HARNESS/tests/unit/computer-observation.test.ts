import { describe, expect, it } from "vitest";
import { isStudioUuid } from "../../src/contracts/uuid.js";
import { conversationActor, DesktopControl } from "../../src/computer/control.js";
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
  readonly args: Record<string, unknown>[] = [];
  constructor(readonly sent: unknown, readonly screenshotFails = false) { super("isolated-observation-test"); }
  override async request(op: string, args: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push(op);
    this.args.push(args);
    if (op === "screenshot") {
      if (this.screenshotFails) throw new Error("screenshot unavailable");
      return { ...picture, pointer: { x: 10, y: 20, display: 0 } };
    }
    return this.sent;
  }
}

function tool(name: string) {
  const found = toolByName(`studio_computer_${name}`);
  if (found === undefined) throw new Error(`Missing tool ${name}`);
  return found;
}

const FRAME = "33333333-3333-4333-8333-333333333333";

describe("computer action observations", () => {
  it("returns replacement identity and candidates without implicitly focusing or replaying input", async () => {
    const session = new ObservedSession({ said: "Invoked.", observation });
    const result = await tool("act").run(session, { ref: "ui_11111111-1111-4111-8111-111111111111_1" });
    expect(result.structuredContent?.["observation"]).toEqual(observation);
    expect(result.content[0]?.["text"]).toContain("previous target has closed");
    expect(result.content[0]?.["text"]).toContain('In front: "Browser" (window 20)');
    expect(result.content[0]?.["text"]).toContain('Closed: "Profile picker" (window 10)');
    expect(result.content[0]?.["text"]).toContain("not verified");
    // The pointer arrives with the pixels: one request after the action, not two.
    expect(session.calls).toEqual(["act", "screenshot"]);
    expect(result.content[1]?.["text"]).toContain("Pointer at (10,20) on display 0.");
  });
  it.each(["click", "drag", "type", "key", "hold_key", "move", "scroll", "mouse_button", "set_value", "select_text", "focus", "open", "arrange"])("propagates the observation from %s", async (name) => {
    const session = new ObservedSession({ said: "Sent.", focused: true, started: false, title: "Browser", handle: 20, observation });
    const result = await tool(name).run(session, { x: 1, y: 2, from: [1, 2], to: [3, 4], frameId: FRAME, text: "hello", keys: "shift", seconds: 0, direction: "down", action: name === "arrange" ? "maximize" : "up", ref: "ui_ref", value: "value", start: 0, end: 1, window: 20, app: "Chrome" });
    expect(result.structuredContent?.["observation"]).toEqual(observation);
  });
  it("preserves dispatched input when the post-action picture fails", async () => {
    const session = new ObservedSession({ said: "Invoked.", observation }, true);
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

describe("frames: every picture has an id, every point names one", () => {
  it("answers a screenshot with a frameId, in words and as structure, and offers it as a frame only inside an admitted call", async () => {
    const session = new ObservedSession({});
    const result = await tool("screenshot").run(session, {});
    const frame = result.structuredContent?.["frame"] as Record<string, unknown>;
    expect(isStudioUuid(frame["id"])).toBe(true);
    expect(result.content[0]?.["text"]).toContain(`frameId: ${String(frame["id"])}`);
    expect(frame).toMatchObject({ display: 0, width: 1920, height: 1080 });
    // The latest observation and the frame are one id, not two.
    expect(session.takeOffered()?.id).toBe(frame["id"]);
    expect(session.takeOfferedFrames()).toEqual([]);
    const control = new DesktopControl();
    await control.run(session, "studio_computer_screenshot", () => tool("screenshot").run(session, {}));
    expect(session.takeOfferedFrames()).toEqual([{ id: expect.any(String), displays: [0], changes: control.changes }]);
  });

  it.each([
    ["click", { x: 1, y: 2 }],
    ["move", { x: 1, y: 2 }],
    ["drag", { from: [1, 2], to: [3, 4] }],
    ["scroll", { x: 1, y: 2, direction: "down" }],
    ["mouse_button", { action: "down" }],
  ])("refuses %s without a frameId before anything reaches the driver", async (name, args) => {
    const session = new ObservedSession({ said: "Sent." });
    await expect(tool(name).run(session, args)).rejects.toThrow(/frameId.*No input was sent/);
    expect(session.calls).toEqual([]);
  });

  it("releases a held button without a frame, because release is cleanup", async () => {
    const session = new ObservedSession({ done: true, observation: { available: false, refsInvalidated: true } });
    await tool("mouse_button").run(session, { action: "up" });
    expect(session.calls[0]).toBe("button");
  });

  it("sends a point that names no display to the display of its frame, not the driver's default", async () => {
    const session = new ObservedSession({ said: "Sent.", observation });
    const actor = { conversation: "c", id: "c", role: "conversation" as const };
    const desktop = { frameDisplays: () => [2] } as unknown as DesktopControl;
    await tool("click").run(session, { x: 5, y: 6, frameId: FRAME }, { actor, desktop });
    expect(session.args[0]).toMatchObject({ display: 2, x: 5, y: 6 });
    // The picture after the click is of the same display.
    expect(session.args[1]).toMatchObject({ display: 2 });
    await tool("click").run(session, { x: 5, y: 6, frameId: FRAME, display: 1 }, { actor, desktop });
    expect(session.args[2]).toMatchObject({ display: 1 });
  });

  it.each([
    ["mouse_button", { action: "down", frameId: FRAME }],
    ["mouse_button", { action: "up" }],
    ["hold_key", { keys: "shift", seconds: 0 }],
    ["select_text", { ref: "ui_ref", start: 0, end: 3 }],
  ])("answers %s with a picture and a new frame, so held or selected state is never blind", async (name, args) => {
    const session = new ObservedSession({ said: "Selected 3 characters.", done: true, observation });
    const result = await tool(name).run(session, args);
    expect(result.content.some((block) => block.type === "image")).toBe(true);
    expect(isStudioUuid((result.structuredContent?.["frame"] as Record<string, unknown> | undefined)?.["id"])).toBe(true);
  });
});

describe("a structured read", () => {
  const read = {
    window: "Sign in", handle: 7, observationId: FRAME, minimized: false, truncated: true, depthLimited: false,
    outline: `edit "Password" value="[password]" display 1 @(10,20) [ui_${FRAME}_1]\n... the read stopped at 2 controls`,
    elements: [
      { ref: `ui_${FRAME}_1`, role: "edit", name: "Password", password: true, value: "hunter2", patterns: ["Value"], display: 1, center: { x: 10, y: 20 }, automationId: "pw", className: "Edit", runtimeId: "42.7", enabled: true, focused: false },
      { ref: `ui_${FRAME}_2`, role: "check box", name: "Remember", password: false, patterns: ["Toggle"], display: 1, center: { x: 30, y: 40 }, automationId: "remember", className: "Button", runtimeId: "42.8", enabled: true, focused: true, checked: true, extra: "dropped" },
    ],
  };

  it("answers one record per control, with identity, patterns and the read's frameId, and never a password's value", async () => {
    const session = new ObservedSession(read);
    const result = await tool("read_ui").run(session, { query: "pass" });
    expect(session.args[0]).toMatchObject({ query: "pass" });
    const ui = result.structuredContent?.["ui"] as Record<string, unknown>;
    expect(ui).toMatchObject({ window: "Sign in", handle: 7, frameId: FRAME, truncated: true, depthLimited: false });
    expect(ui["elements"]).toEqual([
      { ref: `ui_${FRAME}_1`, role: "edit", name: "Password", value: "[password]", password: true, patterns: ["Value"], display: 1, center: { x: 10, y: 20 }, automationId: "pw", className: "Edit", runtimeId: "42.7", enabled: true, focused: false },
      { ref: `ui_${FRAME}_2`, role: "check box", name: "Remember", password: false, patterns: ["Toggle"], display: 1, center: { x: 30, y: 40 }, automationId: "remember", className: "Button", runtimeId: "42.8", enabled: true, focused: true, checked: true },
    ]);
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(result.content[0]?.["text"]).toContain(`frameId: ${FRAME}`);
    expect(result.content[0]?.["text"]).toContain("the read stopped");
  });

  it("offers the read as a frame of the displays its controls are on", async () => {
    const session = new ObservedSession(read);
    const control = new DesktopControl();
    await control.run(session, "studio_computer_read_ui", () => tool("read_ui").run(session, {}));
    expect(session.takeOfferedFrames()).toEqual([{ id: FRAME, displays: [1], changes: control.changes }]);
  });

  it("reads and pictures the window in one request, under one frameId", async () => {
    const session = new ObservedSession({ observationId: FRAME, ui: read, picture: { ...picture, display: 0 } });
    const control = new DesktopControl();
    const result = await control.run(session, "studio_computer_read_ui", () => tool("read_ui").run(session, { screenshot: true }));
    expect(session.calls).toEqual(["observe"]);
    expect(session.args[0]).toMatchObject({ ui: { all: false }, picture: { format: "jpeg" } });
    expect(result.content.some((block) => block.type === "image")).toBe(true);
    expect((result.structuredContent?.["frame"] as Record<string, unknown>)["id"]).toBe(FRAME);
    expect(session.takeOfferedFrames()).toEqual([{ id: FRAME, displays: [0, 1], changes: control.changes }]);
    expect(session.takeOffered()?.id).toBe(FRAME);
  });

  it("keeps the read when the window cannot be pictured, and says so", async () => {
    const session = new ObservedSession({ observationId: FRAME, ui: read, pictureError: "Window 7 is minimized" });
    const result = await tool("read_ui").run(session, { screenshot: true });
    expect(result.content.some((block) => block.type === "image")).toBe(false);
    expect(result.content[0]?.["text"]).toContain("could not be pictured");
    expect((result.structuredContent?.["ui"] as Record<string, unknown>)["frameId"]).toBe(FRAME);
  });

  it("gives status and a picture in one request", async () => {
    const session = new ObservedSession({ observationId: FRAME, status: { target: null, cursor: { x: 1, y: 2, display: 0 } }, picture });
    const result = await tool("status").run(session, { screenshot: true });
    expect(session.calls).toEqual(["observe"]);
    expect(result.content[0]?.["text"]).toContain("No window has been chosen");
    expect(result.content[0]?.["text"]).toContain(`frameId: ${FRAME}`);
  });

  // P1-4 replaced Wave 1's model-settable flag: only the server, once the
  // person approved, lets text into a password field.
  it("lets text into a password field only on the server's approval, never on a model's argument", async () => {
    const session = new ObservedSession({ said: "Set.", observation });
    const approved = { actor: conversationActor("cnv_pw"), desktop: new DesktopControl(), allowPassword: true };
    await tool("set_value").run(session, { ref: "ui_ref", value: "x", password: true });
    await tool("set_value").run(session, { ref: "ui_ref", value: "x" }, approved);
    await tool("type").run(session, { text: "x", password: true });
    await tool("type").run(session, { text: "x" }, approved);
    const sent = (op: string) => session.args.filter((_, index) => session.calls[index] === op).map((args) => args["allowPassword"]);
    expect(sent("set_value")).toEqual([false, true]);
    expect(sent("type")).toEqual([false, true]);
    expect(JSON.stringify(toolByName("studio_computer_set_value")?.inputSchema)).not.toContain("password");
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
