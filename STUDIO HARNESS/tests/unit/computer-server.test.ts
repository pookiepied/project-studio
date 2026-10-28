import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { computerReport } from "../../src/computer/resolve.js";
import { unsupportedMessage, type ComputerSession } from "../../src/computer/session.js";
import { definitions, TOOLS, toolByName } from "../../src/computer/tools.js";

/**
 * The computer-use capability, tested at the seams that can break silently.
 *
 * **The surface**: twenty-eight tools, folded the way ADR 0013 folds, each
 * one described because the schema is the manual.
 *
 * **The wire**, driven as a real process over real stdio, because what the
 * harness talks to is `dist/computer.mjs` and not these modules.
 *
 * **The promise that nothing starts until something asks** (ADR 0049 §4,
 * inherited): connecting, discovering and listing must leave no PowerShell
 * behind. A driver started during `tools/list` would cost every conversation
 * a process for a capability most never use.
 *
 * What is deliberately NOT here: any call that moves the pointer or presses
 * a key. Those are proved by hand on a machine the person has handed over
 * (the plan, §3 step 6), never by a test that acts on whoever is at the
 * keyboard when the suite runs.
 */

const BUNDLE = fileURLToPath(new URL("../../dist/computer.mjs", import.meta.url));

describe("the tool surface", () => {
  it("is the set that was designed, named as Studio's own", () => {
    for (const tool of TOOLS) expect(tool.name.startsWith("studio_computer_")).toBe(true);
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
    // 27 until desktop control (ADR 0059) added `control`: the lease is a
    // capability a model must be able to read and hand back.
    expect(TOOLS).toHaveLength(28);
  });

  it("covers the jobs the capability exists for", () => {
    const names = TOOLS.map((tool) => tool.name);
    for (const needed of [
      "studio_computer_displays",
      "studio_computer_screenshot",
      "studio_computer_zoom",
      "studio_computer_click",
      "studio_computer_type",
      "studio_computer_key",
      "studio_computer_windows",
      "studio_computer_open",
      "studio_computer_read_ui",
      "studio_computer_act",
      "studio_computer_clipboard",
      "studio_computer_stop",
    ]) {
      expect(names).toContain(needed);
    }
  });

  it("folds the common pattern's variants into arguments, not tools", () => {
    // Thirty in the list a person handed over; one tool per capability here.
    const names = TOOLS.map((tool) => tool.name);
    for (const folded of [
      "studio_computer_left_click",
      "studio_computer_right_click",
      "studio_computer_double_click",
      "studio_computer_triple_click",
      "studio_computer_left_mouse_down",
      "studio_computer_read_clipboard",
      "studio_computer_switch_display",
      "studio_computer_request_access",
    ]) {
      expect(names).not.toContain(folded);
    }
    const click = toolByName("studio_computer_click");
    const properties = click?.inputSchema["properties"] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(["button", "count", "modifiers", "display"]));
  });

  it("describes every tool and every input, because the schema is the manual", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema["type"]).toBe("object");
      expect(tool.inputSchema["additionalProperties"]).toBe(false);
    }
  });

  it("answers tools/list with definitions and nothing else", () => {
    for (const definition of definitions()) {
      expect(Object.keys(definition).sort()).toEqual(["description", "inputSchema", "name"]);
    }
  });
});

