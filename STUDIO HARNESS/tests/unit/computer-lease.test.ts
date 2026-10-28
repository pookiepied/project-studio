import { afterEach, describe, expect, it, vi } from "vitest";

import { ComputerService } from "../../src/computer/service.js";

const spawned = vi.hoisted(() => ({ children: [] as import("node:child_process").ChildProcessWithoutNullStreams[], ops: [] as string[] }));

// The driver's platform gate, opened for a stand-in: nothing here starts
// PowerShell or sends input to the machine running the suite.
vi.mock("node:os", async (load) => {
  const actual = await load<typeof import("node:os")>();
  return { ...actual, platform: () => "win32" };
});

// A JSON-lines child in place of driver.ps1. `type` takes 300 ms, like
// typing a sentence; every other operation answers at once. Each operation
// is reported on stderr so a test can say exactly what reached the driver.
vi.mock("node:child_process", async (load) => {
  const actual = await load<typeof import("node:child_process")>();
  return { ...actual, spawn: () => {
    const child = actual.spawn(process.execPath, ["-e", `
    const lines = require('node:readline').createInterface({ input: process.stdin });
    let busy = 0, closing = false, shots = 0;
    console.log(JSON.stringify({ id: 'ready', ok: true }));
    const answer = (request) => {
      shots++;
      const result = request.op === 'screenshot'
        ? { display: typeof request.args.display === 'number' ? request.args.display : 0, frameWidth: 100, frameHeight: 100, x: 0, y: 0, width: 100, height: 100, imageWidth: 100, imageHeight: 100, mimeType: 'image/jpeg', data: 'SHOT' + shots,
            pointer: { x: 7, y: 8, display: 0 }, front: { title: 'Form', app: 'app', handle: 42 } }
        : request.op === 'cursor' ? { x: 1, y: 2, display: 0 }
        : request.op === 'pulse' ? { pointer: { x: 150, y: 40, display: 1 }, front: { title: 'Form', app: 'app', handle: 42 }, input: { buttons: 0, keys: 0, wheels: 0, moves: 0 }, monitored: true }
        : request.op === 'displays' ? [{ index: 0, x: 0, y: 0, width: 100, height: 100 }, { index: 1, x: 100, y: 0, width: 200, height: 100 }]
        : request.op === 'status' ? { target: null, front: null, cursor: { x: 1, y: 2, display: 0 }, displays: [] }
        : { said: 'Sent.', typed: 5, done: true, released: true, observation: { available: true, refsInvalidated: true } };
      // The window list stands in for any answer that carries the person's own clicks.
      const human = request.op === 'windows';
      console.log(JSON.stringify({ id: request.id, ok: true, result,
        userInput: human ? { available: true, moves: 0, buttons: 1, wheels: 0, keys: 0, stateAvailable: true } : null }));
    };
    lines.on('line', line => {
      const request = JSON.parse(line);
      console.error('op:' + request.op);
      if (request.op === 'act') { console.log(JSON.stringify({ id: request.id, ok: false, error: 'The control changed. Read the window again.' })); return; }
      if (request.op === 'type') {
        busy++;
        setTimeout(() => { busy--; answer(request); if (closing && busy === 0) process.exit(0); }, 300);
        return;
      }
      answer(request);
    });
    lines.on('close', () => { closing = true; if (busy === 0) process.exit(0); });
    setInterval(() => {}, 1000);
  `], { stdio: "pipe", windowsHide: true });
    child.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) if (line.startsWith("op:")) spawned.ops.push(line.slice(3));
    });
    spawned.children.push(child);
    return child;
  } };
});

const services: ComputerService[] = [];
/** Sharing is on for the chat here: these tests are about the lease, and sharing has its own below. */
function service(sharing = true): ComputerService {
  // No pulse: these count the operations that reach the driver, and the
  // screen watch's own sampling has its tests below.
  const created = new ComputerService(undefined, 0);
  if (sharing) created.setSharing(CHAT, true);
  services.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(services.splice(0).map((each) => each.finish()));
  for (const child of spawned.children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill();
  spawned.ops.splice(0);
});

