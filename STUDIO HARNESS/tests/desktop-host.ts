import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the desktop Host's Rust sources are, found rather than assumed.
 *
 * Two test files read that tree to check things stated twice — the environment
 * inherit-list and the two bootstrap variable names — because neither language
 * can import the other and the copies drift silently.
 *
 * Both used to hardcode `STUDIO/`, and on 2026-08-16 the folder was renamed to
 * `STUDIO (ON HOLD UI)` while a new UI took the old name. Six tests failed with
 * `ENOENT`, which was the good outcome; the bad one was available and worth
 * designing against. Repointing them at the new name would have made them green
 * again while they guarded a shell that is on hold, and left them green — and
 * wrong — on the day the new `STUDIO/src-tauri` grows a harness module of its
 * own. A test that silently checks the wrong file is worse than one that fails.
 *
 * So the directory is searched for, and **finding two is an error, not a
 * choice**. If both shells carry a supervisor, which one the Harness must agree
 * with is a real question with a real answer, and it belongs to whoever is
 * holding both — not to whichever name sorts first.
 */

/** Sibling directories of the harness, any of which may hold the desktop Host. */
function workspaceRoot(): string {
  return join(import.meta.dirname, "..", "..");
}

/**
 * Every sibling that has a `src-tauri/src/harness/` directory.
 *
 * The `harness/` module is the marker rather than `src-tauri/`, because a bare
 * Tauri scaffold has the latter and knows nothing about starting a Harness —
 * which is exactly what the new `STUDIO/` was when this was written.
 */
function candidates(): string[] {
  const root = workspaceRoot();
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name, "src-tauri", "src", "harness");
    if (existsSync(path)) found.push(path);
  }
  return found.sort();
}

/**
 * The one desktop Host source directory, or a refusal that says what to do.
 *
 * Throws rather than returning `undefined` so a caller cannot accidentally skip
 * the parity check: these tests exist because a silent gap between two copies of
 * one list is the whole hazard, and a silently skipped test is that gap wearing
 * a green tick.
 */
export function desktopHostHarnessDirectory(): string {
  const found = candidates();

  if (found.length === 1) return found[0]!;

  if (found.length === 0) {
    throw new Error(
      "No desktop Host was found: no sibling of STUDIO HARNESS has " +
        "src-tauri/src/harness/. This test keeps a list that is written in both " +
        "TypeScript and Rust in agreement, so it cannot pass without the Rust " +
        "half. If the Host moved out of this workspace, this resolver is what " +
        "needs updating — not the tests.",
    );
  }

  throw new Error(
    `More than one desktop Host was found:\n  ${found.join("\n  ")}\n` +
      "Which one the Harness must agree with is a decision, and guessing it " +
      "would leave this test green while it checked the wrong file. Name the " +
      "one that ships in this resolver.",
  );
}

/** A file inside that directory, e.g. `environment.rs`. */
export function desktopHostSource(name: string): string {
  return join(desktopHostHarnessDirectory(), name);
}
