import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  forgetProfile,
  readLedger,
  recordProfile,
} from "../../src/sandbox/isolation/windows/ledger.js";

/**
 * The record behind `pnpm sandbox:list`, and the rules that keep it honest.
 *
 * #94: containment mints one AppContainer profile per project and nothing
 * removes them automatically, because releasing one while a second Studio window
 * works in the same project would strip that window's container mid-call. The
 * growth is bounded and disclosed — what was missing is that a user could not
 * *see* it, since a profile is named `studio-<sha256[0:32]>` and the hash cannot
 * be inverted back to a project.
 *
 * Runs everywhere despite being a Windows feature: the record is ordinary JSON
 * in the Studio home, and its rules are worth checking on the machine that
 * happens to run the suite.
 */

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "studio-ledger-"));
  process.env["PROJECT_STUDIO_HOME"] = home;
});

afterEach(() => {
  delete process.env["PROJECT_STUDIO_HOME"];
  rmSync(home, { recursive: true, force: true });
});

describe("the record of what containment left behind", () => {
  it("remembers a profile against the workspace it was minted for", () => {
    recordProfile("studio-abc", "C:\\projects\\alpha");

    expect(readLedger()).toEqual([
      { name: "studio-abc", workspaceRoot: "C:\\projects\\alpha", createdAt: expect.any(Number) },
    ]);
  });

  it("keeps the original date when the same workspace is contained again", () => {
    // The age of a profile is the most useful column in a listing — it is how a
    // user recognises one from a project they finished months ago. Refreshing it
    // on every launch would reset exactly the signal they are looking for.
    recordProfile("studio-abc", "C:\\projects\\alpha");
    const first = readLedger()[0]?.createdAt;

    recordProfile("studio-abc", "C:\\projects\\alpha");

    expect(readLedger()).toHaveLength(1);
    expect(readLedger()[0]?.createdAt).toBe(first);
  });

  it("forgets one workspace without disturbing the others", () => {
    recordProfile("studio-abc", "C:\\projects\\alpha");
    recordProfile("studio-def", "C:\\projects\\beta");

    forgetProfile("C:\\projects\\alpha");

    expect(readLedger().map((entry) => entry.workspaceRoot)).toEqual(["C:\\projects\\beta"]);
  });

  it("reads a damaged record as empty rather than refusing to start", () => {
    // This is a convenience, and a convenience that throws is worse than one
    // that is briefly incomplete. Containment itself must never depend on it —
    // a user whose file got truncated should still be able to run a program.
    mkdirSync(join(home, "sandbox"), { recursive: true });
    writeFileSync(join(home, "sandbox", "windows-profiles.json"), "{ not json", "utf8");

    expect(readLedger()).toEqual([]);
  });

  it("drops entries that are not shaped like a record", () => {
    // Hand-edited files exist. A half-valid file should lose the half that is
    // wrong rather than every entry in it.
    mkdirSync(join(home, "sandbox"), { recursive: true });
    writeFileSync(
      join(home, "sandbox", "windows-profiles.json"),
      JSON.stringify([
        { name: "studio-abc", workspaceRoot: "C:\\projects\\alpha", createdAt: 1 },
        { name: "studio-def" },
        "not an object",
      ]),
      "utf8",
    );

    expect(readLedger().map((entry) => entry.name)).toEqual(["studio-abc"]);
  });

  it("never throws when the Studio home cannot be written", () => {
    // A machine with a read-only home should still contain programs. Losing the
    // listing is the right trade; losing the sandbox is not.
    process.env["PROJECT_STUDIO_HOME"] = join(home, "file-not-a-directory");
    writeFileSync(join(home, "file-not-a-directory"), "", "utf8");

    expect(() => recordProfile("studio-abc", "C:\\projects\\alpha")).not.toThrow();
    expect(() => forgetProfile("C:\\projects\\alpha")).not.toThrow();
  });
});
