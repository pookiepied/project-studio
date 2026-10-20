import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerSession } from "../../src/computer/session.js";
import { toolByName } from "../../src/computer/tools.js";

const spawned = vi.hoisted(() => ({ children: [] as import("node:child_process").ChildProcessWithoutNullStreams[] }));

// Substitute a real JSON-lines child, never PowerShell or desktop input.
vi.mock("node:child_process", async (load) => {
  const actual = await load<typeof import("node:child_process")>();
  return { ...actual, spawn: () => {
    const child = actual.spawn(process.execPath, ["-e", `
    const lines = require('node:readline').createInterface({ input: process.stdin });
    let active = false, closing = false;
    console.log(JSON.stringify({ id: 'ready', ok: true }));
    lines.on('line', line => {
      const request = JSON.parse(line);
      if (request.op === 'hold' || request.op === 'wedged') {
        active = true;
        console.error('holding');
        if (request.op === 'hold') setTimeout(() => {
          active = false;
          console.log(JSON.stringify({ id: request.id, ok: true, result: { released: true } }));
          if (closing) process.exit(0);
        }, 2500);
        return;
      }
      const result = request.op === 'screenshot'
        ? { display: 0, frameWidth: 100, frameHeight: 100, x: 0, y: 0, width: 100, height: 100, imageWidth: 100, imageHeight: 100, mimeType: 'image/jpeg', data: 'AAAA' }
        : { said: 'Sent.', observation: { available: true }, x: 1, y: 2, display: 0 };
      console.log(JSON.stringify({ id: request.id, ok: request.op !== 'set_value', result,
        error: 'The control changed. Read the window again.',
        userInput: request.op === 'act' || request.op === 'set_value' || request.op === 'cursor'
          ? { available: true, moves: 1, stateAvailable: true, cursor: { x: 42, y: 18, display: 0 }, front: { title: 'Current', handle: 30 } } : null }));
    });
    lines.on('close', () => { closing = true; if (!active) process.exit(0); });
    setInterval(() => {}, 1000);
  `], { stdio: "pipe", windowsHide: true });
    spawned.children.push(child);
    return child;
  } };
});
const sessions: ComputerSession[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const child of spawned.children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill();
});

describe.skipIf(process.platform !== "win32")("input context through the actual session protocol", () => {
  it("does not claim computer cleanup succeeded when orderly exit is unconfirmed", async () => {
    class UnconfirmedSession extends ComputerSession {
      override get running() { return true; }
      override async close() { return false; }
      override async request(): Promise<never> { throw new Error("Stop must not append input requests before fencing the driver."); }
    }
    const stop = toolByName("studio_computer_stop");
    if (!stop) throw new Error("Missing tool");
    const result = await stop.run(new UnconfirmedSession("isolated-unconfirmed"), {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.["text"]).toContain("not confirmed");
  });
  it("blocks queued input immediately but lets the active native call release before orderly shutdown", async () => {
    const session = new ComputerSession("isolated-drain"); sessions.push(session);
    await session.request("ping");
    const child = spawned.children.at(-1);
    if (!child) throw new Error("Missing child");
    const started = new Promise<void>((resolve) => child.stderr.once("data", () => resolve()));
    const action = session.runTool(async () => { await session.request("hold"); return { content: [] }; });
    const refused = expect(action).rejects.toThrow("outcome was observed");
    await started;
    let queuedRan = false;
    const queued = session.runTool(async () => { queuedRan = true; return { content: [] }; });
    const queuedRefused = expect(queued).rejects.toThrow("queued");
    expect(await session.close()).toBe(true);
    await refused; await queuedRefused;
    expect(child.exitCode).toBe(0);
    expect(queuedRan).toBe(false);
  });

  it("reports unconfirmed cleanup when a wedged call exceeds its original deadline", async () => {
    const session = new ComputerSession("isolated-wedged"); sessions.push(session);
    await session.request("ping");
    const child = spawned.children.at(-1);
    if (!child) throw new Error("Missing child");
    const started = new Promise<void>((resolve) => child.stderr.once("data", () => resolve()));
    const action = session.request("wedged");
    const refused = expect(action).rejects.toThrow("outcome was observed");
    await started;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    expect(await session.close()).toBe(false);
    await refused;
    vi.restoreAllMocks();
  });
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
