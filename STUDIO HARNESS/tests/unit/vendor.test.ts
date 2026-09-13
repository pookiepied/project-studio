import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VendorError } from "../../src/vendor/errors.js";
import {
  clearBinaryCache,
  platformKey,
  resolveBinary,
  vendorRoot,
} from "../../src/vendor/resolver.js";

const EXECUTABLE_SUFFIX = process.platform === "win32" ? ".exe" : "";

let base: string;
let vendored: string;
let managed: string;
let systemDirectory: string;

/**
 * Creates a file that looks like a real binary to the resolver.
 *
 * Including the permission bit. A fixture that is merely *present* would let
 * the resolver pass a file the OS refuses to run, which is exactly the shape of
 * the bug that shipped: a vendored `rg` committed without `+x`, found on Linux
 * and invisible on Windows.
 */
function placeBinary(directory: string, name: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${name}${EXECUTABLE_SUFFIX}`);
  writeFileSync(path, "");
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "studio-vendor-"));
  vendored = join(base, "vendor");
  managed = join(base, "managed");
  systemDirectory = join(base, "system");
  mkdirSync(systemDirectory, { recursive: true });
  clearBinaryCache();
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  clearBinaryCache();
});

describe("resolution order", () => {
  it("takes ripgrep only from what we shipped", () => {
    // Search results that vary with whatever version a machine happens to have
    // are results that cannot be reproduced, so a system copy is not consulted.
    const expected = placeBinary(join(vendored, platformKey()), "rg");
    placeBinary(systemDirectory, "rg");

    const resolved = resolveBinary("rg", {
      vendorRoot: vendored,
      searchPath: systemDirectory,
    });

    expect(resolved.path).toBe(expected);
    expect(resolved.source).toBe("shipped");
  });

  it("prefers the user's own git over one we downloaded", () => {
    // Theirs is the copy they maintain and update; ours is a fallback for a
    // machine that has none.
    const expected = placeBinary(systemDirectory, "git");
    placeBinary(join(managed, platformKey(), "git", "current"), "git");

    const resolved = resolveBinary("git", {
      vendorRoot: vendored,
      managedRoot: managed,
      searchPath: systemDirectory,
    });

    expect(resolved.path).toBe(expected);
    expect(resolved.source).toBe("system");
  });

  it("falls back to a downloaded git on a machine without one", () => {
    const expected = placeBinary(join(managed, platformKey(), "git", "current"), "git");

    const resolved = resolveBinary("git", {
      vendorRoot: vendored,
      managedRoot: managed,
      searchPath: systemDirectory,
    });

    expect(resolved.path).toBe(expected);
    expect(resolved.source).toBe("managed");
  });

  it("falls back to the system binary when nothing is vendored", () => {
    // This is how git resolves today: nobody ships it, most developers have it.
    const expected = placeBinary(systemDirectory, "git");

    const resolved = resolveBinary("git", {
      vendorRoot: vendored,
      searchPath: systemDirectory,
    });

    expect(resolved.path).toBe(expected);
    expect(resolved.source).toBe("system");
  });

  it("searches PATH entries in order", () => {
    const first = join(base, "first");
    const expected = placeBinary(first, "git");
    placeBinary(systemDirectory, "git");

    const resolved = resolveBinary("git", {
      vendorRoot: vendored,
      searchPath: [first, systemDirectory].join(delimiter),
    });

    expect(resolved.path).toBe(expected);
  });

  it("ignores relative and blank PATH entries", () => {
    const expected = placeBinary(systemDirectory, "git");

    const resolved = resolveBinary("git", {
      vendorRoot: vendored,
      searchPath: ["", "  ", "./relative", systemDirectory].join(delimiter),
    });

    expect(resolved.path).toBe(expected);
  });

  it.runIf(process.platform === "win32")("strips quotes from PATH entries", () => {
    // Windows PATH entries containing spaces are commonly quoted.
    const expected = placeBinary(systemDirectory, "git");

    const resolved = resolveBinary("git", {
      vendorRoot: vendored,
      searchPath: `"${systemDirectory}"`,
    });

    expect(resolved.path).toBe(expected);
  });
});

describe("when a binary is missing", () => {
  it("refuses rather than guessing", () => {
    expect(() =>
      resolveBinary("git", { vendorRoot: vendored, searchPath: systemDirectory }),
    ).toThrow(VendorError);
  });

  it("tells the user how to fix it, per binary", () => {
    // Git the user installs; ripgrep we ship. One generic message would leave
    // the user with nowhere to go.
    const git = (() => {
      try {
        resolveBinary("git", { vendorRoot: vendored, searchPath: systemDirectory });
        return undefined;
      } catch (caught) {
        return caught as VendorError;
      }
    })();

    expect(git?.code).toBe("vendor.not_found");
    expect(git?.message).toMatch(/install git/i);
  });

  it("does not report a missing tool as retryable", () => {
    // Retrying the same lookup produces the same absence; a human has to act.
    try {
      resolveBinary("rg", { vendorRoot: vendored, searchPath: systemDirectory });
      expect.unreachable();
    } catch (caught) {
      expect((caught as VendorError).retryable).toBe(false);
    }
  });
});

describe("only real files are accepted", () => {
  it("does not resolve a directory that shares the binary's name", () => {
    mkdirSync(join(systemDirectory, `git${EXECUTABLE_SUFFIX}`), { recursive: true });

    expect(() =>
      resolveBinary("git", { vendorRoot: vendored, searchPath: systemDirectory }),
    ).toThrow(VendorError);
  });

  it("does not resolve a file the OS would refuse to run", () => {
    // Windows has no executable bit — `X_OK` answers yes for any file that
    // exists — so there is nothing to take away and nothing to assert. Skipped
    // by platform semantics rather than by capability: this is not a feature
    // that might work here, it is a permission model that does not exist here.
    if (process.platform === "win32") return;

    const path = placeBinary(join(vendored, platformKey()), "rg");
    chmodSync(path, 0o644);

    expect(() => resolveBinary("rg", { vendorRoot: vendored })).toThrow(VendorError);
  });

  it("ships a ripgrep that is actually executable", () => {
    // The pin for a bug that only a Linux run could see. `vendor/linux-x64/rg`
    // was committed as mode 100644 because Windows git does not track a
    // permission bit, so it resolved fine and then failed at spawn with EACCES
    // — every search on Linux, in a build whose Windows tests were all green.
    expect(() => resolveBinary("rg")).not.toThrow();
  });
});

describe("vendor layout", () => {
  it("separates builds by platform and architecture", () => {
    expect(platformKey()).toBe(`${process.platform}-${process.arch}`);
  });

  it("locates itself relative to the installation, not the working directory", () => {
    // The harness runs with the user's project as its working directory. A
    // cwd-relative lookup would let any repository ship its own
    // vendor/win32-x64/rg.exe and have us execute it.
    const previous = process.cwd();
    try {
      process.chdir(base);
      expect(vendorRoot()).not.toBe(join(base, "vendor"));
      // Anchored to this file's own location, not to a literal folder name:
      // the checkout has been renamed once already.
      expect(vendorRoot()).toBe(
        resolve(fileURLToPath(new URL("../../vendor", import.meta.url))),
      );
    } finally {
      process.chdir(previous);
    }
  });

  it("ships ripgrep, because a user's machine does not have it", () => {
    const resolved = resolveBinary("rg");

    expect(resolved.source).toBe("shipped");
    expect(resolved.path.replaceAll("\\", "/")).toContain("/vendor/");
  });

  it("honours the configured vendor directory", () => {
    const previous = process.env.PROJECT_STUDIO_VENDOR_DIR;
    process.env.PROJECT_STUDIO_VENDOR_DIR = vendored;
    try {
      expect(vendorRoot()).toBe(vendored);
    } finally {
      if (previous === undefined) delete process.env.PROJECT_STUDIO_VENDOR_DIR;
      else process.env.PROJECT_STUDIO_VENDOR_DIR = previous;
    }
  });
});
