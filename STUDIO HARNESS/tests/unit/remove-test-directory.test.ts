import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeTestDirectory } from "../helpers/remove-test-directory.js";

describe.skipIf(process.platform !== "win32")("Windows test-directory cleanup", () => {
  it("waits for a temporary working-directory lock to be released", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studio-cleanup-lock-"));
    const child = spawn(process.execPath, ["-e", "process.stdin.resume(); process.stdin.once('data', () => process.exit(0)); process.stdout.write('ready');"],
      { cwd: directory, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const closed = once(child, "close");
    try {
      if (!child.stdout) throw new Error("The cleanup fixture has no readiness pipe.");
      await once(child.stdout, "data");
      // Verify the precondition: the same directory cannot be removed yet.
      await expect(rm(directory, { recursive: true, force: true })).rejects.toHaveProperty("code", "EBUSY");
      const release = setTimeout(() => child.stdin?.end("release"), 250);
      try { await removeTestDirectory(directory); } finally { clearTimeout(release); }
      await expect(access(directory)).rejects.toHaveProperty("code", "ENOENT");
    } finally {
      if (child.exitCode === null) child.kill();
      await closed;
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
});
