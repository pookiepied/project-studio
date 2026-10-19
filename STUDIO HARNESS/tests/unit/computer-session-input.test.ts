import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerSession } from "../../src/computer/session.js";
import { toolByName } from "../../src/computer/tools.js";

// Substitute a real JSON-lines child, never PowerShell or desktop input.
vi.mock("node:child_process", async (load) => {
  const actual = await load<typeof import("node:child_process")>();
  return { ...actual, spawn: () => actual.spawn(process.execPath, ["-e", `
    const lines = require('node:readline').createInterface({ input: process.stdin });
    console.log(JSON.stringify({ id: 'ready', ok: true }));
    lines.on('line', line => {
      const request = JSON.parse(line);
      const result = request.op === 'screenshot'
        ? { display: 0, frameWidth: 100, frameHeight: 100, x: 0, y: 0, width: 100, height: 100, imageWidth: 100, imageHeight: 100, mimeType: 'image/jpeg', data: 'AAAA' }
        : { said: 'Sent.', observation: { available: true }, x: 1, y: 2, display: 0 };
      console.log(JSON.stringify({ id: request.id, ok: request.op !== 'set_value', result,
        error: 'The control changed. Read the window again.',
        userInput: request.op === 'act' || request.op === 'set_value' || request.op === 'cursor'
          ? { available: true, moves: 1, stateAvailable: true, cursor: { x: 42, y: 18, display: 0 }, front: { title: 'Current', handle: 30 } } : null }));
    });
    lines.on('close', () => process.exit(0));
  `], { stdio: "pipe", windowsHide: true }) };
});
const sessions: ComputerSession[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((session) => session.close())); });

describe.skipIf(process.platform !== "win32")("input context through the actual session protocol", () => {
  it("keeps updates from action and follow-up cursor requests together without replaying the action", async () => {
    const session = new ComputerSession("isolated-input-protocol"); sessions.push(session);
    const tool = toolByName("studio_computer_act");
    if (!tool) throw new Error("Missing tool");
    const result = await session.runTool(() => tool.run(session, { ref: "ui_test" }));
    expect(result.structuredContent).toMatchObject({ observation: { available: true }, userInput: { moves: 2, front: { title: "Current", handle: 30 }, cursor: { x: 42, y: 18, display: 0 } } });
    expect(result.content.filter((item) => item.type === "image")).toHaveLength(1);
    const next = await session.runTool(async () => { await session.request("ping"); return { content: [] }; });
    expect(next.structuredContent).toBeUndefined();
  });
  it("preserves error context and delivers input updates when the control action refuses", async () => {
    const session = new ComputerSession("isolated-input-error"); sessions.push(session);
    const tool = toolByName("studio_computer_set_value");
    if (!tool) throw new Error("Missing tool");
    const result = await session.runTool(() => tool.run(session, { ref: "ui_test", value: "private" }));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.["text"]).toContain("Read the window again");
    expect(result.structuredContent).toMatchObject({ userInput: { moves: 1 } });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
