import { describe, expect, it } from "vitest";

import { conversationActor, DesktopControl, frameUses } from "../../src/computer/control.js";
import { requestBudget, type ComputerSession } from "../../src/computer/session.js";
import { reachOf, toolByName, type ToolAnswer } from "../../src/computer/tools.js";

/*
 * Wave 3 of the computer-use upgrade, at the tool layer: what each new
 * argument sends the driver, what the answer says, and what is refused
 * before anything is sent. The driver's halves are in
 * computer-driver-contract.test.ts; the lease's in computer-lease.test.ts.
 */

const SHOT = {
  display: 0, frameWidth: 100, frameHeight: 100, x: 0, y: 0, width: 100, height: 100,
  imageWidth: 100, imageHeight: 100, mimeType: "image/jpeg", data: "SHOT", pointer: { x: 1, y: 2, display: 0 }, front: null,
};

/** A driver stand-in that records every request and answers from a table. */
class Recorded {
  readonly calls: { op: string; args: Record<string, unknown> }[] = [];
  readonly frames: unknown[] = [];
  constructor(readonly answers: Record<string, unknown> = {}) {}
  get session(): ComputerSession {
    return {
      request: async (op: string, args: Record<string, unknown> = {}) => {
        this.calls.push({ op, args });
        return this.answers[op] ?? (op === "screenshot" ? SHOT : { done: true, said: "Done." });
      },
      rememberFrame: () => undefined,
      offerObservation: () => undefined,
      offerFrame: (frame: unknown) => { this.frames.push(frame); },
    } as unknown as ComputerSession;
  }
  args(op: string): Record<string, unknown> | undefined {
    return this.calls.find((call) => call.op === op)?.args;
  }
}

const tool = (name: string) => {
  const found = toolByName(`studio_computer_${name}`);
  if (found === undefined) throw new Error(`No tool ${name}.`);
  return found;
};

function said(answer: ToolAnswer): string {
  return answer.content.filter((block) => block.type === "text").map((block) => String(block["text"])).join("\n");
}

const context = () => ({ actor: conversationActor("cnv_s"), desktop: new DesktopControl() });

describe("window capture (T2-3)", () => {
  it("is evidence to read, never a frame a point may name", async () => {
    const driver = new Recorded({ screenshot: { ...SHOT, captureMode: "window", printed: true, blank: false } });
    const answer = await tool("screenshot").run(driver.session, { window: 7, capture_mode: "window" });
    expect(driver.args("screenshot")).toMatchObject({ window: 7, mode: "window" });
    expect(said(answer)).toContain("not a frame");
    expect(said(answer)).not.toContain("frameId:");
    expect(driver.frames).toEqual([]);
  });

  it("says so when the window drew nothing it could capture", async () => {
    const driver = new Recorded({ screenshot: { ...SHOT, captureMode: "window", printed: true, blank: true } });
    expect(said(await tool("screenshot").run(driver.session, { window: 7, capture_mode: "window" }))).toContain("came back blank");
  });

  it("needs a window, and leaves an ordinary picture a frame", async () => {
    await expect(tool("screenshot").run(new Recorded().session, { capture_mode: "window" })).rejects.toThrow("give its handle");
    const driver = new Recorded();
    expect(said(await tool("screenshot").run(driver.session, {}))).toContain("frameId:");
    expect(driver.args("screenshot")).toMatchObject({ mode: "display" });
  });
});

describe("act by pattern (T2-2) and scroll by reference (T2-7)", () => {
  it("sends the named action with its arguments, and invoke by default", async () => {
    const driver = new Recorded();
    await tool("act").run(driver.session, { ref: "ui_x_1", action: "set_range", value: 40 });
    expect(driver.args("act")).toMatchObject({ ref: "ui_x_1", action: "set_range", value: 40 });
    const plain = new Recorded();
    await tool("act").run(plain.session, { ref: "ui_x_1" });
    expect(plain.args("act")).toMatchObject({ action: "invoke" });
  });

  it("scrolls a control by reference without a frame, and says how", async () => {
    const driver = new Recorded({ scroll: { done: true, via: "pattern" } });
    const answer = await tool("scroll").run(driver.session, { ref: "ui_x_2", direction: "down" });
    expect(driver.args("scroll")).toEqual({ ref: "ui_x_2", direction: "down", amount: 3 });
    expect(said(answer)).toContain("with the control's own scrolling");
    expect(frameUses("studio_computer_scroll", { ref: "ui_x_2", direction: "down" })).toEqual([]);
  });

  it("still binds a scroll at a point to its frame", async () => {
    expect(frameUses("studio_computer_scroll", { x: 1, y: 1, direction: "down" })).toHaveLength(1);
    await expect(tool("scroll").run(new Recorded().session, { x: 1, y: 1, direction: "down" })).rejects.toThrow("frameId");
  });
});