const CHAT = "conv_lease_a";
const OTHER_CHAT = "conv_lease_b";
const voice = { "studio/conversation": CHAT, "studio/actor": CHAT, "studio/role": "voice" };
const hazel = { "studio/conversation": CHAT, "studio/actor": "voice_hazel", "studio/role": "worker", "studio/actor-name": "Hazel" };
const juniper = { "studio/conversation": CHAT, "studio/actor": "voice_juniper", "studio/role": "worker", "studio/actor-name": "Juniper" };
const elsewhere = { "studio/conversation": OTHER_CHAT, "studio/actor": OTHER_CHAT, "studio/role": "conversation" };

function said(answer: { content: readonly { readonly type: string; readonly [key: string]: unknown }[] }): string {
  return answer.content.filter((block) => block.type === "text").map((block) => String(block["text"])).join("\n");
}

function refusal(answer: { structuredContent?: Record<string, unknown> }): unknown {
  const desktop = answer.structuredContent?.["desktop"];
  return typeof desktop === "object" && desktop !== null && "refused" in desktop ? desktop.refused : undefined;
}

async function own(computer: ComputerService, meta: Record<string, string>): Promise<void> {
  await computer.call("studio_computer_screenshot", {}, meta);
  const clicked = await computer.call("studio_computer_click", { x: 5, y: 5 }, meta);
  expect(clicked.isError).toBeUndefined();
}

describe("one hand on the desktop, per actor", () => {
  it("refuses the voice agent's input while a worker of the same chat owns the desktop, and still lets it look", async () => {
    const computer = service();
    await own(computer, hazel);
    const looked = await computer.call("studio_computer_screenshot", {}, voice);
    expect(looked.isError).toBeUndefined();
    const ops = spawned.ops.length;
    const refused = await computer.call("studio_computer_click", { x: 9, y: 9 }, voice);
    expect(refused.isError).toBe(true);
    expect(refusal(refused)).toBe("not_owner");
    expect(said(refused)).toContain("Hazel (task voice_hazel) has the desktop");
    expect(refused.structuredContent).toMatchObject({ desktop: { owner: { self: false, sameConversation: true, role: "worker", taskId: "voice_hazel", name: "Hazel" } } });
    // Refused is refused: nothing reached the driver, and nothing is waiting to.
    expect(spawned.ops.length).toBe(ops);
  });

  it("refuses a second worker in the same chat", async () => {
    const computer = service();
    await own(computer, hazel);
    await computer.call("studio_computer_status", {}, juniper);
    const refused = await computer.call("studio_computer_type", { text: "x" }, juniper);
    expect(refusal(refused)).toBe("not_owner");
  });

  it("tells another conversation only that another conversation has the desktop", async () => {
    const computer = service();
    await own(computer, hazel);
    await computer.call("studio_computer_status", {}, elsewhere);
    const refused = await computer.call("studio_computer_click", { x: 1, y: 1 }, elsewhere);
    expect(refusal(refused)).toBe("other_conversation");
    const text = JSON.stringify(refused);
    for (const leak of [CHAT, "voice_hazel", "Hazel"]) expect(text).not.toContain(leak);
  });

  it("fences only the failing actor's queued calls, not a sibling's look queued behind them", async () => {
    const computer = service();
    await own(computer, hazel);
    const slow = computer.call("studio_computer_type", { text: "slow" }, hazel);
    const failing = computer.call("studio_computer_act", { ref: "ui_x_1" }, hazel).then(said, (error: unknown) => String(error));
    const ownNext = computer.call("studio_computer_key", { keys: "return" }, hazel).then(said, (error: unknown) => String(error));
    const look = computer.call("studio_computer_screenshot", {}, voice);
    await slow;
    expect(await failing).toContain("Read the window again");
    expect(await ownNext).toMatch(/queued/);
    expect((await look).isError).toBeUndefined();
  });

  it("requires a look before the first input, and again after someone else's input", async () => {
    const computer = service();
    const blind = await computer.call("studio_computer_click", { x: 1, y: 1 }, hazel);
    expect(refusal(blind)).toBe("observe_first");
    await own(computer, hazel);
    // Its own click does not make its look stale.
    expect((await computer.call("studio_computer_key", { keys: "return" }, hazel)).isError).toBeUndefined();
  });

  it("makes the owner look again after the person's own clicks or keys, without stopping anything", async () => {
    const computer = service();
    await own(computer, hazel);
    const noticed = await computer.call("studio_computer_windows", {}, hazel);
    expect(noticed.isError).toBeUndefined();
    expect(noticed.structuredContent).toMatchObject({ userInput: { buttons: 1 } });
    // The answer that reported the person's click was read before it was
    // known about; the next input waits for a look taken after.
    expect(refusal(await computer.call("studio_computer_click", { x: 1, y: 1 }, hazel))).toBe("observe_first");
    await computer.call("studio_computer_screenshot", {}, hazel);
    expect((await computer.call("studio_computer_click", { x: 1, y: 1 }, hazel)).isError).toBeUndefined();
  });
});

