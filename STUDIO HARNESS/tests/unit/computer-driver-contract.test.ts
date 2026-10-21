import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { windowsPowerShell } from "../../src/computer/resolve.js";

const run = promisify(execFile);
const fixture = fileURLToPath(new URL("../fixtures/computer-driver-contract.ps1", import.meta.url));
const driver = fileURLToPath(new URL("../../src/computer/driver.ps1", import.meta.url));

describe.skipIf(process.platform !== "win32")("computer driver policies without desktop input", () => {
  let checks: Record<string, unknown>;
  let receipt: Record<string, unknown>;
  let missing: Record<string, unknown>;
  beforeAll(async () => {
    const { stdout } = await run(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-File", fixture, "-Driver", driver], { windowsHide: true, timeout: 30_000 });
    const lines = stdout.trim().split(/\r?\n/);
    const summary: { checks: Record<string, unknown> } = JSON.parse(lines.at(-1) ?? "{}");
    checks = summary.checks;
    const replies: Record<string, unknown>[] = lines.map((line) => JSON.parse(line));
    receipt = replies.find((reply) => reply["id"] === "action") ?? {};
    missing = replies.find((reply) => reply["id"] === "missing") ?? {};
  }, 35_000);

  it("rejects old observations even when their numeric index exists again", () => {
    expect(checks["current"]).toBe("Old");
    expect(checks["newRead"]).toBe("New");
    expect(checks["oldReadRejected"]).toBe(true);
    expect(checks["legacyRejected"]).toBe(true);
  });
  it("rejects changed window identities, expired input references, and prior driver epochs", () => {
    expect(checks["reusedHandleRejected"]).toBe(true);
    expect(checks["keyboardReuseRejected"]).toBe(true);
    expect(checks["afterInputRejected"]).toBe(true);
    expect(checks["restartRejected"]).toBe(true);
  });
  it("converts accessibility centres into the stamped display's coordinates", () => {
    expect(checks["positivePoint"]).toEqual({ display: 1, x: 100, y: 110 });
    expect(checks["negativePoint"]).toEqual({ display: 2, x: 100, y: 110 });
  });
  it("refuses ambiguous window selection instead of picking the first match", () => {
    expect(checks["ambiguousRejected"]).toBe(true);
    expect(checks["unique"]).toBe(20);
    expect(checks["namedLaunch"]).toBe(20);
    expect(checks["waitedWindow"]).toBe(20);
  });
  it("reports a delayed replacement without adopting an unrelated foreground window", () => {
    // Changed on the second sample, then steady for two more: settled at 400 ms.
    expect(checks["samples"]).toBe(4);
    expect(checks["delayed"]).toMatchObject({
      observationId: "22222222-2222-4222-8222-222222222222",
      targetGone: true, target: null, front: { handle: 30 },
      candidates: [{ handle: 20 }], closedWindows: [{ handle: 10 }],
      newWindows: [{ handle: 20 }, { handle: 30 }], refsInvalidated: true,
    });
  });
  it("waits the full time for a screen that keeps changing, and no longer", () => {
    expect(checks["busySamples"]).toBe(8);
    expect(checks["busyWaited"]).toBe(800);
  });
  it("keeps the latest read's references across Studio's own input while the window is the same", () => {
    expect(checks["answerKeeps"]).toBe("Restart");
    expect(checks["refCount"]).toBe(1);
    expect(receipt).toMatchObject({ id: "action", ok: true, result: { said: "Invoked.", observation: { available: true, refsInvalidated: false } } });
  });
  it("preserves the sent action result when post-action observation fails", () => {
    expect(missing).toMatchObject({ id: "missing", ok: true, result: { said: "Input sent.", observation: { available: false, refsInvalidated: true } } });
  });
  it("binds coordinate input to the window at the intended point, not later foreground", () => {
    expect(checks["clicks"]).toBe(1);
    expect(checks["clickedTarget"]).toBe(10);
  });
  it("lets held-input release run as cleanup even when window observation is unavailable", () => {
    expect(checks["releaseNeedsObservation"]).toBe(false);
    expect(checks["pressNeedsObservation"]).toBe(true);
    expect(checks["releasedWithoutObservation"]).toBe(true);
  });
  it("expires refs on physical input and reports the current pointer and windows once", () => {
    expect(checks["userInputExpiresRefs"]).toBe(true);
    expect(checks["userInput"]).toMatchObject({ available: true, moves: 3, stateAvailable: true,
      cursor: { x: 42, y: 18, display: 1 }, target: { handle: 10 }, front: { handle: 30 } });
    expect(checks["inputDrained"]).toBe(true);
    expect(checks["monitorReadyWithoutInput"]).toBe(true);
    expect(checks["monitorFailure"]).toMatchObject({ available: false, moves: 2, stateAvailable: true });
  });
  it("adopts a dialog the target raised, never a same-app or foreign window, and returns to the owner", () => {
    expect(checks["adopted"]).toBe(true);
    expect(checks["adoptedTarget"]).toBe(41);
    expect(checks["dialogTakesKeys"]).toBe(true);
    // A click inside the dialog kept its owner; the dialog closing hands keys back.
    expect(checks["ownerTakesKeys"]).toBe(true);
    expect(checks["returnedTarget"]).toBe(40);
    expect(checks["personalAdopted"]).toBe(false);
    expect(checks["personalTarget"]).toBe(40);
    expect(checks["strangerAdopted"]).toBe(false);
    expect(checks["strangerTarget"]).toBe(40);
    expect(checks["explicitChoiceKept"]).toBe(30);
    // An owner whose handle now belongs to another process is not worked in again.
    expect(checks["replacedOwnerNotResumed"]).toBe(41);
    expect(checks["returnObservation"]).toMatchObject({ targetGone: false, returnedToOwner: true, target: { handle: 40 }, candidates: [] });
  });
  it("keeps a picture within its budget: a PNG too large becomes a JPEG, then a smaller one, and says so", () => {
    // A PNG over the MCP line limit was dropped whole and the model waited out
    // the request deadline (2026-10-21); the picture must arrive instead.
    expect(checks["fallback"]).toMatchObject({ mime: "image/jpeg", underBudget: true });
    expect(String((checks["fallback"] as Record<string, unknown>)["note"])).toMatch(/JPEG/);
    expect(checks["keptPng"]).toMatchObject({ mime: "image/png", width: 400, note: null });
  });
  it("releases only the buttons and keys recorded as Studio-held during cleanup", () => {
    expect(checks["releasedButtons"]).toEqual(["middle/up"]);
    expect(checks["releasedKeys"]).toEqual(["16/False"]);
  });
});
