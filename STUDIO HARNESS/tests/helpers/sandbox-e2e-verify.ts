import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openReadOnlyDatabase } from "../../src/storage/database.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { SandboxScopeStore } from "../../src/sandbox/scope-store.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";

/**
 * The conversation, end to end, against this machine's real grants.
 *
 * Reads the machine-wide scope rows the way `createAgentSandbox` reads them —
 * through the production store, not a copy of them — builds the production
 * policy, runs the contained git a conversation's shell tool would run, and
 * releases. It prints what it measured instead of asserting it, because it is
 * a helper for measuring, not a gate; the gates are the integration suites.
 *
 * The working directory has to be ABSOLUTE (`mkdtempSync(join(tmpdir(), ...))`,
 * not a bare prefix): the launcher hands it to `CreateProcessW` as
 * `lpCurrentDirectory`, which answers `error 267` for a relative path. Found
 * here, not in the product — the tools resolve their cwd before it gets this
 * far.
 */

const db = openReadOnlyDatabase();
const scopes = new SandboxScopeStore(db);
const roots = scopes.resolveRoots(undefined);
db.close();

const work = mkdtempSync(join(tmpdir(), "studio-e2e-"));
const policy = createSandboxPolicy({
  workspaceRoot: work,
  readRoots: roots.readRoots,
  // The way the runtime builds it: the conversation's own workspace leads the
  // write set, because the policy replaces its default write set with what
  // arrives here, and the machine-wide rows alone would leave the conversation
  // unable to write its own project.
  writeRoots: [work, ...roots.writeRoots],
});
console.log(
  `policy: ${roots.readRoots.length} read roots, ${roots.writeRoots.length} write roots`,
);

const sandbox = new LocalSandbox(policy);
const git = "C:\\Program Files\\Git\\cmd\\git.exe";
const programRoots = [dirname(git)];

try {
  const started = Date.now();
  const version = await sandbox.run("shell", {
    executable: git,
    args: ["--version"],
    cwd: work,
    programRoots,
    timeoutMs: 180_000,
  });
  console.log(
    `git --version, first contain (${((Date.now() - started) / 1000).toFixed(1)}s): ` +
      `exit ${version.exitCode} | ${`${version.stdout}${version.stderr}`.trim()}`,
  );

  const warmStart = Date.now();
  const status = await sandbox.run("shell", {
    executable: git,
    args: ["init"],
    cwd: work,
    programRoots,
    timeoutMs: 60_000,
  });
  console.log(
    `git init, warm (${((Date.now() - warmStart) / 1000).toFixed(1)}s): ` +
      `exit ${status.exitCode} | ${`${status.stdout}${status.stderr}`.trim()}`,
  );
  const readBack = await sandbox.run("shell", {
    executable: git,
    args: ["status"],
    cwd: work,
    programRoots,
    timeoutMs: 60_000,
  });
  console.log(
    `git status, after init (${((Date.now() - warmStart) / 1000).toFixed(1)}s): ` +
      `exit ${readBack.exitCode} | ${`${readBack.stdout}${readBack.stderr}`.trim()}`,
  );

  const releaseStart = Date.now();
  await sandbox.releaseIsolation();
  console.log(`release (${((Date.now() - releaseStart) / 1000).toFixed(1)}s): ok`);
} finally {
  await sandbox.releaseIsolation().catch(() => {});
  rmSync(work, { recursive: true, force: true });
  console.log(existsSync(work) ? "workspace: leftovers" : "workspace: cleaned");
}
