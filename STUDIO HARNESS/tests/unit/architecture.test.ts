import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  defaultModelReference,
  ModelResolutionError,
  STUDIO_MODEL_ID,
} from "../../src/contracts/models.js";
import { ModelRegistry } from "../../src/models/model-registry.js";
import { TestModelProviderAdapter } from "../../src/models/adapters/test-adapter.js";
import { resolveProviderConfig } from "../../src/models/provider-config.js";
import { createModelProviderAdapter } from "../../src/models/bootstrap.js";

describe("harness boundaries", () => {
  it("resolves model references through adapter contracts", () => {
    const registry = new ModelRegistry();
    registry.registerAdapter(new TestModelProviderAdapter());

    expect(registry.resolve(defaultModelReference("test"))).toBe(
      "project-studio/default",
    );
  });

  it("throws a ModelResolutionError for unregistered sources", () => {
    const registry = new ModelRegistry();

    expect(() => registry.resolve(defaultModelReference("local"))).toThrow(
      ModelResolutionError,
    );
  });
});

describe("model-provider composition", () => {
  it("uses a stable STUDIO_MODEL_ID that does not name a source", () => {
    expect(STUDIO_MODEL_ID).toBe("project-studio/default");

    const descriptor = new TestModelProviderAdapter().resolve(
      defaultModelReference("test"),
    );
    expect(descriptor.resolvedModelId).toBe(STUDIO_MODEL_ID);
  });

  it("defaults to the test source", () => {
    const config = resolveProviderConfig();
    expect(config.source).toBe("test");
  });

  it("creates the operational adapter for test", () => {
    expect(createModelProviderAdapter("test")).toBeInstanceOf(
      TestModelProviderAdapter,
    );
  });

  it("does not create a local adapter until a default model is chosen", () => {
    delete process.env.PROJECT_STUDIO_LOCAL_DEFAULT_MODEL;
    expect(() => createModelProviderAdapter("local")).toThrow();
  });

  it("rejects invalid source values", () => {
    expect(() => resolveProviderConfig({ source: "invalid" as never })).toThrow(
      /Invalid model source/,
    );
  });
});

