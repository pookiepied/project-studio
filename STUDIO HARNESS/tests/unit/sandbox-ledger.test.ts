import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  forgetProfile,
  readLedger,
  recordProfile,
  recordTraversed,
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
 * The corridor tests are Task 50's. Containment also grants traverse entries on
 * the workspace's ancestor directories, and the only place that used to remember
 * which ancestors was the memory of the process that granted them — so a release
 * in a fresh process revoked nothing and the entries accumulated until the
 * user's directory permission list was physically full. The corridor field is
 * the durable copy, and its central rule is the negative one: a missing field
 * means *unknown*, never *nothing*, because treating unknown as nothing is
 * precisely the bug.
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

describe("the corridor a release will owe back", () => {
  it("records the ancestors granted for a workspace", () => {
    recordProfile("studio-abc", "C:\\projects\\alpha");
    recordTraversed("C:\\projects\\alpha", ["C:\\", "C:\\projects"]);

    expect(readLedger()[0]?.traversed).toEqual(["C:\\", "C:\\projects"]);
  });

  it("merges later grants instead of replacing them, first seen first", () => {
    // One workspace may be contained many times with different roots, and every
    // ancestor ever granted is owed back — a replace would let the second
    // contain sign the first one's corridor away.
    recordProfile("studio-abc", "C:\\projects\\alpha");
    recordTraversed("C:\\projects\\alpha", ["C:\\projects"]);
    recordTraversed("C:\\projects\\alpha", ["C:\\", "C:\\projects"]);

    expect(readLedger()[0]?.traversed).toEqual(["C:\\projects", "C:\\"]);
  });

  it("re-recording the profile leaves the corridor alone", () => {
    // `recordProfile` runs on every launch; `recordTraversed` on every grant.
    // The pair must compose, or the corridor recorded yesterday is gone after
    // today's launch.
    recordProfile("studio-abc", "C:\\projects\\alpha");
    recordTraversed("C:\\projects\\alpha", ["C:\\projects"]);
    recordProfile("studio-abc", "C:\\projects\\alpha");

    expect(readLedger()[0]?.traversed).toEqual(["C:\\projects"]);
  });

  it("records a measured-empty corridor as empty, not unknown", () => {
    // Every ancestor already covered by the machine-wide entry is a real
    // answer — it says this release owes nothing and that the measurement
    // happened. An absent field is the one that says nothing was ever written.
    recordProfile("studio-abc", "C:\\projects\\alpha");
    recordTraversed("C:\\projects\\alpha", []);

    const traversed = readLedger()[0]?.traversed;
    expect(traversed).toEqual([]);
  });

  it("rewrites nothing once the corridor is already recorded", () => {
    // `recordTraversed` runs on every contained command. A ledger rewrite per
    // command is waste, and worse, it would make the file's mtime lie about
    // when the corridor last grew.
    recordProfile("studio-abc", "C:\\projects\\alpha");
    recordTraversed("C:\\projects\\alpha", ["C:\\projects"]);
    const path = join(home, "sandbox", "windows-profiles.json");
    const afterGrant = readFileSync(path, "utf8");

    recordTraversed("C:\\projects\\alpha", ["C:\\projects"]);

    expect(readFileSync(path, "utf8")).toBe(afterGrant);
  });

  it("does nothing for a workspace that was never recorded", () => {
    // There is no row to attach the corridor to, and inventing one would
    // fabricate a name and a date for a profile this process never minted. The
    // corridor for such a workspace is recovered by release's measured sweep,
    // not by the record.
    expect(() => recordTraversed("C:\\projects\\never-contained", ["C:\\"])).not.toThrow();
    expect(readLedger()).toEqual([]);
  });

  it("reads an entry with no corridor as unknown, not as nothing", () => {
    // The pin that matters. An entry written before the corridor existed has no
    // field; a release that read that as an empty corridor would repeat the
    // leak. `undefined` is the type's way of saying "this entry cannot say",
    // and everything downstream branches on it.
    mkdirSync(join(home, "sandbox"), { recursive: true });
    writeFileSync(
      join(home, "sandbox", "windows-profiles.json"),
      JSON.stringify([{ name: "studio-abc", workspaceRoot: "C:\\projects\\alpha", createdAt: 1 }]),
      "utf8",
    );

    const entry = readLedger()[0];
    expect(entry?.name).toBe("studio-abc");
    expect(entry?.traversed).toBeUndefined();
  });

  it("keeps an entry whose corridor field is malformed, as an unknown corridor", () => {
    // Hand-edited files exist, and the name and workspace in this row are still
    // good. Dropping the whole row would hide a real profile from the listing;
    // keeping the bad field would let a nonsense corridor reach a release.
    // Dropping the field alone is the honest middle: the corridor becomes
    // unknown, which release answers by measurement.
    mkdirSync(join(home, "sandbox"), { recursive: true });
    writeFileSync(
      join(home, "sandbox", "windows-profiles.json"),
      JSON.stringify([
        { name: "studio-abc", workspaceRoot: "C:\\projects\\alpha", createdAt: 1, traversed: "C:\\" },
        { name: "studio-def", workspaceRoot: "C:\\projects\\beta", createdAt: 2, traversed: 3 },
      ]),
      "utf8",
    );

    expect(readLedger().map((entry) => entry.name)).toEqual(["studio-abc", "studio-def"]);
    expect(readLedger().every((entry) => entry.traversed === undefined)).toBe(true);
  });
});