describe("pause, handoff and stop", () => {
  it("stops a batch between steps when the person pauses, sends nothing after, and keeps the task's place", async () => {
    const computer = service();
    await computer.call("studio_computer_screenshot", {}, hazel);
    const batch = computer.call("studio_computer_batch", { steps: [
      { tool: "type", text: "first" }, { tool: "type", text: "second" }, { tool: "key", keys: "return" },
    ] }, hazel);
    await vi.waitFor(() => expect(spawned.ops).toContain("type"));
    const paused = await computer.control({ input: { action: "pause" }, _meta: { "studio/conversation": CHAT } });
    expect(paused).toMatchObject({ result: "paused", inFlightUncertain: true });
    const result = await batch;
    const text = said(result);
    expect(text).toContain("1. type");
    expect(text).toMatch(/2\. type failed: Desktop control changed/);
    expect(text).toContain("Not run: 3. key");
    // One type reached the driver; the paused steps never did.
    expect(spawned.ops.filter((op) => op === "type")).toHaveLength(1);
    expect(spawned.ops).not.toContain("key");
    expect(spawned.ops).toContain("release_held");
    expect(refusal(await computer.call("studio_computer_click", { x: 1, y: 1 }, hazel))).toBe("paused");
  });

  it("refuses a call queued before a pause even after the same task gets the desktop back", async () => {
    const computer = service();
    await own(computer, hazel);
    const slow = computer.call("studio_computer_type", { text: "slow" }, hazel);
    const queued = computer.call("studio_computer_key", { keys: "return" }, hazel);
    await vi.waitFor(() => expect(spawned.ops).toContain("type"));
    await computer.control({ input: { action: "pause" }, _meta: { "studio/conversation": CHAT } });
    await computer.control({ input: { action: "resume" }, _meta: { "studio/conversation": CHAT } });
    await slow;
    expect(refusal(await queued)).toBe("revoked");
    expect(spawned.ops).not.toContain("key");
    // Resuming is not permission to carry on blind.
    expect(refusal(await computer.call("studio_computer_key", { keys: "return" }, hazel))).toBe("observe_first");
    await computer.call("studio_computer_screenshot", {}, hazel);
    expect((await computer.call("studio_computer_key", { keys: "return" }, hazel)).isError).toBeUndefined();
  });

  it("refuses an action approved while paused, at the moment it would run", async () => {
    // A permission card answered during a pause reaches the server after it:
    // the lease, not the approval, decides whether anything is sent.
    const computer = service();
    await own(computer, hazel);
    await computer.control({ input: { action: "pause" }, _meta: { "studio/conversation": CHAT } });
    expect(refusal(await computer.call("studio_computer_type", { text: "approved later" }, hazel))).toBe("paused");
  });

  it("hands a paused task's desktop to the voice agent, and makes the task reacquire and look again", async () => {
    const computer = service();
    await own(computer, hazel);
    await computer.control({ input: { action: "pause" }, _meta: { "studio/conversation": CHAT } });
    // A worker cannot lift the person's pause by taking the desktop.
    expect(refusal(await computer.call("studio_computer_control", { action: "acquire" }, juniper))).toBe("paused");
    const taken = await computer.call("studio_computer_control", { action: "acquire" }, voice);
    expect(taken.structuredContent).toMatchObject({ desktop: { mode: "active", owner: { self: true } } });
    expect(refusal(await computer.call("studio_computer_click", { x: 1, y: 1 }, voice))).toBe("observe_first");
    await own(computer, voice);
    expect(refusal(await computer.call("studio_computer_click", { x: 1, y: 1 }, hazel))).toBe("not_owner");
    await computer.call("studio_computer_control", { action: "release" }, voice);
    expect(refusal(await computer.call("studio_computer_click", { x: 1, y: 1 }, hazel))).toBe("observe_first");
    await own(computer, hazel);
  });

  it("lets a paused worker wait for the resume instead of spinning", async () => {
    const computer = service();
    await own(computer, hazel);
    await computer.control({ input: { action: "pause" }, _meta: { "studio/conversation": CHAT } });
    const started = Date.now();
    const waiting = computer.call("studio_computer_control", { action: "wait" }, hazel);
    setTimeout(() => { void computer.control({ input: { action: "resume" }, _meta: { "studio/conversation": CHAT } }); }, 50);
    const answer = await waiting;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(answer.structuredContent).toMatchObject({ desktop: { mode: "active", fresh: false } });
  });

  it("does not let one chat pause another chat's work", async () => {
    const computer = service();
    await own(computer, hazel);
    expect(await computer.control({ input: { action: "pause" }, _meta: { "studio/conversation": OTHER_CHAT } })).toMatchObject({ result: "other_conversation" });
    expect((await computer.call("studio_computer_key", { keys: "a" }, hazel)).isError).toBeUndefined();
  });

  it("fences the owner at Stop and keeps others out until the driver has really ended", async () => {
    const computer = service();
    await own(computer, hazel);
    // Each call is answered either way - a result or a refusal - and both count as "not sent" for the queued one.
    const typing = computer.call("studio_computer_type", { text: "in flight" }, hazel).then(said, (error: unknown) => String(error));
    const queued = computer.call("studio_computer_key", { keys: "return" }, hazel).then(said, (error: unknown) => String(error));
    await vi.waitFor(() => expect(spawned.ops).toContain("type"));
    const stopping = computer.call("studio_computer_stop", {}, { "studio/conversation": CHAT, "studio/human-stop": true });
    await computer.call("studio_computer_status", {}, elsewhere);
    expect(refusal(await computer.call("studio_computer_click", { x: 1, y: 1 }, elsewhere))).toBe("other_conversation");
    expect(said(await stopping)).toContain("has stopped");
    // The call that was out when Stop came is reported as not observed, never as done.
    expect(await typing).toContain("do not replay it automatically");
    expect(await queued).toMatch(/queued/);
    expect(spawned.ops).not.toContain("key");
    await computer.call("studio_computer_screenshot", {}, elsewhere);
    expect((await computer.call("studio_computer_click", { x: 1, y: 1 }, elsewhere)).isError).toBeUndefined();
  });

  it("releases a settled task's desktop and what it holds", async () => {
    const computer = service();
    await own(computer, hazel);
    const released = await computer.control({ input: { action: "release_actor", actor: "voice_hazel" }, _meta: { "studio/conversation": CHAT } });
    expect(released).toMatchObject({ released: true, heldInput: "released" });
    await computer.call("studio_computer_screenshot", {}, juniper);
    expect((await computer.call("studio_computer_click", { x: 1, y: 1 }, juniper)).isError).toBeUndefined();
  });

  it("holds every automation input while the person shows something, and makes everyone look again after", async () => {
    const computer = service();
    await own(computer, hazel);
    expect(await computer.control({ input: { action: "demonstrate" }, _meta: { "studio/conversation": CHAT } })).toMatchObject({ result: "demonstrating" });
    expect(refusal(await computer.call("studio_computer_click", { x: 1, y: 1 }, hazel))).toBe("demonstrating");
    expect(refusal(await computer.call("studio_computer_click", { x: 1, y: 1 }, voice))).toBe("demonstrating");
    expect((await computer.call("studio_computer_screenshot", {}, voice)).isError).toBeUndefined();
    await computer.control({ input: { action: "resume" }, _meta: { "studio/conversation": CHAT } });
    expect(refusal(await computer.call("studio_computer_click", { x: 1, y: 1 }, hazel))).toBe("observe_first");
  });
});

