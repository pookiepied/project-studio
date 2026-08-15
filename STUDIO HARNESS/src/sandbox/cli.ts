import { resolve } from "node:path";

import { LocalSandbox } from "./local-sandbox.js";
import { createSandboxPolicy } from "./policy.js";

/**
 * `pnpm sandbox:release <project-directory>`
 *
 * Removes what containment put on the user's machine for one workspace: on
 * Windows, the permission entry on the project directory and the AppContainer
 * profile registered with the OS.
 *
 * ## Why this exists as a command
 *
 * Because the alternative was a method nobody calls. The runtime creates a
 * sandbox per project and has no shutdown hook to hang cleanup on, and adding
 * `release()` with no route to it would be a surface with no delivery path —
 * the exact shape of a defect already open in this project's register. A
 * command is small, it is honest about being manual, and it is reachable by the
 * one person who might actually want their ACL back.
 *
 * It is deliberately not automatic on exit. A profile deleted while another
 * Studio window is working in the same project would strip that window's
 * container mid-call, and "cleaned up correctly" is not worth that.
 */
async function main(): Promise<void> {
  const target = process.argv[2];
  if (target === undefined || target.trim() === "") {
    process.stderr.write("Usage: pnpm sandbox:release <project-directory>\n");
    process.exitCode = 2;
    return;
  }

  const workspaceRoot = resolve(target);
  const sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot }));

  if (sandbox.isolationSupport.backend === undefined) {
    process.stdout.write(
      "Nothing to release: this machine has no sandbox backend, so nothing was granted.\n",
    );
    return;
  }

  await sandbox.releaseIsolation();
  process.stdout.write(`Released the sandbox for ${workspaceRoot}.\n`);
}

await main();
