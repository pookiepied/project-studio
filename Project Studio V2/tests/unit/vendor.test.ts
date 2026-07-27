import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

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
let systemDirectory: string;

/** Creates a file that looks like a real binary to the resolver. */
function placeBinary(directory: string, name: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${name}${EXECUTABLE_SUFFIX}`);
  writeFileSync(path, "");
  return path;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "studio-vendor-"));
  vendored = join(base, "vendor");
  systemDirectory = join(base, "system");
  mkdirSync(systemDirectory, { recursive: true });
  clearBinaryCache();
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  clearBinaryCache();
});

describe("resolution order", () => {
  it("prefers a vendored binary over the system one", () => {
    // The vendored copy is the version we tested against; the machine's copy is
    // whatever happens to be installed.
    const expected = placeBinary(join(vendored, platformKey()), "rg");
    placeBinary(systemDirectory, "rg");

    const resolved = resolveBinary("rg", {
      vendorRoot: vendored,
      searchPath: systemDirectory,
    });

    expect(resolved.path).toBe(expected);
    expect(resolved.source).toBe("vendored");
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
});

describe("vendor layout", () => {
  it("separates builds by platform and architecture", () => {
    expect(platformKey()).toBe(`${process.platform}-${process.arch}`);
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
