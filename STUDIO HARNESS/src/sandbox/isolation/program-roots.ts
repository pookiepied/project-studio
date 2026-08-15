import { existsSync } from "node:fs";
import { dirname, isAbsolute, sep } from "node:path";

/**
 * The directories a contained program must be able to *read* in order to run.
 *
 * ## The gap this closes, and how it was found
 *
 * Containment applies at process creation, and the launcher opens the
 * executable's image with its **own** rights — so `node.exe` runs even though
 * the contained child cannot read `C:\Program Files\nodejs`. That is a good
 * property and it is also a trap, because it makes containment look complete
 * one measurement too early.
 *
 * `node server.js` reads `server.js` from *inside* the container. An MCP server
 * is installed under the user's npm root, not in their project, so the first
 * contained launch of every real MCP server exited 1 with nothing to say. The
 * whole test suite caught it at once, which is the only reason it is a finding
 * rather than a bug report from a user.
 *
 * ## What gets granted, and what deliberately does not
 *
 * **Read only, never write.** These are program files. A server that rewrites
 * its own installation is not a use case worth supporting, and making the grant
 * read-only costs nothing.
 *
 * **The nearest `node_modules` ancestor, not just the script's folder.** Node
 * resolves dependencies by walking up, and package managers hoist them — so a
 * grant on `…/node_modules/some-server/` leaves the server unable to load a
 * dependency sitting one level up in `…/node_modules/`. Granting the tree that
 * contains both is the smallest grant that actually works.
 *
 * **Not the executable's own directory.** It is not needed — the image is
 * already open — and asking for it would mean writing an access-control entry
 * into `C:\Program Files`, which needs elevation this feature must never want.
 * The limit that follows is real and is stated in ADR 0041: a program that
 * reads its own *data* files from a protected directory, rather than only
 * linking system libraries, cannot be contained this way. Python's standard
 * library is the case to expect.
 */

/** Where a file's program tree begins, for grant purposes. */
function rootFor(path: string): string {
  const directory = dirname(path);
  const parts = directory.split(sep);
  // The **last** `node_modules` in the path, so a nested tree grants the
  // innermost one that still contains the package's siblings.
  const index = parts.lastIndexOf("node_modules");
  if (index === -1) return directory;
  return parts.slice(0, index + 1).join(sep);
}

/**
 * Derived from the argument vector rather than declared.
 *
 * A declared field would be more precise and is what a server record should
 * eventually carry. Deriving it is what makes containment work for every server
 * already installed, today, with no migration and nothing for a user to fill
 * in — and a wrong derivation fails loudly at launch rather than quietly at
 * runtime.
 */
export function programRoots(args: readonly string[]): readonly string[] {
  const roots = new Set<string>();
  for (const argument of args) {
    // A relative path is not resolved here: it would resolve against *our*
    // working directory, which is not where the child runs.
    if (!isAbsolute(argument)) continue;
    if (!existsSync(argument)) continue;
    roots.add(rootFor(argument));
  }
  return [...roots];
}
