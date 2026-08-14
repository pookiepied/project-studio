import { describe, expect, it } from "vitest";

import { ExtendError } from "../../src/extend/errors.js";
import type { McpChannel } from "../../src/extend/mcp/connection.js";
import { LEGACY_PROTOCOL_VERSIONS } from "../../src/extend/mcp/handshake.js";
import type { McpServerRecord } from "../../src/extend/mcp/registry.js";
import {
  McpSupervisor,
  type McpLauncher,
  type McpSupervisorOptions,
} from "../../src/extend/mcp/supervisor.js";

/**
 * A channel that answers a handshake and nothing else.
 *
 * The supervisor's subject is what happens around a server — starting it,
 * failing, waiting, giving up, being switched off half way — and none of that
 * can be provoked on cue by a real program. A launcher that returns one of
 * these is a server that fails exactly on the third attempt, which is the whole
 * reason the launcher is injected.
 */
class ScriptedChannel implements McpChannel {
  closed = false;
  #data: ((chunk: string | Uint8Array) => void) | undefined;
  #close: ((reason?: unknown) => void) | undefined;
  readonly #era: "legacy" | "silent";

  constructor(era: "legacy" | "silent" = "legacy") {
    this.#era = era;
  }

  send(line: string): void {
    if (this.closed) throw new ExtendError("disconnected");
    const message = JSON.parse(line) as { id?: number; method: string };
    if (message.id === undefined) return;

    if (this.#era === "silent") return;

    if (message.method === "server/discover") {
      this.#reply({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Unknown method" },
      });
      return;
    }

    this.#reply({
      jsonrpc: "2.0",
      id: message.id,
      result: { protocolVersion: LEGACY_PROTOCOL_VERSIONS[0], capabilities: {} },
    });
  }

  onData(listener: (chunk: string | Uint8Array) => void): void {
    this.#data = listener;
  }
  onStderr(): void {
    // Nothing writes diagnostics in these tests.
  }
  onClose(listener: (reason?: unknown) => void): void {
    this.#close = listener;
  }
  close(): void {
    this.closed = true;
  }

  /** Pretend the server died on its own. */
  die(reason?: unknown): void {
    this.closed = true;
    this.#close?.(reason);
  }

  #reply(value: unknown): void {
    this.#data?.(`${JSON.stringify(value)}\n`);
  }
}

const RECORD: McpServerRecord = {
  id: "blender",
  title: "Blender",
  transport: "stdio",
  command: "C:\\tools\\node.exe",
  args: ["server.js"],
  env: {},
  auth: "none",
};

/** Lets every pending microtask and zero-delay timer run. */
async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Backoff with no waiting and no randomness, so a retry is observable. */
const IMMEDIATE = { random: () => 0 } as const;

/**
 * A supervisor whose launches are told apart by server id.
 *
 * This file's subject is what happens *around* a server — starting, failing,
 * waiting, giving up, being switched off half way — and one process per id is
 * the arrangement every one of those rules was written against. The launch key
 * that distinguishes two projects (`C-18`) is the launcher's, and it is
 * exercised where it is decided, in the launcher's own tests.
 */
function scriptedSupervisor(options: {
  launch: McpLauncher["open"];
  backoff?: McpSupervisorOptions["backoff"];
  connection?: McpSupervisorOptions["connection"];
  onReady?: McpSupervisorOptions["onReady"];
  onUnavailable?: McpSupervisorOptions["onUnavailable"];
  onNotification?: McpSupervisorOptions["onNotification"];
}): McpSupervisor {
  return new McpSupervisor({
    launch: { key: (record) => record.id, open: options.launch },
    ...(options.backoff === undefined ? {} : { backoff: options.backoff }),
    ...(options.connection === undefined ? {} : { connection: options.connection }),
    ...(options.onReady === undefined ? {} : { onReady: options.onReady }),
    ...(options.onUnavailable === undefined ? {} : { onUnavailable: options.onUnavailable }),
    ...(options.onNotification === undefined ? {} : { onNotification: options.onNotification }),
  });
}

