import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { computerReport } from "../../src/computer/resolve.js";
import { unsupportedMessage } from "../../src/computer/session.js";
import { definitions, TOOLS, toolByName } from "../../src/computer/tools.js";

/**
 * The computer-use capability, tested at the seams that can break silently.
 *
 * **The surface**: twenty-three tools, folded the way ADR 0013 folds, each
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
    expect(TOOLS).toHaveLength(23);
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

  it("refuses bad input as a tool result before any driver exists", async () => {
    const result = await call("tools/call", {
      name: "studio_computer_click",
      arguments: { x: 1, y: 1, count: 7 },
    });
    const answer = result["result"] as { isError?: boolean; content: { text?: string }[] };
    expect(answer.isError).toBe(true);
    expect(answer.content[0]?.text).toContain("count must be 1, 2 or 3");
  });

  it("answers a tool that does not exist without dying", async () => {
    const result = await call("tools/call", { name: "studio_computer_nope", arguments: {} });
    expect((result["error"] as Record<string, unknown>)["code"]).toBe(-32602);
    const alive = await call("ping", {});
    expect(alive["result"]).toEqual({});
  });
});