function image(answer: { content: readonly { readonly type: string; readonly [key: string]: unknown }[] }): unknown {
  return answer.content.find((block) => block.type === "image")?.["data"];
}

describe("one shared picture per conversation", () => {
  it("lets the voice agent see the worker's actual picture, with who took it and the pointer sampled with it", async () => {
    const computer = service();
    const shot = await computer.call("studio_computer_screenshot", {}, hazel);
    // A later pointer read is not paired with the older picture.
    await computer.call("studio_computer_cursor", {}, hazel);
    const latest = await computer.call("studio_computer_control", { action: "latest" }, voice);
    expect(image(latest)).toBe(image(shot));
    expect(said(latest)).toContain("by Hazel (task voice_hazel)");
    expect(said(latest)).toContain("pointer was at (7,8) on display 0 when it was taken");
    expect(said(latest)).toContain("untrusted screen text");
    expect(latest.structuredContent).toMatchObject({ observation: { pointer: { x: 7, y: 8, display: 0 }, by: { role: "worker", id: "voice_hazel" }, stale: [] } });
    expect(JSON.stringify(latest.structuredContent)).not.toContain(String(image(shot)));
  });

  it("says a picture may be stale once someone has acted, and never counts it as the reader's own look", async () => {
    const computer = service();
    await computer.call("studio_computer_screenshot", {}, hazel);
    await computer.call("studio_computer_windows", {}, hazel);
    const latest = await computer.call("studio_computer_control", { action: "latest" }, voice);
    expect(latest.structuredContent).toMatchObject({ observation: { stale: ["changed_since"] } });
    expect(said(latest)).toContain("Take a new screenshot before relying on it");
    expect(refusal(await computer.call("studio_computer_click", { x: 1, y: 1 }, voice))).toBe("observe_first");
  });

  it("keeps each conversation's picture to itself", async () => {
    const computer = service();
    await computer.call("studio_computer_screenshot", {}, hazel);
    expect(said(await computer.call("studio_computer_control", { action: "latest" }, elsewhere))).toContain("No picture has been taken in this conversation yet");
  });

  it("keeps pictures for only the most recent conversations", async () => {
    const computer = service();
    for (let index = 0; index < 9; index += 1) await computer.call("studio_computer_screenshot", {}, { "studio/conversation": `conv_many_${String(index)}` });
    expect(said(await computer.call("studio_computer_control", { action: "latest" }, { "studio/conversation": "conv_many_0" }))).toContain("No picture");
    expect(image(await computer.call("studio_computer_control", { action: "latest" }, { "studio/conversation": "conv_many_8" }))).toBeDefined();
  });

  it("answers a bounded context snapshot with provenance and freshness, never the bytes", async () => {
    const computer = service();
    await computer.call("studio_computer_screenshot", {}, hazel);
    const context = computer.context(CHAT);
    expect(context).toMatchObject({ sharing: true, latest: { by: { role: "worker", taskId: "voice_hazel", name: "Hazel" }, pointer: { x: 7, y: 8 }, stale: [] } });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("SHOT");
    expect(serialized.length).toBeLessThan(1_500);
  });
});