describe("studio agent has no gateway or provider side effects", () => {
  it("does not reference gateway URLs, keys, tokens, or a specific provider implementation", async () => {
    const source = await readFile(
      new URL("../../src/agents/studio.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/https?:\/\//i);
    expect(source).not.toMatch(/apiKey|api_key|token|secret/i);
    expect(source).not.toMatch(/deterministic|test-adapter|local-adapter/i);
    expect(source).toContain("STUDIO_MODEL_ID");
  });

  it("does not import an adapter module for side effects", async () => {
    const source = await readFile(
      new URL("../../src/agents/studio.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/models\/adapters/);
  });
});

describe("startup ordering and adapter boundaries", () => {
  it("centralizes Project Studio-owned UUID generation", async () => {
    const offenders: string[] = [];
    for (const path of await sourceFiles()) {
      // Separator-agnostic: on Windows this path contains backslashes, so an
      // `endsWith("src/identity/uuid.ts")` skips nothing and the generator
      // reports itself. Same defect class as the 008.3 checks — `A-003` AF-02.
      const rel = path.split("\\").join("/");
      if (rel.endsWith("src/identity/uuid.ts")) continue;

      const source = await readFile(path, "utf8");
      if (/randomUUID\s*\(/.test(source)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it("validates and bootstraps model providers before observability starts", async () => {
    const source = await readFile(
      new URL("../../src/app.ts", import.meta.url),
      "utf8",
    );

    expect(source.indexOf("bootstrapModelProviders")).toBeGreaterThan(-1);
    expect(source.indexOf("bootstrapModelProviders")).toBeLessThan(
      source.indexOf("initializeObservability("),
    );
  });

  it("keeps the deterministic provider free of network transport", async () => {
    const source = await readFile(
      new URL("../../src/models/adapters/test-adapter.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\bfetch\b|node:http|XMLHttpRequest|undici/);
  });

  it("gives the credential store no plaintext fallback", async () => {
    // The rule is that a secret lives in the OS store or nowhere. Any
    // filesystem or database access from these modules would be a fallback
    // path, which is exactly what must not exist.
    for (const path of [
      "../../src/credentials/credential-store.ts",
      "../../src/credentials/keyring-store.ts",
      "../../src/credentials/memory-store.ts",
      "../../src/models/local/credential-bridge.ts",
    ]) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/node:fs|writeFile|readFile|sqlite|\.db\b/i);
    }
  });

  it("keeps credentials out of the model contract and provider config modules", async () => {
    for (const path of [
      "../../src/contracts/models.ts",
      "../../src/models/provider-config.ts",
      "../../src/models/model-registry.ts",
    ]) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/authorization|bearer|accessToken|apiKey|secret/i);
    }
  });
});

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));

async function sourceFiles(root = SRC_ROOT): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }

  return files;
}

describe("the failure taxonomy is actually adopted", () => {
  // These are the rules that keep the error contract from decaying back into
  // per-module improvisation. They are enforced here rather than in review
  // because the previous convention lasted exactly as long as someone
  // remembered it.

  it("routes every error class in src through StudioError", async () => {
    const offenders: string[] = [];

    for (const path of await sourceFiles()) {
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(
        /export class (\w*Error) extends (\w+)/g,
      )) {
        const [, name, base] = match;
        if (base !== "StudioError") {
          offenders.push(`${name} extends ${base} in ${path}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("throws no unclassified errors from src", async () => {
    // A raw `throw new Error` lands in the `unclassified` domain, which is
    // meant to measure code that has not been onboarded — not to be the
    // permanent home of code that simply never was.
    const offenders: string[] = [];

    for (const path of await sourceFiles()) {
      const source = await readFile(path, "utf8");
      if (/throw new (Error|TypeError|RangeError)\(/.test(source)) {
        offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("constructs no unclassified error anywhere in src", async () => {
    // The rule above only looked at `throw`, and that is not the only way an
    // unclassified error reaches a caller. `reject(new Error(...))` lands in
    // exactly the same place through a promise instead of a stack, and the MCP
    // wire layer arrived with three of them — two `DOMException`s and an
    // `Error` — none of which the `throw` rule could see.
    //
    // `DOMException` is included because it is what the platform hands back for
    // an abort, and taking the platform's default is the most natural way to
    // acquire an error with no domain.
    const offenders: string[] = [];

    for (const path of await sourceFiles()) {
      const source = await readFile(path, "utf8");
      if (/new (Error|TypeError|RangeError|DOMException)\(/.test(source)) {
        offenders.push(path);
      }
    }

    // `src/models/local/cli.ts` was the last interactive setup script with bare
    // errors (`E-03`). Fixed with `ProviderConfigurationError`.
    expect(offenders.map((path) => path.split(/[\\/]/).pop())).toEqual([]);
  });

  it("keeps every declared domain reachable from a real error class", async () => {
    const { AdmissionError } = await import("../../src/admission/errors.js");
    const { StudioAuthError } = await import("../../src/auth/errors.js");
    const { CredentialStoreError } = await import(
      "../../src/credentials/credential-store.js"
    );
    const { StorageError } = await import("../../src/storage/errors.js");
    const { TelemetryError } = await import(
      "../../src/observability/telemetry-errors.js"
    );
    const { ProviderConfigurationError } = await import(
      "../../src/contracts/models.js"
    );

    const domains = new Set([
      new AdmissionError("internal").domain,
      new StudioAuthError("internal").domain,
      new CredentialStoreError("internal").domain,
      new StorageError("internal").domain,
      new TelemetryError("configuration").domain,
      new ProviderConfigurationError("x").domain,
    ]);

    // `unclassified` is intentionally absent: nothing may raise it on purpose.
    expect([...domains].sort()).toEqual([
      "admission",
      "auth",
      "credentials",
      "models",
      "observability",
      "storage",
    ]);
  });
});

describe("the spine does not know what a kind is", () => {
  // `src/extend/*.ts` decides presence for every kind of extension. The moment
  // it imports one, it has learned what that kind is, and the next kind has to
  // be taught the same way — which is how a shared mechanism becomes three
  // mechanisms wearing one name.
  //
  // Enforced here rather than in review because the import that breaks it is
  // one line and looks helpful.

  it("lets nothing at the root of src/extend import from a subdirectory", async () => {
    const root = join(SRC_ROOT, "extend");
    const entries = await readdir(root, { withFileTypes: true });
    const offenders: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const source = await readFile(join(root, entry.name), "utf8");

      for (const [, specifier] of source.matchAll(/from "(\.\/[^"]+)"/g)) {
        // `./thing.js` is a sibling. `./mcp/thing.js` is a subdirectory, and
        // a subdirectory is a kind.
        if ((specifier as string).slice(2).includes("/")) {
          offenders.push(`${entry.name} imports ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("names no kind's vocabulary in the spine", async () => {
    const root = join(SRC_ROOT, "extend");
    const entries = await readdir(root, { withFileTypes: true });
    const offenders: string[] = [];

    // The kind identifiers themselves are allowed — they are keys, and
    // `inventory.ts` has to spell them to have a union at all. What is refused
    // is a kind's *vocabulary*: the words that only mean something once you
    // know what that kind does.
    const vocabulary =
      /\b(stdio|jsonrpc|json-rpc|tools\/call|transport|serverId|prompt|frontmatter|hookEvent)\b/i;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const source = await readFile(join(root, entry.name), "utf8");
      if (vocabulary.test(source)) offenders.push(entry.name);
    }

    expect(offenders).toEqual([]);
  });
});

describe("the gate is the only way a tool runs", () => {
  // The gate owns authorization, containment, snapshots, and deadlines. A tool
  // an agent can reach without going through it has none of those, and nothing
  // in review shows the omission — which is why it is a test and not a rule.

  /** Files that define or wire tools. Everything else is "outside". */
  const TOOLS_PREFIX = join("src", "tools");

  it("registers every tool factory it defines", async () => {
    // An exported `createXTool` that no `register*Tools` function passes to the
    // gate is a tool reachable by import and by nothing else — the exact shape
    // a future agent wiring would pick up as a shortcut.
    const defined = new Set<string>();
    const registered = new Set<string>();

    for (const path of await sourceFiles(join(SRC_ROOT, "tools"))) {
      const source = await readFile(path, "utf8");
      for (const [, name] of source.matchAll(/export function (create\w*Tool)\b/g)) {
        defined.add(name as string);
      }
      for (const [, name] of source.matchAll(/gate\.register\((create\w*Tool)\(/g)) {
        registered.add(name as string);
      }
    }

    expect(defined.size).toBeGreaterThan(0);
    expect([...defined].filter((name) => !registered.has(name))).toEqual([]);
  });

  it("lets nothing outside src/tools reach a tool directly", async () => {
    // The gate and the tool contracts are the public surface. Importing a tool
    // module itself gives a caller an `execute` it can invoke with no kernel in
    // the way, so the import is refused rather than the call.
    const allowed = new Set(["gate.js", "types.js", "errors.js", "bounds.js", "index.js"]);
    const known: string[] = [];
    const bypasses: string[] = [];

    for (const path of await sourceFiles()) {
      if (path.includes(TOOLS_PREFIX)) continue;
      const source = await readFile(path, "utf8");

      for (const [, specifier] of source.matchAll(/from "([^"]*tools\/[^"]+)"/g)) {
        const file = (specifier as string).split("/").pop() as string;
        if (!allowed.has(file)) bypasses.push(file);
      }
    }

    expect([...new Set(bypasses)].sort()).toEqual(known);
  });

describe("nothing the model chose reaches a process uncontained", () => {
  it("keeps the direct spawn to modules whose programs we chose", async () => {
    // `runProcess` starts a child with no containment at all, which is correct
    // for `git`, `rg`, and the snapshot machinery: we wrote those call sites and
    // picked those programs, and containing them would take the undo system
    // down with them (`isolation/kinds.ts` explains why).
    //
    // It is exactly wrong for anything the *model* named. That path goes
    // through `LocalSandbox.run`, which asks the kind what containment it is
    // owed. The difference is one import, invisible in review, and a new
    // execute-capable tool reaching for the familiar function is the realistic
    // way this regresses — so the list is closed rather than advisory.
    const allowed = new Set([
      join("src", "sandbox", "local-sandbox.ts"),
      join("src", "snapshots", "shadow-repo.ts"),
      join("src", "tools", "git", "index.ts"),
      join("src", "tools", "search", "ripgrep.ts"),
    ]);

    const importers: string[] = [];
    for (const path of await sourceFiles()) {
      const source = await readFile(path, "utf8");
      if (!/from "[^"]*process\/exec\.js"/.test(source)) continue;
      if (!/\brunProcess\b/.test(source)) continue;
      importers.push(path.slice(path.indexOf(join("src", ""))));
    }

    // Equality rather than "no extras". A subset check passes when the scan
    // finds nothing at all — a broken regex, a moved directory — and a rule
    // that cannot fail is not a rule. This also makes a stale entry an error,
    // so the list describes the code rather than the code's history.
    expect(importers.sort()).toEqual([...allowed].sort());
  });

  it("closes the list of modules that may reach `node:child_process` at all", async () => {
    // The rule above guards `runProcess` and would not have caught the gap that
    // prompted this one: `extend/mcp/stdio-channel.ts` never imported
    // `runProcess`. It called `spawn` directly, so a third party's server — the
    // kind with the strongest claim on containment — was started by a code path
    // no containment rule could see.
    //
    // Each entry below is a spawn that cannot go through `LocalSandbox.run`,
    // and each one owes a reason:
    const allowed = new Map([
      // The one place the harness starts a bounded, run-to-completion child.
      [join("src", "process", "exec.ts"), "the single spawn point"],
      // A long-lived streaming child, so it cannot use a call that waits for an
      // exit. It asks `containCommand` for the same verdict instead.
      [join("src", "extend", "mcp", "stdio-channel.ts"), "streams for a session"],
      // Configures the sandbox. Cannot use the sandbox.
      [join("src", "sandbox", "isolation", "windows", "launcher.ts"), "builds the container"],
      // Asks the kernel whether it will hand out a user namespace, by trying.
      // The answer cannot be reached any other way, and a backend that guessed
      // it would be the exact failure this whole seam exists to prevent.
      [join("src", "sandbox", "isolation", "linux", "bwrap.ts"), "probes the container"],
      // The same question about the network stack, which creates a namespace of
      // its own and is refused by the same kernel restriction.
      [join("src", "sandbox", "isolation", "linux", "network.ts"), "probes the network"],
      // Runs `apparmor_parser` to load and unload the profile that lets the
      // sandbox exist at all. Cannot go through the sandbox for the same reason
      // the Windows launcher cannot, and reached only from `sandbox/cli.ts`,
      // only when the caller is root. The command itself is deliberately absent
      // from this list: it drove the parser directly until the undo order bug
      // moved that here, and keeping the shell-out in one module is what let
      // the order become a testable property rather than a comment.
      [
        join("src", "sandbox", "isolation", "linux", "apparmor.ts"),
        "loads and unloads the profile",
      ],
      // Starts the Harness itself, which is the trusted process — a process
      // cannot contain itself (see `isolation/kinds.ts`).
      [join("src", "host", "harness-launcher.ts"), "starts the trusted process"],
      // Opens the user's browser for sign-in. Not an agent action at all.
      [join("src", "auth", "google-login.ts"), "opens the user's browser"],
    ]);

    const importers: string[] = [];
    for (const path of await sourceFiles()) {
      const source = await readFile(path, "utf8");
      if (!/from "node:child_process"/.test(source)) continue;
      importers.push(path.slice(path.indexOf(join("src", ""))));
    }

    expect(importers.sort()).toEqual([...allowed.keys()].sort());
  });
});

describe("modular monolith — 008.3 gate", () => {
    /**
     * `src`-relative, forward-slashed, whatever the platform.
     *
     * The previous version of these checks compared `path.includes("src/storage")`
     * against native paths. On Windows those contain backslashes, so nothing
     * ever matched and the gate silently bound on no file at all — see
     * `A-003` AF-02. Every path comparison below goes through here.
     */
    const relative = (path: string): string =>
      path.slice(SRC_ROOT.length + 1).split("\\").join("/");

    const inStorage = (path: string): boolean =>
      relative(path).startsWith("storage/");

    it("keeps the raw SQLite connection inside src/storage", async () => {
      // `StudioDatabase` exposes `prepare`/`exec` and no connection. A domain
      // that names `DatabaseSync` or reaches for `storageHandle` has gone
      // around the boundary rather than through it.
      const offenders: string[] = [];

      for (const path of await sourceFiles()) {
        if (inStorage(path)) continue;
        const source = await readFile(path, "utf8");

        if (/\bDatabaseSync\b/.test(source)) {
          offenders.push(`${relative(path)} — DatabaseSync`);
        }
        if (/\bstorageHandle\b/.test(source)) {
          offenders.push(`${relative(path)} — storageHandle`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it("gives every application table exactly one owning module", async () => {
      // The rule 008.3-05 states: one owner per table, and no cross-domain raw
      // SQL. Hiding the connection stops the accident; this stops the rest,
      // because `exec` still takes any SQL a caller cares to write.
      const owners = new Map<string, Set<string>>();

      // Only the string handed to `prepare`/`exec`. Scanning source text for
      // SQL keywords matches ordinary English in comments — "from the",
      // "into a" — and buries the real answer under prose.
      const SQL_STRING = /\b(?:prepare|exec)\(\s*(["'`])([\s\S]*?)\1/g;
      const TABLE_REF = /\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi;
      // `UPDATE SET` in an upsert, and SQLite's own catalogue.
      const NOT_A_TABLE = new Set(["set", "sqlite_master", "sqlite_sequence"]);

      for (const path of await sourceFiles()) {
        if (inStorage(path)) continue;
        const source = await readFile(path, "utf8");

        for (const [, , sql] of source.matchAll(SQL_STRING)) {
          for (const [, table] of (sql as string).matchAll(TABLE_REF)) {
            const name = (table as string).toLowerCase();
            if (NOT_A_TABLE.has(name)) continue;
            owners.set(name, (owners.get(name) ?? new Set()).add(relative(path)));
          }
        }
      }

      const shared = [...owners]
        .filter(([, files]) => files.size > 1)
        .map(([table, files]) => `${table}: ${[...files].sort().join(", ")}`)
        .sort();

      // No exceptions. `app_setting` was the last one: two unrelated domains
      // wrote it directly until `storage/app-settings.ts` took ownership and
      // handed each a namespaced view (ADR 0035 §5).
      expect(shared).toEqual([]);
    });

    it("only approved roots open a database", async () => {
      // Entry points only. The runtime and bootstrap are no longer here: they
      // are *given* a database now rather than resolving one (ADR 0035 §3).
      const allowedRoots = new Set([
        "app.ts",
        "models/local/cli.ts",
        "auth/cli.ts",
        // The conversation export is an entry point of the same kind: it opens
        // the Flue journal and the Studio index, both read-only, to write the
        // history out before the Flue 2.0 upgrade destroys the source.
        "conversations/export-cli.ts",
      ]);
      const offenders: string[] = [];

      for (const path of await sourceFiles()) {
        const rel = relative(path);
        if (inStorage(path) || allowedRoots.has(rel)) continue;

        const source = await readFile(path, "utf8");
        if (/getDatabase\(\)|openDatabase\(/.test(source)) offenders.push(rel);
      }

      expect(offenders).toEqual([]);
    });

    it("keeps no process-wide connection in the storage module", async () => {
      // The check above skips `src/storage`, so on its own it would not notice
      // the singleton coming back to the exact file it was removed from — and
      // that is where it lived. This is the assertion that protects #24: the
      // module may open connections, never hold one.
      const source = await readFile(join(SRC_ROOT, "storage/database.ts"), "utf8");
      const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

      // A module-level mutable binding of the database type is the shape a
      // shared connection takes, whatever it ends up being called.
      const moduleState = [
        ...code.matchAll(/^(?:let|var)\s+(\w+)\s*:\s*StudioDatabase/gm),
      ].map((match) => match[1] as string);
      expect(moduleState).toEqual([]);

      // And no ambient accessor handing one out.
      expect(/export function getDatabase\b/.test(code)).toBe(false);
      expect(/export function closeDatabase\b/.test(code)).toBe(false);
    });

    it("does not let transport or agents reach past the runtime façade", async () => {
      const offenders: string[] = [];

      for (const path of await sourceFiles()) {
        const rel = relative(path);
        if (!rel.startsWith("transport/") && !rel.startsWith("agents/")) continue;

        const source = await readFile(path, "utf8");
        if (/\bStudioRuntime\b|\bgetStudioRuntime\b/.test(source)) offenders.push(rel);
      }

      // One exception, and it is a framework boundary rather than debt.
      // `agents/studio.ts` is loaded by Flue's own module resolution and never
      // constructed by us, so nothing can be injected into it; it reads the
      // locator, which returns `AgentHost` and not the class (ADR 0035 §6).
      //
      // Transport is gone from this list: it takes the `McpAdministration`
      // port. A second agent file appearing here is a real regression.
      expect(offenders.sort()).toEqual(["agents/studio.ts"]);
    });

    it("does not grow the runtime's public surface", async () => {
      const runtimeSource = await readFile(
        join(SRC_ROOT, "application/studio-runtime.ts"),
        "utf8",
      );
      // From the class declaration onwards, so the options interfaces above it
      // — which are legitimately all-public — are not counted as bags.
      const classBody = runtimeSource.slice(
        runtimeSource.indexOf("export class StudioRuntime"),
      );
      const publicBags = [
        ...classBody.matchAll(/^  readonly ([a-z][A-Za-z]*):/gm),
      ].map((match) => match[1] as string);

      // Empty. All ten repositories are private; what the outside needs is
      // reached through `servers` (a port) and the two `AgentHost` members,
      // none of which is a repository handed over whole.
      expect(publicBags.sort()).toEqual([]);
    });

    it("keeps one owner for the git network policy decision", async () => {
      const policySource = await readFile(join(SRC_ROOT, "permissions/policy.ts"), "utf8");
      const classifySource = await readFile(join(SRC_ROOT, "tools/git/classify.ts"), "utf8");

      expect(/GIT_NETWORK_SUBCOMMANDS/.test(policySource)).toBe(true);
      expect(/const NETWORK/.test(classifySource)).toBe(true);
    });
  });

  it("gives the kernel every capability the gate will answer for", async () => {
    // Registration is one call so the two cannot drift. This is the assertion
    // that the one call really does both: a key the gate lists but the kernel
    // has never heard of would be denied at best and unaudited at worst.
    const { CallGate } = await import("../../src/tools/gate.js");
    const { PermissionKernel } = await import("../../src/permissions/kernel.js");
    const { PermissionGrantStore } = await import(
      "../../src/permissions/grant-store.js"
    );
    const { openDatabase } = await import("../../src/storage/database.js");
    const { LocalSandbox } = await import("../../src/sandbox/local-sandbox.js");
    const { createSandboxPolicy } = await import("../../src/sandbox/policy.js");
    const { registerFilesystemTools } = await import(
      "../../src/tools/filesystem/index.js"
    );
    const { registerGitTools } = await import("../../src/tools/git/index.js");
    const { registerSearchTools } = await import("../../src/tools/search/index.js");
    const { registerShellTools } = await import("../../src/tools/shell/index.js");
    const { registerWebTools } = await import("../../src/tools/web/index.js");
    const { RetrievalService } = await import("../../src/retrieval/service.js");
    const { RetrievalSettingsStore } = await import("../../src/retrieval/settings.js");

    const db = openDatabase({ path: ":memory:" });
    try {
      const kernel = new PermissionKernel({ grants: new PermissionGrantStore(db) });
      const gate = new CallGate({
        kernel,
        sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: process.cwd() })),
      });

      registerFilesystemTools(gate);
      registerGitTools(gate);
      registerSearchTools(gate);
      registerShellTools(gate);
      registerWebTools(
        gate,
        new RetrievalService({
          settings: new RetrievalSettingsStore(db),
          credentials: {
            get: async () => null,
            set: async () => undefined,
            delete: async () => false,
          },
        }),
      );

      const listed = gate.list().map((tool) => tool.id);
      expect(listed.length).toBeGreaterThan(0);
      for (const id of listed) {
        expect(kernel.get(id), `${id.namespace}/${id.name} is unknown to the kernel`)
          .toBeDefined();
      }
    } finally {
      db.close();
    }
  });
});
