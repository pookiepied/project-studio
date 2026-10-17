import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { candidates, CHANNELS, engineReport, knownLocations, noBrowserMessage } from "../../src/browser/resolve.js";
import { definitions, TOOLS, toolByName } from "../../src/browser/tools.js";
import { createStudioUuid } from "../../src/contracts/uuid.js";

/**
 * The browser capability, tested at the two seams that can break silently.
 *
 * **The protocol**, driven as a real process over real stdio. Every other test
 * in this file could pass while the thing Studio actually spawns answers
 * nothing, because what the harness talks to is `dist/browser.mjs` and not
 * these modules. So the wire is exercised by spawning it.
 *
 * **The promise that nothing starts until something asks** (ADR 0049 §4). It
 * is the whole reason the capability is affordable, it is invisible from the
 * outside, and the way it breaks is that some future convenience touches a
 * page during `tools/list`. A test that connects, discovers, lists and then
 * proves no Chromium exists is the only thing that would notice.
 */

const BUNDLE = fileURLToPath(new URL("../../dist/browser.mjs", import.meta.url));
const MANIFEST = fileURLToPath(new URL("../../package.json", import.meta.url));
const SESSION_SOURCE = fileURLToPath(new URL("../../src/browser/session.ts", import.meta.url));

describe("the tool surface", () => {
  it("is the set that was designed, named as Studio's own", () => {
    // The names are a contract: they appear in the inventory prose, in the
    // approval a person reads, and in a grant that survives restarts. A rename
    // is a re-approval for everyone who has already said yes.
    for (const tool of TOOLS) {
      expect(tool.name.startsWith("studio_browser_")).toBe(true);
    }
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
  });

  it("covers the jobs the capability exists for", () => {
    // Not a count - a count only ever gets updated to match. These are the
    // things "open this and tell me what it says", "build a page and check it
    // renders" and "why is this blank" actually need.
    const names = TOOLS.map((tool) => tool.name);
    for (const needed of [
      "studio_browser_open",
      "studio_browser_read_text",
      "studio_browser_read_page",
      "studio_browser_click",
      "studio_browser_type",
      "studio_browser_screenshot",
      "studio_browser_wait_for",
      "studio_browser_console",
      "studio_browser_network",
      "studio_browser_viewport",
      "studio_browser_quit",
    ]) {
      expect(names).toContain(needed);
    }
  });

  it("describes every tool and every input, because the schema is the manual", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema["type"]).toBe("object");
      // A model that may not invent a field is a model that cannot quietly
      // mean something we never read.
      expect(tool.inputSchema["additionalProperties"]).toBe(false);
    }
  });

  it("answers tools/list with definitions and nothing else", () => {
    for (const definition of definitions()) {
      expect(Object.keys(definition).sort()).toEqual([
        "description",
        "inputSchema",
        "name",
      ]);
    }
  });

  it("finds a tool by name, and does not invent one", () => {
    expect(toolByName("studio_browser_open")?.name).toBe("studio_browser_open");
    expect(toolByName("studio_browser_nope")).toBeUndefined();
  });
});

describe("finding a browser, and refusing well", () => {
  it("names what it looked for, where, and what to do", () => {
    // ADR 0047's shape, and the deliverable of ADR 0049's step 2: a refusal
    // that names the fix is actionable, and a bare failure is a bug report.
    const message = noBrowserMessage("spawn ENOENT");
    expect(message).toContain("Microsoft Edge and Google Chrome");
    expect(message).toMatch(/not something to retry/);
    expect(message).toMatch(/Firefox and Safari will not do/);
    expect(message).toContain("never downloads");
    expect(message).toMatch(/To fix it: Install /);
    expect(message).toContain("spawn ENOENT");
  });

  it("looks in places that are real paths on this platform", () => {
    const locations = knownLocations();
    expect(locations.length).toBeGreaterThan(0);
    for (const location of locations) expect(location).toMatch(/edge|chrom|brave/i);
  });

  it("can never download, because nothing but a candidate reaches the launch", () => {
    // `resolve.ts` says this has to be pinned by a test, and this is it. The
    // library's own default is a downloaded browser; the two things that
    // would bring it back are the full `playwright` package (whose install
    // step fetches browsers) and a launch option that did not come from the
    // candidate list. Read from the sources rather than from a launch,
    // because a launch is what a unit test must not do.
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.["playwright-core"]).toBeDefined();
    expect(manifest.dependencies?.["playwright"]).toBeUndefined();
    expect(manifest.devDependencies?.["playwright"]).toBeUndefined();

    // One launch call, and its options are the candidate's spread plus
    // headless. An `executablePath:` written anywhere in session.ts would be
    // a path from somewhere other than `resolve.ts`, which is the one place
    // allowed to name one.
    const session = readFileSync(SESSION_SOURCE, "utf8");
    expect(session.match(/chromium\.launch\(/g)).toHaveLength(1);
    expect(session).toMatch(/chromium\.launch\(\{\s*\.\.\.candidate\.launch,\s*headless: true\s*\}\)/);
    expect(session).not.toMatch(/executablePath\s*:/);
  });

  it("names a path only when it is on the known list and exists", () => {
    // The found-path tier is the amended rule's whole exposure: a path is an
    // instruction, so every one handed to the launch must be a real file at
    // a place this file wrote down. A channel needs neither.
    const known = new Set(knownLocations());
    for (const candidate of candidates()) {
      if ("executablePath" in candidate.launch) {
        expect(known.has(candidate.launch.executablePath)).toBe(true);
        expect(existsSync(candidate.launch.executablePath)).toBe(true);
        expect(candidate.seenAt).toBe(candidate.launch.executablePath);
      } else {
        expect(CHANNELS).toContain(candidate.launch.channel);
      }
    }
    // Every channel is always tried, seen or not.
    const channels = candidates().flatMap((candidate) =>
      "channel" in candidate.launch ? [candidate.launch.channel] : [],
    );
    expect([...channels].sort()).toEqual([...CHANNELS].sort());
  });

  it("tells a settings row which browser it would drive, or what to install", () => {
    const report = engineReport();
    if (report.seen === undefined) {
      expect(report.summary).toMatch(/No browser found/);
      expect(report.summary).toMatch(/never downloads/);
      expect(report.alsoSeen).toEqual([]);
    } else {
      expect(existsSync(report.seen.at)).toBe(true);
      expect(report.summary).toContain(`Drives ${report.seen.name}`);
      for (const name of report.alsoSeen) expect(report.summary).toContain(name);
    }
  });
});

