import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkNodeRuntime,
  compareVersions,
  DEVELOPMENT_NODE_VERSION,
  MINIMUM_NODE_VERSION,
  reportNodeRuntime,
} from "../../src/platform/runtime.js";

/**
 * The project's Node version is stated in three places, and they must agree.
 *
 * `src/platform/runtime.ts` states it for the running Harness, `package.json`
 * states it for pnpm, and `.node-version` states it for whichever version
 * manager a developer uses. Before meta-task #79 all three disagreed and
 * nothing noticed: the pin said `24.14.0`, `engines` said `>=22.19.0`, and
 * every measurement in the Stage 4 remediation cycle was taken on `v22.18.0`.
 *
 * None of those numbers is enforced by tooling in this repository — there is no
 * CI, and no version manager is installed on the development machine — so this
 * file is the only thing standing between the three copies and silent drift.
 * That is the same structural situation as the environment allowlist (ADR 0039)
 * and the git subcommand lists (#78): every copy internally consistent, so
 * disagreement produces no error anywhere.
 *
 * The last block is the one that matters most. It reads the *installed*
 * dependencies rather than trusting any of the three declarations, so the floor
 * is verified against the thing that actually imposes it instead of against a
 * comment claiming what imposes it.
 */

const HARNESS_ROOT = join(import.meta.dirname, "..", "..");

function readJson(path: string): { engines?: { node?: string } } {
  return JSON.parse(readFileSync(path, "utf8")) as { engines?: { node?: string } };
}

describe("compareVersions", () => {
  it("orders by each component in turn", () => {
    expect(compareVersions("22.19.0", "22.18.0")).toBe(1);
    expect(compareVersions("22.18.0", "22.19.0")).toBe(-1);
    expect(compareVersions("24.0.0", "22.99.99")).toBe(1);
    expect(compareVersions("22.19.0", "22.19.0")).toBe(0);
  });

  it("compares numerically, not as text", () => {
    // The failure this guards is specific: string ordering puts "9" after "10",
    // so a lexical comparison calls 22.9.0 newer than 22.19.0 and waves an
    // unsupported runtime through.
    expect(compareVersions("22.19.0", "22.9.0")).toBe(1);
    expect(compareVersions("v24.19.0", "24.9.0")).toBe(1);
  });

  it("accepts the leading v that process.version carries", () => {
    expect(compareVersions("v22.19.0", "22.19.0")).toBe(0);
  });

  it("treats an unparsable version as older rather than newer", () => {
    // Reported rather than waved through: an unrecognised runtime is exactly
    // the case where a silent pass is worst.
    expect(compareVersions("not-a-version", MINIMUM_NODE_VERSION)).toBe(-1);
  });
});

describe("checkNodeRuntime", () => {
  it("rejects the runtime this cycle was actually measured on", () => {
    // Not a hypothetical. v22.18.0 is the version every baseline in the Stage 4
    // remediation was taken on, and the reason each of those numbers carries an
    // asterisk.
    const verdict = checkNodeRuntime("v22.18.0");
    expect(verdict.supported).toBe(false);
    expect(verdict.running).toBe("22.18.0");
    expect(verdict.message).toContain(MINIMUM_NODE_VERSION);
    expect(verdict.message).toContain(DEVELOPMENT_NODE_VERSION);
  });

  it("accepts the floor itself and the pinned version", () => {
    expect(checkNodeRuntime(MINIMUM_NODE_VERSION).supported).toBe(true);
    expect(checkNodeRuntime(DEVELOPMENT_NODE_VERSION).supported).toBe(true);
  });

  it("says nothing extra when the runtime is supported", () => {
    expect(checkNodeRuntime("24.19.0").message).toBeUndefined();
  });
});

describe("reportNodeRuntime", () => {
  function recordingLogger(): {
    warnings: Array<{ message: string; fields?: Record<string, unknown> }>;
    warn: (message: string, fields?: Record<string, unknown>) => void;
  } {
    const warnings: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    return {
      warnings,
      warn: (message, fields) => {
        warnings.push(fields === undefined ? { message } : { message, fields });
      },
    };
  }

  it("warns once, with both versions in the fields", () => {
    const logger = recordingLogger();
    reportNodeRuntime(logger, "v22.18.0");
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]!.fields).toMatchObject({
      running: "22.18.0",
      minimum: MINIMUM_NODE_VERSION,
      pinned: DEVELOPMENT_NODE_VERSION,
    });
  });

  it("stays quiet on a supported runtime", () => {
    // A warning on every start of a correct installation is a warning people
    // learn to scroll past, which would cost this check the only property it
    // has over the file nobody read.
    const logger = recordingLogger();
    reportNodeRuntime(logger, `v${DEVELOPMENT_NODE_VERSION}`);
    expect(logger.warnings).toEqual([]);
  });
});

describe("the declared Node version", () => {
  it("is the same floor in the module and in package.json", () => {
    const engines = readJson(join(HARNESS_ROOT, "package.json")).engines?.node;
    expect(engines).toBe(`>=${MINIMUM_NODE_VERSION}`);
  });

  it("is the same pin in the module and in .node-version", () => {
    const pinned = readFileSync(join(HARNESS_ROOT, ".node-version"), "utf8").trim();
    expect(pinned).toBe(DEVELOPMENT_NODE_VERSION);
  });

  it("pins a version that satisfies its own floor", () => {
    // Cheap, and it catches the incoherent state directly: a pin below the
    // floor means following the pin produces an unsupported runtime.
    expect(compareVersions(DEVELOPMENT_NODE_VERSION, MINIMUM_NODE_VERSION)).toBeGreaterThanOrEqual(
      0,
    );
  });

  it("is at least as high as every dependency that declares one", () => {
    // The floor is not a preference. It is inherited from Flue and pi-ai, and
    // this reads their installed manifests rather than a comment about them —
    // if Flue raises its floor in a future upgrade, this fails on the upgrade
    // instead of at whatever runtime failure the new floor was protecting
    // against.
    const dependencies = [
      "@flue/runtime",
      "@flue/cli",
      "@flue/opentelemetry",
      "@earendil-works/pi-ai",
    ];

    const declared: Array<[string, string]> = [];
    for (const name of dependencies) {
      const manifest = join(HARNESS_ROOT, "node_modules", name, "package.json");
      if (!existsSync(manifest)) continue;
      const range = readJson(manifest).engines?.node;
      if (range === undefined) continue;
      const floor = /(\d+\.\d+\.\d+)/.exec(range);
      if (floor !== null) declared.push([name, floor[1]!]);
    }

    // Guards the test itself. An empty list would make every assertion below
    // vacuous, and the packages are direct dependencies — absent means the
    // install is broken or a name changed, not that the check is unnecessary.
    expect(declared.length).toBeGreaterThan(0);

    for (const [name, floor] of declared) {
      expect(
        compareVersions(MINIMUM_NODE_VERSION, floor),
        `${name} requires Node ${floor}, above the declared floor of ${MINIMUM_NODE_VERSION}`,
      ).toBeGreaterThanOrEqual(0);
    }
  });
});