describe("drag through points (N3-3)", () => {
  it("passes the path and a bounded pause, and counts the points in its receipt", async () => {
    const driver = new Recorded();
    const answer = await tool("drag").run(driver.session, { from: [1, 1], to: [9, 9], path: [[3, 3], [6, 6]], settle_ms: 5_000, frameId: "f" }, context());
    expect(driver.args("drag")).toMatchObject({ from: [1, 1], to: [9, 9], path: [[3, 3], [6, 6]], settle: 2_000 });
    expect(said(answer)).toContain("Dragged through 2 points.");
  });

  it("refuses a malformed path before anything is sent", async () => {
    const driver = new Recorded();
    await expect(tool("drag").run(driver.session, { from: [1, 1], to: [9, 9], path: [[3]], frameId: "f" }, context())).rejects.toThrow("at most 10");
    expect(driver.calls).toEqual([]);
  });

  it("budgets for every point and pause on its way", () => {
    expect(requestBudget("drag", { path: [[1, 1], [2, 2]], settle: 500 })).toBe(13_000);
  });
});

describe("a key held across calls (N3-2)", () => {
  it("presses and lets go through the driver's held-key tracking", async () => {
    const driver = new Recorded({ key_toggle: { done: true, held: 0 } });
    await tool("hold_key").run(driver.session, { keys: "shift", action: "down" });
    expect(driver.args("key_toggle")).toEqual({ keys: "shift", action: "down" });
    expect(said(await tool("hold_key").run(driver.session, { keys: "shift", action: "up" }))).toContain("nothing is held now");
  });

  it("lets go without a look, a frame or the person's approval", () => {
    expect(reachOf("studio_computer_hold_key", { keys: "shift", action: "up" })).toBeUndefined();
    expect(reachOf("studio_computer_hold_key", { keys: "shift", action: "down" })).toEqual({ probe: { kind: "keys" } });
    const desktop = new DesktopControl();
    const actor = conversationActor("cnv_s");
    expect(desktop.wouldRefuse(actor, "studio_computer_hold_key", { keys: "shift", action: "up" }, desktop.ticket(actor))).toBeUndefined();
    expect(desktop.wouldRefuse(actor, "studio_computer_hold_key", { keys: "shift", action: "down" }, desktop.ticket(actor))).toBe("observe_first");
  });
});

describe("windows found again (T2-4, N3-1)", () => {
  it("passes the listed process to focus and arrange", async () => {
    const driver = new Recorded({ focus: { focused: true, handle: 4, title: "Notes" }, arrange: { handle: 4, title: "Notes" } });
    await tool("focus").run(driver.session, { window: 4, pid: 40, processStarted: "9" });
    await tool("arrange").run(driver.session, { window: 4, action: "restore", pid: 40, processStarted: "9" });
    expect(driver.args("focus")).toMatchObject({ window: 4, pid: 40, processStarted: "9" });
    expect(driver.args("arrange")).toMatchObject({ window: 4, pid: 40, processStarted: "9" });
    const bare = new Recorded({ focus: { focused: true } });
    await tool("focus").run(bare.session, { window: 4 });
    expect(bare.args("focus")).toEqual({ window: 4 });
  });

  it("says a reused handle is someone else's and lists the process's windows without choosing", async () => {
    const driver = new Recorded({ get_window: { found: true, same: false, reused: true, windows: [{ handle: 51, title: "Notes", app: "notepad", display: 0, width: 10, height: 10, x: 0, y: 0 }] } });
    const answer = await tool("get_window").run(driver.session, { window: 50, pid: 40, processStarted: "9" });
    expect(said(answer)).toContain("Windows reused the handle. Do not act on it.");
    expect(said(answer)).toContain("window 51");
    expect(answer.structuredContent?.["windows"]).toHaveLength(1);
  });

  it("confirms the same window, and needs something to look by", async () => {
    const driver = new Recorded({ get_window: { found: true, same: true, window: { handle: 50, title: "Notes", app: "notepad", display: 0 } } });
    expect(said(await tool("get_window").run(driver.session, { window: 50, pid: 40 }))).toContain("still the same window");
    await expect(tool("get_window").run(new Recorded().session, {})).rejects.toThrow("Give the handle");
    expect(tool("get_window").effect).toBe("read");
  });

  it("lists each window with the process it belongs to", async () => {
    const driver = new Recorded({ windows: [{ handle: 4, title: "Notes", app: "notepad", pid: 40, processStarted: "9", display: 0, x: 0, y: 0, width: 1, height: 1 }] });
    expect(said(await tool("windows").run(driver.session, {}))).toContain("(notepad, process 40 started 9)");
  });
});