describe("bearings: the tools that keep a model from getting lost", () => {
  const said = (answer: { content: readonly Record<string, unknown>[] }): string => String(answer.content[0]?.["text"]);
  const row = (handle: number, title: string, display: number) => ({
    handle,
    title,
    app: "Notepad",
    pid: 1,
    x: 10,
    y: 20,
    width: 800,
    height: 600,
    minimized: false,
    maximized: false,
    display,
  });
  const withPictures = (answers: Record<string, unknown>): ComputerSession =>
    ({
      request: async (op: string) => answers[op] ?? {},
      rememberFrame: () => undefined,
    }) as unknown as ComputerSession;

  it("status says which window is being worked in, on which display, and whether it is in front", async () => {
    const session = withPictures({
      status: { target: row(4, "Notes", 1), targetInFront: false, front: row(9, "Other", 0), cursor: { display: 0, x: 1, y: 2 }, displays: [] },
    });
    const answer = await toolByName("studio_computer_status")!.run(session, {});
    expect(said(answer)).toContain('Working in: "Notes" (window 4) (Notepad) on display 1');
    expect(said(answer)).toContain("NOT the window in front");
    expect(said(answer)).toContain('In front: "Other" (window 9)');
  });

  it("status says when nothing has been chosen yet, and when the target has closed", async () => {
    const fresh = await toolByName("studio_computer_status")!.run(withPictures({ status: { target: null, targetGone: false } }), {});
    expect(said(fresh)).toContain("No window has been chosen");
    const gone = await toolByName("studio_computer_status")!.run(withPictures({ status: { target: null, targetGone: true } }), {});
    expect(said(gone)).toContain("has closed");
  });

  it("windows marks the display and the window being worked in", async () => {
    const session = withPictures({ windows: [{ ...row(4, "Notes", 1), foreground: true, target: true }] });
    const answer = await toolByName("studio_computer_windows")!.run(session, {});
    expect(said(answer)).toBe(
      'window 4: "Notes" (Notepad) on display 1 at (10,20) 800x600, in front, the window being worked in',
    );
  });

  it("arrange reports the window as it is afterwards, and a close that was only asked for", async () => {
    const session = withPictures({ arrange: { ...row(4, "Notes", 0), maximized: true } });
    const done = await toolByName("studio_computer_arrange")!.run(session, { window: 4, action: "maximize" });
    expect(said(done)).toContain('Maximized "Notes" (window 4) (Notepad) on display 0, 800x600 at (10,20), maximized.');
    const asked = await toolByName("studio_computer_arrange")!.run(withPictures({ arrange: { closed: false, handle: 4 } }), { window: 4, action: "close" });
    expect(said(asked)).toContain("still open");
  });

  it("wait_for_window names what appeared, or says that nothing did", async () => {
    const found = await toolByName("studio_computer_wait_for_window")!.run(
      withPictures({ wait_window: { found: true, handle: 7, title: "Save As", app: "Notepad", display: 0, foreground: true } }),
      { text: "Save As" },
    );
    expect(said(found)).toBe('"Save As" (window 7) (Notepad) is on display 0. It is in front; focus it by handle before keys.');
    const adopted = await toolByName("studio_computer_wait_for_window")!.run(
      withPictures({ wait_window: { found: true, handle: 7, title: "Save As", app: "Notepad", display: 0, foreground: true, adopted: true } }),
      { text: "Save As" },
    );
    expect(said(adopted)).toMatch(/now the one being worked in; keys go to it, and once it closes the work returns to the window that raised it\.$/);
    const none = await toolByName("studio_computer_wait_for_window")!.run(withPictures({ wait_window: { found: false, waited: 10 } }), { text: "Save As" });
    expect(said(none)).toBe('No window matching "Save As" appeared within 10 seconds.');
  });

});

describe("keys that went out while the front changed", () => {
  // A stand-in for the driver: answers what it is told to, so the tool's
  // words can be checked without a desktop.
  function fakeSession(answers: Record<string, unknown>): ComputerSession {
    return {
      request: async (op: string) => answers[op] ?? {},
    } as unknown as ComputerSession;
  }

  it("says so when the driver reports another window in front", async () => {
    const note = 'The window in front is now "Other" (window 9), not "Notepad" (window 4).';
    const session = fakeSession({ hold: { done: true, front: note } });
    const answer = await toolByName("studio_computer_hold_key")!.run(session, { keys: "shift", seconds: 1 });
    expect(answer.content[0]).toMatchObject({ text: `Held shift for 1 seconds. ${note}` });
  });

  it("says nothing extra when the target stayed in front", async () => {
    const session = fakeSession({ hold: { done: true, front: null } });
    const answer = await toolByName("studio_computer_hold_key")!.run(session, { keys: "shift", seconds: 1 });
    expect(answer.content[0]).toMatchObject({ text: "Held shift for 1 seconds." });
  });
});

