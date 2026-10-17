import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(),
  spawn: fixture.spawn,
}));

import { killProcessTree } from "../../src/process/exec.js";

class Terminator extends EventEmitter {
  unref(): this { return this; }
}

describe.skipIf(process.platform !== "win32")("Windows process-tree termination", () => {
  it("handles asynchronous spawn failure without crashing the harness", () => {
    const terminator = new Terminator();
    fixture.spawn.mockReturnValue(terminator);
    const fallback = vi.fn();
    killProcessTree(123, fallback);
    expect(fallback).not.toHaveBeenCalled();
    expect(() => terminator.emit("error", new Error("fixture spawn failure"))).not.toThrow();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("falls back when taskkill exits unsuccessfully", () => {
    const terminator = new Terminator();
    fixture.spawn.mockReturnValue(terminator);
    const fallback = vi.fn();
    killProcessTree(123, fallback);
    terminator.emit("exit", 1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
