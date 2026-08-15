import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HARNESS_INHERITED_VARIABLES } from "../../src/process/environment.js";

/**
 * The Harness inherit-list exists twice, and the copies must agree.
 *
 * It is stated in TypeScript, where the Harness reads its environment, and in
 * Rust, where the desktop Host builds it. Neither language can import the
 * other, so the duplication is structural rather than lazy — the same situation
 * as the git network subcommands (#78), and it fails the same way: each copy is
 * internally consistent, so drift produces no error anywhere.
 *
 * What drift costs here is specific and asymmetric. A variable added on the
 * TypeScript side alone is a feature that silently does not work in the
 * packaged app and works in development, which is the hardest kind of bug to
 * see. A variable added on the Rust side alone widens what the Harness process
 * receives without anything in the Harness's own documentation saying so —
 * which is how #74 happened in the first place.
 *
 * This reads the Rust source rather than running cargo, deliberately: the check
 * has to hold on a machine with no Rust toolchain, which is every machine
 * running this suite today. It is a weaker check than compiling — it proves the
 * declaration matches, not that the code uses it — so `environment.rs` carries
 * its own `#[cfg(test)]` module for the behavioural half.
 */

const RUST_SOURCE = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "STUDIO",
  "src-tauri",
  "src",
  "harness",
  "environment.rs",
);

/**
 * Pulls the names out of the Rust `const`.
 *
 * Anchored on the declaration rather than scanning the file for quoted strings,
 * because the doc comment above it names several variables that are
 * deliberately *not* on the list — matching those would invert the test.
 */
function rustInheritedVariables(): string[] {
  const source = readFileSync(RUST_SOURCE, "utf8");
  const declaration = /pub const HARNESS_INHERITED_VARIABLES: &\[&str\] = &\[([^\]]*)\]/.exec(
    source,
  );
  if (declaration === null) {
    throw new Error(
      "HARNESS_INHERITED_VARIABLES was not found in environment.rs. If it was " +
        "renamed or restructured, this test is now checking nothing — fix the " +
        "pattern rather than deleting the test.",
    );
  }
  return [...declaration[1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

describe("the Harness environment allowlist in TypeScript and Rust", () => {
  it("finds a non-empty declaration in the Rust source", () => {
    // Guards the test itself. Every assertion below compares against this list,
    // so an empty parse would make the file pass while checking nothing.
    expect(rustInheritedVariables().length).toBeGreaterThan(0);
  });

  it("names exactly the same variables on both sides", () => {
    expect(rustInheritedVariables()).toEqual([...HARNESS_INHERITED_VARIABLES]);
  });

  it("admits nothing that carries a secret or executes code", () => {
    // Stated as a property rather than a list comparison, so it still holds if
    // both sides are edited together. `NODE_OPTIONS` is here because it is not
    // a secret at all — it is `--require`, which runs arbitrary code inside the
    // Harness before any of our code does.
    for (const forbidden of [
      "PROJECT_STUDIO_ADMISSION_CREDENTIAL",
      "NODE_OPTIONS",
      "AWS_SECRET_ACCESS_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GITHUB_TOKEN",
    ]) {
      expect(HARNESS_INHERITED_VARIABLES).not.toContain(forbidden);
      expect(rustInheritedVariables()).not.toContain(forbidden);
    }
  });

  it("carries what the Harness measurably reads", () => {
    // The other direction. An allowlist that is too narrow fails at runtime in
    // the packaged app only, so the entries with a named reader in `src/` are
    // asserted rather than left to be rediscovered by a user.
    for (const required of ["PATH", "HOME", "USERPROFILE"]) {
      expect(rustInheritedVariables()).toContain(required);
    }
  });
});