/**
 * The wire, driven as the harness drives it.
 *
 * Skipped when the bundle has not been built, because a developer running
 * vitest without `vite build` should be told nothing rather than told a lie.
 * The suite's own `pnpm test` builds first, so in every run that matters this
 * is not skipped.
 */
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

  it("speaks the modern handshake Studio's own client prefers", async () => {
    const result = (await call("server/discover", { protocolVersion: "2026-07-28" }))[
      "result"
    ] as Record<string, unknown>;
    expect(result["protocolVersion"]).toBe("2026-07-28");
    expect((result["serverInfo"] as Record<string, unknown>)["name"]).toBe("studio-browser");
    expect(result["capabilities"]).toHaveProperty("tools");
  });

  it("refuses a version it does not speak with the code that stops a fallback", async () => {
    // -32022 is what keeps the client from trying a legacy `initialize` after
    // a modern server has already shown it knows the modern vocabulary.
    const error = (await call("server/discover", { protocolVersion: "1999-01-01" }))[
      "error"
    ] as Record<string, unknown>;
    expect(error["code"]).toBe(-32022);
  });

  it("lists every tool in one page", async () => {
    const result = (await call("tools/list", {}))["result"] as Record<string, unknown>;
    expect((result["tools"] as unknown[]).length).toBe(TOOLS.length);
    expect(result["nextCursor"]).toBeUndefined();
  });

  it("starts no browser to be connected to, discovered, or listed", async () => {
    // ADR 0049 §4, and the reason the first three states are cheap. This is
    // asked of the server rather than of the process table, because the
    // server is the thing that knows - and because a passing assertion about
    // somebody else's Chromium would be an accident.
    const result = (await call("tools/call", {
      name: "studio_browser_tabs",
      arguments: {},
    }))["result"] as Record<string, unknown>;
    const said = (result["content"] as { text: string }[])[0]?.text ?? "";
    expect(said).toContain("not running");
  });

  it("answers a tool that does not exist without dying", async () => {
    const error = (await call("tools/call", { name: "studio_browser_fly", arguments: {} }))[
      "error"
    ] as Record<string, unknown>;
    expect(error["code"]).toBe(-32602);
    // And is still there afterwards, which is the half that matters.
    expect((await call("tools/list", {}))["result"]).toBeDefined();
  });

  it("keeps live controls private and never adopts another conversation's session", async () => {
    const listed = (await call("tools/list", {}))["result"] as { tools: { name: string }[] };
    expect(listed.tools.some((tool) => tool.name.includes("interact") || tool.name.includes("claim"))).toBe(false);
    const response = await call("studio/browser", {
      input: { action: "view", viewerId: createStudioUuid() },
      _meta: { "studio/conversation": createStudioUuid() },
    });
    expect(response["error"]).toHaveProperty("message", "This browser session has ended. Ask Studio to open a page again.");
  });

  it("answers a bad call as a tool result, not as a dead transport", async () => {
    // A click that missed is something a model reads and recovers from. A
    // protocol error would end the connection and take every later call with
    // it, which is a very expensive way to say "give me a selector".
    const result = (await call("tools/call", {
      name: "studio_browser_click",
      arguments: {},
    }))["result"] as Record<string, unknown>;
    expect(result["isError"]).toBe(true);
    expect((result["content"] as { text: string }[])[0]?.text).toContain("selector");
  });
});