describe("waiting for a window by what identifies it (T2-10)", () => {
  it("passes the match and refuses an unknown one", async () => {
    const driver = new Recorded({ wait_window: { found: false, waited: 1 } });
    await tool("wait_for_window").run(driver.session, { text: "MainWindow", match: "automationid", seconds: 1 });
    expect(driver.args("wait_window")).toMatchObject({ text: "MainWindow", match: "automationid" });
    await expect(tool("wait_for_window").run(driver.session, { text: "x", match: "colour" })).rejects.toThrow("match must be");
  });
});

describe("the clipboard (T2-9, N3-5)", () => {
  it("says what kind of thing a write replaced, never its content", async () => {
    const driver = new Recorded({ clipboard: { written: true, replaced: "text", replacedLength: 12 } });
    const answer = await tool("clipboard").run(driver.session, { action: "write", text: "new" });
    expect(said(answer)).toContain("It replaced 12 characters of text, which are gone.");
  });

  it("pastes text or HTML and says whether the clipboard was put back", async () => {
    const driver = new Recorded({ paste: { pasted: 7, format: "html", restored: false, previous: "image" } });
    const answer = await tool("clipboard").run(driver.session, { action: "paste", text: "<b>x</b>", format: "html" });
    expect(driver.args("paste")).toEqual({ text: "<b>x</b>", format: "html", allowPassword: false });
    expect(said(answer)).toContain("held an image that could not be put back");
    await expect(tool("clipboard").run(driver.session, { action: "paste", text: "x", format: "rtf" })).rejects.toThrow("format must be");
  });

  it("asks before pasting into what Studio asks about, as it does for typing", () => {
    expect(reachOf("studio_computer_clipboard", { action: "paste", text: "x" })).toEqual({ probe: { kind: "keys", text: true } });
    expect(reachOf("studio_computer_clipboard", { action: "write", text: "x" })).toBeUndefined();
  });
});

describe("status and the foreground lock (N3-4)", () => {
  it("says when Windows may refuse to bring a window to the front, and why", async () => {
    const driver = new Recorded({ status: { target: null, foregroundLock: { likely: false, reason: "the person used the computer within the foreground lock time" } } });
    expect(said(await tool("status").run(driver.session, {}))).toContain("Windows may refuse to bring a window to the front: the person used the computer");
    const free = new Recorded({ status: { target: null, foregroundLock: { likely: true, reason: "x" } } });
    expect(said(await tool("status").run(free.session, {}))).toContain("Windows should let Studio bring a window to the front now.");
  });
});

describe("what a batch runs (T2-6)", () => {
  it("runs a held press and a window arrangement, and leaves the clipboard out", async () => {
    const driver = new Recorded({ arrange: { handle: 4, title: "Notes" } });
    const ran = await tool("batch").run(driver.session, { steps: [{ tool: "arrange", window: 4, action: "maximize" }, { tool: "mouse_button", action: "up" }] }, context());
    expect(ran.isError).toBeUndefined();
    expect(driver.calls.map((call) => call.op)).toEqual(["arrange", "button", "screenshot"]);
    await expect(tool("batch").run(new Recorded().session, { steps: [{ tool: "clipboard", action: "read" }] }, context())).rejects.toThrow("names no tool a batch runs");
  });

  it("refuses steps that could outlast the call, before any is sent", async () => {
    const driver = new Recorded();
    const steps = [{ tool: "wait", seconds: 30 }, { tool: "wait", seconds: 30 }, { tool: "wait", seconds: 30 }, { tool: "wait_for_window", text: "x", seconds: 20 }];
    await expect(tool("batch").run(driver.session, { steps }, context())).rejects.toThrow("Nothing was sent");
    expect(driver.calls).toEqual([]);
  });
});