describe("supervising MCP servers", () => {
  describe("starting", () => {
    it("starts a server on first use and reports it ready", async () => {
      let launches = 0;
      const supervisor = scriptedSupervisor({
        launch: async () => {
          launches += 1;
          return new ScriptedChannel();
        },
      });

      const connection = await supervisor.ensure(RECORD);

      expect(launches).toBe(1);
      expect(connection.closed).toBe(false);
      expect(supervisor.status("blender")?.state).toBe("ready");
      expect(supervisor.status("blender")?.era).toBe("legacy");
    });

    it("starts nothing until something asks", () => {
      const supervisor = scriptedSupervisor({
        launch: async () => {
          throw new Error("must not be launched");
        },
      });

      expect(supervisor.status("blender")).toBeUndefined();
      expect(supervisor.statuses()).toEqual([]);
    });

    it("starts one process for two callers that arrive together", async () => {
      // Two processes for one server is the failure that is hardest to see:
      // both work, so nothing looks wrong until something counts them.
      let launches = 0;
      const supervisor = scriptedSupervisor({
        launch: async () => {
          launches += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return new ScriptedChannel();
        },
      });

      const [first, second] = await Promise.all([
        supervisor.ensure(RECORD),
        supervisor.ensure(RECORD),
      ]);

      expect(launches).toBe(1);
      expect(first).toBe(second);
    });

    it("reuses a running server rather than starting a second one", async () => {
      let launches = 0;
      const supervisor = scriptedSupervisor({
        launch: async () => {
          launches += 1;
          return new ScriptedChannel();
        },
      });

      const first = await supervisor.ensure(RECORD);
      const second = await supervisor.ensure(RECORD);

      expect(launches).toBe(1);
      expect(second).toBe(first);
    });
  });

  describe("failing", () => {
    it("reports the failure to the caller waiting on it", async () => {
      const supervisor = scriptedSupervisor({
        launch: async () => {
          throw new ExtendError("internal", { message: "no such program" });
        },
        backoff: IMMEDIATE,
      });

      await expect(supervisor.ensure(RECORD)).rejects.toThrow(/no such program/);
      expect(supervisor.status("blender")?.lastError).toMatch(/no such program/);
    });

    it("fails fast rather than waiting for every retry", async () => {
      // A tool call must not sit through fifteen seconds of backoff. The caller
      // gets the attempt in progress; the retries happen behind it.
      const supervisor = scriptedSupervisor({
        launch: async () => {
          throw new ExtendError("internal", { message: "broken" });
        },
        backoff: { random: () => 0, baseDelayMs: 60_000, maxAttempts: 5 },
      });

      const started = Date.now();
      await expect(supervisor.ensure(RECORD)).rejects.toThrow(/broken/);

      expect(Date.now() - started).toBeLessThan(1_000);
    });

    it("retries in the background, so the next caller finds it running", async () => {
      let launches = 0;
      const supervisor = scriptedSupervisor({
        launch: async () => {
          launches += 1;
          if (launches === 1) throw new ExtendError("internal", { message: "not yet" });
          return new ScriptedChannel();
        },
        backoff: IMMEDIATE,
      });

      await expect(supervisor.ensure(RECORD)).rejects.toThrow(/not yet/);
      await settle();

      expect(launches).toBe(2);
      expect(supervisor.status("blender")?.state).toBe("ready");
    });

    it("refreshes lifecycle dependents when a background retry recovers", async () => {
      let launches = 0;
      let ready = 0;
      const supervisor = scriptedSupervisor({
        launch: async () => {
          launches += 1;
          if (launches === 1) throw new ExtendError("internal", { message: "not yet" });
          return new ScriptedChannel();
        },
        backoff: IMMEDIATE,
        onReady: () => {
          ready += 1;
        },
      });

      await expect(supervisor.ensure(RECORD)).rejects.toThrow(/not yet/);
      await settle();

      expect(ready).toBe(1);
      expect(supervisor.status("blender")?.state).toBe("ready");
    });

    it("stops retrying a server that always fails", async () => {
      let launches = 0;
      const supervisor = scriptedSupervisor({
        launch: async () => {
          launches += 1;
          throw new ExtendError("internal", { message: "always broken" });
        },
        backoff: { random: () => 0, maxAttempts: 2 },
      });

      await expect(supervisor.ensure(RECORD)).rejects.toThrow();
      await settle();

      // Two retries after the first attempt, and then the decision to stop.
      expect(launches).toBe(3);
      expect(supervisor.status("blender")?.state).toBe("given-up");
      expect(supervisor.status("blender")?.attempts).toBe(3);

      const before = launches;
      await settle();
      expect(launches).toBe(before);
    });

    it("tells a caller how to give a given-up server another chance", async () => {
      const supervisor = scriptedSupervisor({
        launch: async () => {
          throw new ExtendError("internal", { message: "always broken" });
        },
        backoff: { random: () => 0, maxAttempts: 1 },
      });

      await expect(supervisor.ensure(RECORD)).rejects.toThrow();
      await settle();

      await expect(supervisor.ensure(RECORD)).rejects.toThrow(/Switch it off and on again/);
      // The reason is still carried, because "it failed" alone is not actionable.
      await expect(supervisor.ensure(RECORD)).rejects.toThrow(/always broken/);
    });

    it("ends the process when the handshake fails but the program is healthy", async () => {
      // The ordinary case on a machine with an old server installed. The
      // process is running, holds our stdin, and will not exit on its own.
      const channel = new ScriptedChannel("silent");
      const supervisor = scriptedSupervisor({
        launch: async () => channel,
        backoff: { random: () => 0, maxAttempts: 1 },
        connection: { requestTimeoutMs: 20 },
      });

      await expect(supervisor.ensure(RECORD)).rejects.toThrow();

      expect(channel.closed).toBe(true);
    });

    it("treats a ready server that dies as a failure and starts it again", async () => {
      const channels: ScriptedChannel[] = [];
      const supervisor = scriptedSupervisor({
        launch: async () => {
          const channel = new ScriptedChannel();
          channels.push(channel);
          return channel;
        },
        backoff: IMMEDIATE,
      });

      await supervisor.ensure(RECORD);
      expect(supervisor.status("blender")?.state).toBe("ready");

      channels[0]?.die(new ExtendError("disconnected", { message: "it crashed" }));
      expect(supervisor.status("blender")?.lastError).toMatch(/it crashed/);

      await settle();

      expect(channels).toHaveLength(2);
      expect(supervisor.status("blender")?.state).toBe("ready");
    });

    it("notifies dependents when a ready server dies and recovers", async () => {
      const channels: ScriptedChannel[] = [];
      const unavailable: string[] = [];
      let ready = 0;
      const supervisor = scriptedSupervisor({
        launch: async () => {
          const channel = new ScriptedChannel();
          channels.push(channel);
          return channel;
        },
        backoff: IMMEDIATE,
        onReady: () => {
          ready += 1;
        },
        onUnavailable: (_record, reason) => unavailable.push(String(reason)),
      });

      await supervisor.ensure(RECORD);
      channels[0]?.die(new ExtendError("disconnected", { message: "it crashed" }));
      await settle();

      expect(unavailable).toHaveLength(1);
      expect(ready).toBe(2);
    });
  });

  describe("stopping", () => {
    it("closes a running server and forgets it", async () => {
      const channel = new ScriptedChannel();
      const supervisor = scriptedSupervisor({ launch: async () => channel });

      const connection = await supervisor.ensure(RECORD);
      supervisor.stop("blender");

      expect(connection.closed).toBe(true);
      expect(channel.closed).toBe(true);
      expect(supervisor.status("blender")).toBeUndefined();
    });

    it("gives a server that had given up a clean start when it is switched on again", async () => {
      let launches = 0;
      const supervisor = scriptedSupervisor({
        launch: async () => {
          launches += 1;
          if (launches === 1) throw new ExtendError("internal", { message: "broken" });
          return new ScriptedChannel();
        },
        backoff: { random: () => 0, maxAttempts: 0 },
      });

      await expect(supervisor.ensure(RECORD)).rejects.toThrow();
      expect(supervisor.status("blender")?.state).toBe("given-up");
      expect(supervisor.status("blender")?.attempts).toBe(1);

      supervisor.stop("blender");
      const connection = await supervisor.ensure(RECORD);

      expect(connection.closed).toBe(false);
      expect(supervisor.status("blender")?.state).toBe("ready");
    });

    it("cancels a scheduled retry", async () => {
      let launches = 0;
      const supervisor = scriptedSupervisor({
        launch: async () => {
          launches += 1;
          throw new ExtendError("internal", { message: "broken" });
        },
        backoff: { random: () => 0, maxAttempts: 5 },
      });

      await expect(supervisor.ensure(RECORD)).rejects.toThrow();
      supervisor.stop("blender");
      await settle();

      expect(launches).toBe(1);
    });

    it("ends a process that finishes starting after it was switched off", async () => {
      // The process was already spawned and cannot be un-spawned. Whoever
      // created it has to end it, and nothing else has a handle to it.
      const channel = new ScriptedChannel();
      let release: (() => void) | undefined;
      const supervisor = scriptedSupervisor({
        launch: async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return channel;
        },
      });

      const starting = supervisor.ensure(RECORD);
      await settle(1);
      supervisor.stop("blender");
      release?.();

      await expect(starting).rejects.toThrow(/switched off while it was starting/);
      expect(channel.closed).toBe(true);
      expect(supervisor.status("blender")).toBeUndefined();
    });

    it("stops everything at once", async () => {
      const channels: ScriptedChannel[] = [];
      const supervisor = scriptedSupervisor({
        launch: async () => {
          const channel = new ScriptedChannel();
          channels.push(channel);
          return channel;
        },
      });

      await supervisor.ensure(RECORD);
      await supervisor.ensure({ ...RECORD, id: "other", title: "Other" });
      expect(supervisor.statuses()).toHaveLength(2);

      supervisor.stopAll();

      expect(channels.every((channel) => channel.closed)).toBe(true);
      expect(supervisor.statuses()).toEqual([]);
    });

    it("does nothing for a server it never started", () => {
      const supervisor = scriptedSupervisor({
        launch: async () => new ScriptedChannel(),
      });

      expect(() => supervisor.stop("blender")).not.toThrow();
    });
  });
});
