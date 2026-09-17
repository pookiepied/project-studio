import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

import { ExtendError } from "../extend/errors.js";
import { studioPath } from "../platform/paths.js";

/**
 * Installing a connection that arrived as an npm package name.
 *
 * This runs inside the customization bundle, in the harness's own trust
 * domain: the process the supervisor spawned, uncontained like every
 * system-provenance record, because Studio wrote it. That is the trick that
 * makes the feature feel native instead of a workaround - the model's own
 * shell would need grants for `~/.studio`, a second place to ask, and a
 * second story to explain; this runs under the same authority that
 * downloaded everything else in `tools/`.
 *
 * The record it produces obeys the house's oldest command rule: an
 * executable plus an argument vector, and never a shim. The launcher
 * refuses `.cmd` on Windows, so this points at the harness's own Node - the
 * very one running here - with the package's entry script as the argument.
 */

/** Where one connection's download lives: its own directory, so removal is one rmdir. */
export function connectionDirectory(id: string): string {
  return studioPath("tools", "mcp", id);
}

/**
 * The npm CLI that ships beside the running Node.
 *
 * Both of the layouts this installation can come from keep it at
 * `<node>/node_modules/npm/bin/npm-cli.js` - the JavaScript, not the shim,
 * because the shim is what the launcher refuses. There is no second place:
 * an installation whose Node came without npm answers its add with the two
 * other ways instead, which is a feature boundary, not a failure.
 */
export function bundledNpmCli(executable: string): string | undefined {
  const candidate = join(dirname(executable), "node_modules", "npm", "bin", "npm-cli.js");
  return existsSync(candidate) ? candidate : undefined;
}

/** What installing answers: the executable and its argument vector, ready for the record. */
export interface InstalledEntry {
  readonly command: string;
  readonly args: readonly string[];
}

/** The narrow part of a spawn result this module reads, so tests need no child_process. */
export interface SpawnOutcome {
  readonly status: number | null;
  readonly stderr?: string | undefined;
  readonly error?: Error | undefined;
}

/** How long one `npm install` may take. Cold, without a warm cache, this is generous. */
const INSTALL_TIMEOUT_MS = 90_000;

/**
 * Downloads one package into this connection's own directory, and answers
 * what to launch.
 *
 * The download goes into `<tools>/mcp/<id>`, so a removed connection takes
 * its own bytes with it and two connections can never argue over one
 * `node_modules`. Anything other than exactly one binary entry in the
 * package's `bin` is refused with the package's own layout in the message -
 * a multi-binary package needs a human decision about which of its commands
 * is the server, and guessing is how the wrong process ends up supervised.
 */
export function installPackage(
  npmPackage: string,
  id: string,
  execPath: string,
  run: (command: string, args: readonly string[]) => SpawnOutcome = (command, args) =>
    spawnSync(command, args, { encoding: "utf8", timeout: INSTALL_TIMEOUT_MS }),
): InstalledEntry {
  const npmCli = bundledNpmCli(execPath);
  if (npmCli === undefined) {
    throw new ExtendError("internal", {
      message:
        "This installation carries no npm, so a package cannot be downloaded here. " +
        "Install it by address instead, or point at the program already on this machine.",
    });
  }

  const directory = connectionDirectory(id);
  mkdirSync(directory, { recursive: true });
  const outcome = run(execPath, [
    npmCli,
    "install",
    "--prefix",
    directory,
    "--no-fund",
    "--no-audit",
    "--loglevel=error",
    npmPackage,
  ]);
  if (outcome.error !== undefined || outcome.status !== 0) {
    const output = outcome.error?.message ?? (outcome.stderr ?? "").trim();
    throw new ExtendError("internal", {
      message:
        `Downloading ${npmPackage} failed: ` +
        (output === "" ? "npm answered nothing; it may not be this machine's installer" : output) +
        ". If it keeps failing, add the connection by address, or point at the program already on this machine, instead.",
    });
  }

  return { command: execPath, args: [packageEntry(directory, npmPackage)] };
}

/** The package's one entry point, or the refusal that says what it found. */
function packageEntry(directory: string, npmPackage: string): string {
  const packageDirectory = join(directory, "node_modules", ...npmPackage.split("/"));
  const manifest = readManifest(packageDirectory, npmPackage);

  const bin = manifest["bin"];
  if (typeof bin === "string") return join(packageDirectory, bin);

  if (isBinaryMap(bin)) {
    const entries = Object.entries(bin);
    const single = entries.length === 1 ? entries[0] : undefined;
    if (single !== undefined) return join(packageDirectory, single[1]);
    throw new ExtendError("internal", {
      message:
        `${npmPackage} carries several commands (${entries.map(([name]) => name).join(", ")}). ` +
        "Install it by command instead: the path of whichever of its programs is the MCP server.",
    });
  }

  throw new ExtendError("internal", {
    message: `${npmPackage} has no "bin" in its package.json, so there is no program here to launch.`,
  });
}

/** Whether a package's `bin` is the one-entry-or-many map of commands, all strings. */
function isBinaryMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function readManifest(
  packageDirectory: string,
  npmPackage: string,
): Readonly<Record<string, unknown>> {
  try {
    return JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new ExtendError("internal", {
      message: `${npmPackage} downloaded, but its package.json could not be read, so there is no entry to launch.`,
    });
  }
}
