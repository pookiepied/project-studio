import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GLOBAL_SCOPE, type ExtensionSelectionStore } from "../selection.js";
import type { McpServerInput, McpServerRegistry } from "./registry.js";

/**
 * The capabilities Studio ships as MCP servers of its own.
 *
 * There is one so far — the browser — and the shape exists because a second is
 * a matter of time, and because the alternative is a special case for the
 * browser threaded through the registry, the settings screen and the
 * reconciler.
 *
 * **They are rows like any other**, and that is the point of doing it this way.
 * A built-in server appears in settings, can be switched off per project or per
 * conversation, is supervised and restarted like anything else, and shows up in
 * the inventory in the same sentence shape. What marks it out is one column:
 * `provenance: "system"`, which decides that Studio wrote it — and nothing
 * else. It does not decide when the schemas load (ADR 0049 §5: that follows
 * size, and the browser is discovered like any large server) and it does not
 * make the server trusted at dispatch, where the kernel still approves every
 * call.
 */

/** The browser's stable id. Referred to by name in the UI and in tests. */
export const BROWSER_SERVER_ID = "studio-browser";

/**
 * Where the built bundle is, from wherever this code is running.
 *
 * The harness runs as `dist/server.mjs` in production and from `src/` under
 * vitest, so the answer is looked for in both places rather than assumed. A
 * bundle that is genuinely absent is not an error here: the registration is
 * skipped, the server never appears, and nothing else in the harness notices —
 * which is the right behaviour for a developer who has only built half of it.
 */
export function browserServerPath(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Bundled: this file is inside dist/, and so is the browser entry.
    join(here, "browser.mjs"),
    // From source, under vitest: src/extend/mcp/ → the sibling dist.
    resolve(here, "..", "..", "..", "dist", "browser.mjs"),
    resolve(here, "..", "..", "dist", "browser.mjs"),
  ];
  return candidates.find((path) => existsSync(path));
}

/**
 * What the browser server's row says.
 *
 * The description is the sentence a model reads before it has any of the
 * twenty-four schemas, so it is the field that decides whether the capability
 * is ever reached for. It says what the browser is *for*, in the words someone
 * would use to ask for it, rather than what it is made of.
 *
 * `needsNetwork` is true and is not what governs the boundary here: a system
 * server is not contained (see the launcher), because containment answers
 * "whose program is this" and this one is ours.
 */
function browserRecord(entry: string): McpServerInput {
  return {
    id: BROWSER_SERVER_ID,
    title: "Browser",
    description:
      "Opens web pages in a real browser and reads them: visit a site or a local dev " +
      "server, read the text, click and type, check the console and network, and see how " +
      "a page looks at any screen size.",
    provenance: "system",
    transport: "stdio",
    // The program that runs Node is the one running this process. Never `npx`,
    // never a `.cmd` shim: `assertValidCommand` refuses those on Windows for
    // CVE-2024-27980, and a design that needs the refusal waived is the wrong
    // design (ADR 0049 §3).
    command: process.execPath,
    args: [entry],
    env: {},
    auth: "none",
    needsNetwork: true,
  };
}

/**
 * Puts the built-in servers in the registry, and switches them on by default.
 *
 * Called once at start. Both halves are idempotent, which they have to be: the
 * harness restarts often, and a second call must leave the row and the person's
 * own decision exactly as they were.
 *
 * **The default is on, and only a default.** A capability Studio ships should
 * work without anyone visiting a settings screen first — that is what makes it
 * feel native rather than like an optional extra someone forgot to mention. But
 * a *default* is what is written, at the global scope, and only when nothing is
 * recorded there yet. Someone who switched the browser off switched it off, and
 * a restart that turned it back on would be Studio overruling a person about
 * their own machine (ADR 0036).
 */
export function registerBuiltInServers(
  registry: McpServerRegistry,
  selection: ExtensionSelectionStore,
): void {
  const entry = browserServerPath();
  if (entry === undefined) return;

  const record = browserRecord(entry);
  const existing = registry.get(BROWSER_SERVER_ID);

  // Written every start, so that a moved installation or a rebuilt bundle
  // updates the path rather than leaving a row pointing at a file that is not
  // there. A row whose reach did not change is written back identically, which
  // the reconciler compares and correctly does nothing about.
  if (existing === undefined || existing.command !== record.command ||
      existing.args[0] !== record.args?.[0] ||
      existing.description !== record.description ||
      existing.provenance !== "system") {
    registry.save(record);
  }

  const key = { kind: "mcp", extensionId: BROWSER_SERVER_ID, scope: GLOBAL_SCOPE } as const;
  if (selection.decisionAt(key) === undefined) selection.set(key, true);
}
