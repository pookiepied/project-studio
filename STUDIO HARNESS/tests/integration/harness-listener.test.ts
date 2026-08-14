import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { launchHarness, type RunningHarness } from "../../src/host/harness-launcher.js";

const running: RunningHarness[] = [];
const directories: string[] = [];

async function startHarness(home: string): Promise<RunningHarness> {
  const harness = await launchHarness({
    startupTimeoutMs: 60_000,
    environment: {
      PROJECT_STUDIO_HOME: home,
      PROJECT_STUDIO_DB_PATH: join(home, "flue.db"),
      PROJECT_STUDIO_STORE_PATH: join(home, "studio.db"),
      PROJECT_STUDIO_MODEL_SOURCE: "test",
    },
  });
  running.push(harness);
  return harness;
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.stop();
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
});

describe.sequential("Harness listener ownership", () => {
  it("reports the actual loopback address and OS-assigned port", async () => {
    const home = await mkdtemp(join(tmpdir(), "studio-harness-listener-"));
    directories.push(home);
    const harness = await startHarness(home);

    expect(harness.readiness.host).toBe("127.0.0.1");
    expect(harness.readiness.port).toBeGreaterThan(0);
    expect(harness.readiness.pid).toBe(harness.process.pid);
    expect(harness.readiness.sessionId).not.toBe("");
    expect(harness.baseUrl).toBe(
      `http://127.0.0.1:${harness.readiness.port}`,
    );
    expect(harness.stdout()).not.toContain(harness.credential);
    expect(harness.stderr()).not.toContain(harness.credential);

    const unauthenticated = await fetch(harness.baseUrl);
    expect(unauthenticated.status).toBe(401);

    const authenticated = await fetch(harness.baseUrl, {
      headers: { authorization: `Bearer ${harness.credential}` },
    });
    expect(authenticated.status).not.toBe(401);
  }, 90_000);

  it("replaces the endpoint session and rejects the stale credential", async () => {
    const home = await mkdtemp(join(tmpdir(), "studio-harness-restart-"));
    directories.push(home);
    const first = await startHarness(home);
    const oldCredential = first.credential;
    await first.stop();

    const replacement = await startHarness(home);
    expect(replacement.credential).not.toBe(oldCredential);
    expect(replacement.readiness.sessionId).not.toBe(first.readiness.sessionId);

    const stale = await fetch(replacement.baseUrl, {
      headers: { authorization: `Bearer ${oldCredential}` },
    });
    expect(stale.status).toBe(401);

    const current = await fetch(replacement.baseUrl, {
      headers: { authorization: `Bearer ${replacement.credential}` },
    });
    expect(current.status).not.toBe(401);
  }, 120_000);
});