describe("screen sharing in a voice call", () => {
  it("refuses the voice agent's looks and actions while sharing is off, sending nothing, and leaves workers alone", async () => {
    const computer = service(false);
    const refused = await computer.call("studio_computer_screenshot", {}, voice);
    expect(refused.isError).toBe(true);
    expect(said(refused)).toContain("Screen sharing is off");
    expect(spawned.ops).toEqual([]);
    expect((await computer.call("studio_computer_control", { action: "status" }, voice)).isError).toBeUndefined();
    expect(image(await computer.call("studio_computer_screenshot", {}, hazel))).toBeDefined();
    expect((await computer.call("studio_computer_control", { action: "latest" }, voice)).isError).toBe(true);
  });

  it("discards a picture that finishes after sharing was turned off, and does not share it", async () => {
    const computer = service();
    await computer.call("studio_computer_screenshot", {}, voice);
    const before = computer.context(CHAT)["latest"];
    const typing = computer.call("studio_computer_batch", { steps: [{ tool: "type", text: "slow" }] }, voice);
    await vi.waitFor(() => expect(spawned.ops).toContain("type"));
    computer.setSharing(CHAT, false);
    const answer = await typing;
    expect(image(answer)).toBeUndefined();
    expect(said(answer)).toContain("its picture was discarded");
    expect(said(answer)).toContain("Input already sent stays sent");
    computer.setSharing(CHAT, true);
    expect(computer.context(CHAT)["latest"]).toEqual(expect.objectContaining({ id: (before as { id: string }).id }));
  });

  it("keeps the voice agent's tools short and its own", async () => {
    const computer = service();
    await computer.call("studio_computer_screenshot", {}, voice);
    const long = await computer.call("studio_computer_batch", { steps: Array.from({ length: 7 }, () => ({ tool: "key", keys: "a" })) }, voice);
    expect(said(long)).toContain("at most 6 steps");
    expect(said(await computer.call("studio_computer_drag", { from: [0, 0], to: [1, 1] }, voice))).toContain("not offered");
    expect(said(await computer.call("studio_computer_stop", {}, voice))).toContain("not offered");
    expect(spawned.ops).not.toContain("key");
  });
});

