import { existsSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GLOBAL_SCOPE, type ExtensionSelectionStore } from "../selection.js";
import type { McpServerInput, McpServerRegistry } from "./registry.js";

/**
 * The capabilities Studio ships as MCP servers of its own.
 *
 * There are two — the browser and the computer — and the shape exists because
 * the alternative is a special case for each threaded through the registry,
 * the settings screen and the reconciler.
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

/** The computer-use server's stable id. */
export const COMPUTER_SERVER_ID = "studio-computer";

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
  return bundledEntry("browser.mjs");
}

/** Where the computer server's bundle is, by the same search. */
export function computerServerPath(): string | undefined {
  return bundledEntry("computer.mjs");
}

function bundledEntry(file: string): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Bundled: this file is inside dist/, and so is the entry.
    join(here, file),
    // From source, under vitest: src/extend/mcp/ → the sibling dist.
    resolve(here, "..", "..", "..", "dist", file),
    resolve(here, "..", "..", "dist", file),
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
 * What the computer server's row says.
 *
 * The sentence names the jobs, not the mechanism, like the browser's. On a
 * machine that is not Windows the row still exists - the person can see the
 * capability and what it needs - but it is switched off by default, because
 * a default that fails on first use is a default that lies. `needsNetwork`
 * is false: the desktop is local, and the flag is not what governs the
 * boundary anyway (a system server is not contained).
 */
function computerRecord(entry: string): McpServerInput {
  return {
    id: COMPUTER_SERVER_ID,
    title: "Computer",
    description:
      "Uses this computer's screen, mouse and keyboard: see what is on a display, open and " +
      "arrange windows, read an application's controls and press them, type, and use the " +
      "clipboard. For anything a desktop application does that a web page cannot.",
    provenance: "system",
    transport: "stdio",
    command: process.execPath,
    args: [entry],
    env: {},
    auth: "none",
    needsNetwork: false,
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
  const browser = browserServerPath();
  if (browser !== undefined) install(registry, selection, browserRecord(browser), true);

  const computer = computerServerPath();
  if (computer !== undefined) {
    install(registry, selection, computerRecord(computer), platform() === "win32");
  }
}

function install(
  registry: McpServerRegistry,
  selection: ExtensionSelectionStore,
  record: McpServerInput,
  onByDefault: boolean,
): void {
  const existing = registry.get(record.id);

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

  const key = { kind: "mcp", extensionId: record.id, scope: GLOBAL_SCOPE } as const;
  if (selection.decisionAt(key) === undefined) selection.set(key, onByDefault);
}