describe("saying where it works, and refusing well where it does not", () => {
  it("tells the model not to retry, and the person what would change it", () => {
    const message = unsupportedMessage();
    expect(message).toMatch(/not something to retry/);
    expect(message).toMatch(/Tell the person/);
    expect(message).toMatch(/ADR 0055/);
    expect(message).toMatch(/browser tools remain available/);
  });

  it("reports for the settings row from the platform it is on", () => {
    const report = computerReport();
    if (process.platform === "win32") {
      expect(report.available).toBe(true);
      expect(report.summary).toMatch(/^Drives this computer/);
    } else {
      expect(report.available).toBe(false);
      expect(report.summary).toMatch(/Not available on/);
    }
  });
});

describe.skipIf(!existsSync(BUNDLE))("the server on the wire", () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let next = 1;

  function start(): ChildProcessWithoutNullStreams {
    if (child !== undefined) return child;
    const started = spawn(process.execPath, [BUNDLE], { stdio: "pipe" });
    createInterface({ input: started.stdout }).on("line", (line) => {
      if (line.trim() === "") return;
      const message = JSON.parse(line) as Record<string, unknown>;
      const waiting = pending.get(message["id"] as number);
      if (waiting !== undefined) {
        pending.delete(message["id"] as number);
        waiting(message);
      }
    });
    child = started;
    return started;
  }

  async function call(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const started = start();
    const id = next++;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      started.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => {
        reject(new Error(`${method} did not answer`));
      }, 15_000);
    });
  }

  afterAll(() => {
    child?.kill();
  });

  it("speaks the modern handshake and lists every tool in one page", async () => {
    const hello = await call("server/discover", { protocolVersion: "2026-07-28" });
    expect((hello["result"] as Record<string, unknown>)["protocolVersion"]).toBe("2026-07-28");
    const list = await call("tools/list", {});
    const tools = (list["result"] as { tools: unknown[] }).tools;
    expect(tools).toHaveLength(TOOLS.length);
    expect((list["result"] as Record<string, unknown>)["nextCursor"]).toBeUndefined();
  });

  it("starts no driver to be connected to, discovered, or listed", async () => {
    // The whole point of the four states: a person whose conversation never
    // touches the desktop must never have a PowerShell started for it.
    await call("tools/list", {});
    const stop = await call("tools/call", { name: "studio_computer_stop", arguments: {} });
    const text = ((stop["result"] as { content: { text?: string }[] }).content[0]?.text) ?? "";
    expect(text).toBe("Computer control was not running.");
  });

  // An input tool's bad arguments are now answered after the desktop lease
  // (ADR 0059), which refuses a caller that has not looked - also as a tool
  // result, also before any driver. An observation tool still meets its own
  // validation first, and click's count rule is pinned on the tool below.
  it("refuses bad input as a tool result before any driver exists", async () => {
    const result = await call("tools/call", {
      name: "studio_computer_zoom",
      arguments: { region: [1] },
    });
    const answer = result["result"] as { isError?: boolean; content: { text?: string }[] };
    expect(answer.isError).toBe(true);
    expect(answer.content[0]?.text).toContain("Give region as [left, top, right, bottom]");
    const blind = await call("tools/call", { name: "studio_computer_click", arguments: { x: 1, y: 1, count: 7 } });
    const refused = blind["result"] as { isError?: boolean; content: { text?: string }[] };
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("No input was sent");
  });

  it("refuses a click count it cannot send, before asking the driver", async () => {
    const click = toolByName("studio_computer_click");
    if (click === undefined) throw new Error("click is missing");
    const asked: string[] = [];
    const session = { request: async (op: string) => { asked.push(op); return {}; } } as unknown as ComputerSession;
    await expect(click.run(session, { x: 1, y: 1, count: 7 })).rejects.toThrow("count must be 1, 2 or 3");
    expect(asked).toEqual([]);
  });

  it("answers a tool that does not exist without dying", async () => {
    const result = await call("tools/call", { name: "studio_computer_nope", arguments: {} });
    expect((result["error"] as Record<string, unknown>)["code"]).toBe(-32602);
    const alive = await call("ping", {});
    expect(alive["result"]).toEqual({});
  });
});
