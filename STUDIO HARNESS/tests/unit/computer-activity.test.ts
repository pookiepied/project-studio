import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { windowsPowerShell } from "../../src/computer/resolve.js";
import { InputUpdates } from "../../src/computer/input.js";
import { DesktopControl } from "../../src/computer/control.js";
import { ComputerSession } from "../../src/computer/session.js";

describe.skipIf(process.platform !== "win32")("native physical input policy without hooks", () => {
  let checks: Record<string, unknown>;
  beforeAll(async () => {
    const fixture = fileURLToPath(new URL("../fixtures/computer-activity-contract.ps1", import.meta.url));
    const source = fileURLToPath(new URL("../../src/computer/activity.cs", import.meta.url));
    const { stdout } = await promisify(execFile)(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-File", fixture, "-Source", source], { windowsHide: true, timeout: 30_000 });
    checks = JSON.parse(stdout.trim());
  }, 35_000);
  it("excludes injected and lower-integrity input without reading key contents", () => {
    expect(checks).toMatchObject({ key: "keyboard", keyUp: "keyboard", move: "mouse_move", button: "mouse_button", buttonUp: "mouse_button", wheel: "mouse_wheel", injectedKey: "", injectedMouse: "", lowerKey: "", lowerMouse: "" });
    expect(checks["fields"]).toEqual(["Available", "Moves", "Buttons", "Wheels", "Keys", "AgeMs", "Truncated", "Stop"]);
  });
  // P1-6: a held, physical Escape while Studio acts is a stop; a tap, Studio's
  // own injected hold, or Escape long after Studio acted is not. The policy
  // reads a timestamp of the last physical key, never which key it was.
  it("treats only a held physical Escape during Studio's input as a deliberate stop", () => {
    expect(checks["stop"]).toEqual({ heldWhileActing: true, tapped: false, injectedHold: false, oldKeyOnly: false, notActing: false, notHeld: false });
    expect(checks["stopIdle"]).toBe(false);
  });
  it("coalesces and drains counts without starting desktop hooks or an overlay", () => {
    expect(checks["summary"]).toMatchObject({ Available: false, Moves: 1, Buttons: 1, Wheels: 1, Keys: 1 });
    expect(checks["drained"]).toMatchObject({ Moves: 0, Buttons: 0, Wheels: 0, Keys: 0 });
    expect(checks["overlayAbsent"]).toBe(true);
  });
  it("draws the browser-style arrow and custom rounded badge, including at screen edges", () => {
    expect(checks).toMatchObject({ arrowPainted: true, badgePainted: true, badgeRounded: true, edgeBadgeVisible: true });
  });
  it("renders the white pointer and charcoal edge without coloured transparency fringes", () => {
    expect(checks).toMatchObject({ arrowPainted: true, transparentBackground: true, neutralEdges: true });
  });
  it("draws a press ring and an expanding release pulse that fades away", () => {
    expect(checks).toMatchObject({ pressRing: true, releaseRing: true, releaseFades: true });
  });
});

describe.skipIf(process.platform !== "win32")("desktop marker visibility after dispatch", () => {
  let checks: Record<string, unknown>;
  beforeAll(async () => {
    const fixture = fileURLToPath(new URL("../fixtures/computer-marker-policy.ps1", import.meta.url));
    const source = fileURLToPath(new URL("../../src/computer/activity.cs", import.meta.url));
    const driver = fileURLToPath(new URL("../../src/computer/driver.ps1", import.meta.url));
    const { stdout } = await promisify(execFile)(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-File", fixture, "-Source", source, "-Driver", driver], { windowsHide: true, timeout: 30_000 });
    checks = JSON.parse(stdout.trim());
  }, 35_000);
  it("restores the marker after pointer correction and renews it after successful input", () => {
    expect(checks).toMatchObject({ moveVisible: true, inputVisible: true, visibleForFiveSeconds: true });
  });
  it("keeps manual takeover, cleanup and refused input distinct from active input", () => {
    expect(checks).toMatchObject({ manualMoveHides: true, manualButtonClearsPress: true, releaseHides: true, refused: true, refusedInputHidden: true, refusedInputNotPressed: true, monitorNotStarted: true });
  });
  it("tracks overlapping button presses until the last release and does not animate wheel input as a click", () => {
    expect(checks).toMatchObject({ pressSurvivesMove: true, multiButtonPress: true, partialReleaseStaysPressed: true, finalReleaseAnimates: true, wheelNotClick: true });
  });
});

describe("physical input product updates", () => {
  it("projects the lease owner, retains stopping until exit, and clears on settlement or crash", async () => {
    const control = new DesktopControl();
    const session = new RunningSession("chat");
    expect(control.activity()).toEqual({ conversationId: null, mode: "active" });
    await control.run(session, "studio_computer_screenshot", async () => undefined);
    expect(control.activity().conversationId).toBeNull();
    await control.run(session, "studio_computer_key", async () => undefined);
    expect(control.activity()).toEqual({ conversationId: "chat", mode: "active" });
    control.pause("chat");
    expect(control.activity().mode).toBe("paused");
    session.active = false; session.cleaning = true;
    expect(control.activity()).toEqual({ conversationId: "chat", mode: "stopping" });
    session.cleaning = false;
    expect(control.activity().conversationId).toBeNull();
    control.resume("chat"); session.active = true;
    await control.run(session, "studio_computer_screenshot", async () => undefined);
    await control.run(session, "studio_computer_key", async () => undefined);
    control.release({ conversation: "chat", id: "chat" });
    expect(control.activity().conversationId).toBeNull();
  });
  it("preserves the tool result and observation, bounds counts, and projects no key or text values", () => {
    const updates = new InputUpdates();
    updates.add({ available: true, keys: 2, moves: 1, text: "private", key: "private", stateAvailable: true, front: { handle: 20, title: "Current", secret: "private" }, cursor: { x: 10, y: 20, display: 1 } });
    expect(JSON.stringify(updates.decorate({ content: [] }))).not.toContain("private");
    updates.add({ available: true, moves: 2_000_000, keys: 1, stateAvailable: true, cursor: { x: 30, y: 40, display: 0 } });
    const result = updates.decorate({ content: [{ type: "text", text: "Input sent." }], structuredContent: { observation: { available: true } } });
    expect(result.content[0]).toEqual({ type: "text", text: "Input sent." });
    expect(result.structuredContent).toMatchObject({ observation: { available: true }, userInput: { moves: 1_000_000, keys: 3, truncated: true, cursor: { x: 30, y: 40, display: 0 } } });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.content.at(-1)?.["text"]).toContain("counts were truncated");
    expect(JSON.stringify(result)).toContain("not been stopped automatically");
  });
  it("keeps unsupported monitoring explicit and does not invent an interaction", () => {
    const updates = new InputUpdates();
    const result = { content: [{ type: "text", text: "Original" }] };
    expect(updates.decorate(result)).toBe(result);
    updates.add({ available: false });
    expect(JSON.stringify(updates.decorate(result))).toContain("monitoring is unavailable");
  });
  it("retains known interaction counts if a later monitoring read is unavailable", () => {
    const updates = new InputUpdates();
    updates.add({ available: true, moves: 3 }); updates.add({ available: false });
    const result = JSON.stringify(updates.decorate({ content: [] }));
    expect(result).toContain("3 mouse moves");
    expect(result).toContain("monitoring is now unavailable");
  });
});

class RunningSession extends ComputerSession {
  active = true;
  cleaning = false;
  override get running() { return this.active; }
  override get releasing() { return this.cleaning; }
}
describe("shared desktop ownership", () => {
  it("refuses another conversation's input until the owner's driver ends", async () => {
    const control = new DesktopControl();
    const first = new RunningSession("first"); const second = new RunningSession("second");
    await control.run(first, "studio_computer_screenshot", async () => "looked");
    await control.run(first, "studio_computer_key", async () => "first");
    let sent = false;
    await expect(control.run(second, "studio_computer_type", async () => { sent = true; })).rejects.toThrow("Another conversation");
    expect(sent).toBe(false);
    expect(await control.run(second, "studio_computer_status", async () => "observed")).toBe("observed");
    first.active = false;
    // The first conversation's click came after that status, so the second
    // must look again before typing into whatever is there now.
    await expect(control.run(second, "studio_computer_type", async () => "second")).rejects.toThrow("Take a screenshot");
    await control.run(second, "studio_computer_screenshot", async () => "looked");
    expect(await control.run(second, "studio_computer_type", async () => "second")).toBe("second");
  });
  // Until ADR 0059 every desktop tool of every conversation shared one queue,
  // so a picture in one chat waited out another chat's whole batch. Separate
  // conversations have separate drivers, and input is refused to all but the
  // owner anyway; an observation has nothing to wait for.
  it("does not hold another conversation's observation behind the owner's input", async () => {
    const control = new DesktopControl(); const current = new RunningSession("first");
    await control.run(current, "studio_computer_screenshot", async () => undefined);
    let release = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const first = control.run(current, "studio_computer_key", async () => { order.push("input"); await barrier; order.push("observed"); });
    const second = control.run(new RunningSession("second"), "studio_computer_screenshot", async () => { order.push("picture"); });
    await second; expect(order).toEqual(["input", "picture"]);
    release(); await first; expect(order).toEqual(["input", "picture", "observed"]);
  });
  it("retains ownership until release finishes and invalidates queued input when stopped", async () => {
    const control = new DesktopControl(); const owner = new RunningSession("owner");
    const other = new RunningSession("other");
    await control.run(owner, "studio_computer_screenshot", async () => undefined);
    await control.run(owner, "studio_computer_key", async () => {});
    owner.active = false; owner.cleaning = true;
    await expect(control.run(other, "studio_computer_key", async () => {})).rejects.toThrow("Another conversation");
    owner.cleaning = false;
    // Its driver ended, so it lost the desktop and looks again like anyone.
    await control.run(owner, "studio_computer_screenshot", async () => undefined);
    let release = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const first = owner.runTool(() => control.run(owner, "studio_computer_key", async () => { await barrier; return { content: [] }; }));
    let sent = false;
    const queued = owner.runTool(() => control.run(owner, "studio_computer_key", async () => { sent = true; return { content: [] }; }));
    const refused = expect(queued).rejects.toThrow("queued");
    await Promise.resolve(); await Promise.resolve();
    await owner.close(); release(); await first; await refused;
    expect(sent).toBe(false);
  });
});