describe("the shared screen between pictures", () => {
  function watched(pulseMs = 20): ComputerService {
    const created = new ComputerService(undefined, pulseMs);
    services.push(created);
    return created;
  }

  it("samples the pointer only while sharing is on, and says where it is", async () => {
    const computer = watched();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(spawned.ops).not.toContain("pulse");
    expect(computer.context(CHAT)["live"]).toBe("off");
    computer.setSharing(CHAT, true);
    await vi.waitFor(() => expect(computer.context(CHAT)["pointer"]).toMatchObject({ x: 150, y: 40, display: 1 }));
    expect(computer.context(CHAT)["live"]).toBe("on");
    computer.setSharing(CHAT, false);
    const sampled = spawned.ops.filter((op) => op === "pulse").length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(spawned.ops.filter((op) => op === "pulse").length).toBe(sampled);
    expect(computer.context(CHAT)["pointer"]).toBeUndefined();
  });

  it("takes a picture of the display the pointer is on as speech ends, and skips it while that picture is current", async () => {
    const computer = watched();
    computer.setSharing(CHAT, true);
    await vi.waitFor(() => expect(computer.context(CHAT)["pointer"]).toBeDefined());
    const first = await computer.control({ input: { action: "glance" }, _meta: { "studio/conversation": CHAT } });
    expect(first).toMatchObject({ glanced: true });
    expect(computer.context(CHAT)["latest"]).toMatchObject({ by: { role: "glance" } });
    const again = await computer.control({ input: { action: "glance" }, _meta: { "studio/conversation": CHAT } });
    expect(again).toMatchObject({ glanced: false });
    expect(spawned.ops.filter((op) => op === "screenshot").length).toBe(1);
  });

  it("does not let a glance count as the voice agent's own look before input", async () => {
    const computer = watched(0);
    computer.setSharing(CHAT, true);
    await computer.control({ input: { action: "glance" }, _meta: { "studio/conversation": CHAT } });
    const clicked = await computer.call("studio_computer_click", { x: 5, y: 5 }, voice);
    expect(refusal(clicked)).toBe("observe_first");
  });

  it("refuses a glance while sharing is off, sending nothing", async () => {
    const computer = watched(0);
    expect(await computer.control({ input: { action: "glance" }, _meta: { "studio/conversation": CHAT } })).toEqual({ glanced: false, reason: "sharing_off" });
    expect(spawned.ops).toEqual([]);
  });

  it("places what the person drew on the display it falls on, in that display's pixels", async () => {
    const computer = watched(0);
    computer.setSharing(CHAT, true);
    const recorded = await computer.control({ input: { action: "drew", shapes: [{ shape: "loop", x: 140, y: 20, width: 30, height: 20 }, { shape: "dot", x: 9999, y: 9999, width: 0, height: 0 }] }, _meta: { "studio/conversation": CHAT } });
    expect(recorded).toEqual({ recorded: 1 });
    expect(computer.context(CHAT)["recent"]).toEqual([expect.objectContaining({ kind: "drew", shape: "loop", display: 1, x: 40, y: 20, width: 30, height: 20 })]);
  });

  it("shows the voice agent's marks on the display it names, and refuses a task's", async () => {
    const computer = watched(0);
    computer.setSharing(CHAT, true);
    const shown = await computer.call("studio_computer_mark", { display: 1, marks: [{ kind: "ring", x: 10, y: 10, width: 40, height: 20, label: "Save" }] }, voice);
    expect(shown.isError).toBeUndefined();
    expect(shown.structuredContent).toMatchObject({ marks: { display: { index: 1, x: 100, y: 0, width: 200, height: 100 }, marks: [{ kind: "ring", label: "Save" }] } });
    const worker = await computer.call("studio_computer_mark", { display: 1, marks: [{ kind: "point", x: 1, y: 1 }] }, hazel);
    expect(worker.isError).toBe(true);
    expect(said(worker)).toContain("not for tasks");
  });
});
