import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import { FlueHarnessClient } from "../../src/application/harness-client.js";

/**
 * A skill, switched on, through the real agent.
 *
 * What the harness does for a skill is small - find the folder, decide it is
 * on, mount it in the render - and everything after that is Flue's: the
 * catalog line in the composed system prompt, the `activate_skill` tool, the
 * body returned as its result. None of that is observable from a unit test of
 * the registry, so this drives the built server over HTTP with the scripted
 * test model, which reads exactly those two surfaces and reports what it saw.
 *
 * The harness boot is the short copy `stop.test.ts` carries; the longer
 * instrumented one in `mcp-flue.test.ts` is queued for extraction and this
 * suite will move to it then.
 */

const SKILL = `---
name: hello
description: Greets the person. Use when asked to say hello.
---

Say hello, warmly.
`;

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

interface Running {
  readonly baseUrl: string;
  readonly process: ChildProcess;
  readonly token: string;
}

async function startHarness(home: string): Promise<Running> {
  const port = await availablePort();
  const admission = createAdmissionSession({ clientType: "test" });
  const child = spawn(process.execPath, ["dist/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      PROJECT_STUDIO_ADMISSION_CREDENTIAL: admission.credential,
      PROJECT_STUDIO_DB_PATH: join(home, "flue.db"),
      PROJECT_STUDIO_STORE_PATH: join(home, "studio.db"),
      PROJECT_STUDIO_MODEL_SOURCE: "test",
      // The whole Studio home travels with the test, and the skill folder is
      // part of it: `<home>/skills/hello` is where the registry looks.
      PROJECT_STUDIO_HOME: home,
    },
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`Harness exited: ${stderr}`);
    try {
      await fetch(baseUrl);
      return true;
    } catch {
      return false;
    }
  }, 60_000);
  return { baseUrl, process: child, token: admission.credential };
}

async function stopHarness(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected) child.send("shutdown");
  else child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("skills through the Flue agent", () => {
  let harness: Running | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (harness !== undefined) await stopHarness(harness.process);
    if (home !== undefined) await rm(home, { recursive: true, force: true });
    harness = undefined;
    home = undefined;
  });

  it("lists a switched-on skill in the prompt, activates it, and drops it when switched off", async () => {
    home = await mkdtemp(join(tmpdir(), "studio-skills-flue-"));
    await mkdir(join(home, "skills", "hello"), { recursive: true });
    await writeFile(join(home, "skills", "hello", "SKILL.md"), SKILL, "utf8");
    harness = await startHarness(home);
    const headers = {
      authorization: `Bearer ${harness.token}`,
      "content-type": "application/json",
    };

    // Installed: the folder is there, and nothing has decided about it.
    const listed = await fetch(`${harness.baseUrl}/api/skills`, { headers });
    expect(listed.status).toBe(200);
    const listing = (await listed.json()) as {
      skills: { id: string; enabledByDefault: boolean }[];
      problems: unknown[];
    };
    expect(listing.skills.map((skill) => skill.id)).toContain("hello");
    expect(listing.skills.find((skill) => skill.id === "hello")?.enabledByDefault).toBe(false);
    expect(listing.skills.find((skill) => skill.id === "visual-responses")?.enabledByDefault).toBe(true);

    // The hello probe owns the activation surface; a bundled default must
    // not supply that surface while the probed skill is switched off.
    const bundled = await fetch(`${harness.baseUrl}/api/skills/extensions/skill/visual-responses`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ enabled: false }),
    });
    expect(bundled.status).toBe(200);

    const client = new FlueHarnessClient({ baseUrl: harness.baseUrl, token: harness.token });

    // Off by default: no catalog line, no tool.
    const before = await client.send("skills-off", "use the skill");
    expect((await client.wait(before)).text).toBe(
      "No skill can be activated in this conversation. Listed: no.",
    );

    const enabled = await fetch(`${harness.baseUrl}/api/skills/extensions/skill/hello`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(200);

    // On: the line is in the prompt and the body comes back from the tool,
    // in one turn, with no round trip through the person.
    const on = await client.send("skills-on", "use the skill");
    expect((await client.wait(on)).text).toBe("Skill activated: hello. Listed: yes.");

    const disabled = await fetch(`${harness.baseUrl}/api/skills/extensions/skill/hello`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ enabled: false }),
    });
    expect(disabled.status).toBe(200);

    // A new conversation after the switch-off starts without it.
    const after = await client.send("skills-off-again", "use the skill");
    expect((await client.wait(after)).text).toBe(
      "No skill can be activated in this conversation. Listed: no.",
    );
  }, 90_000);
});
