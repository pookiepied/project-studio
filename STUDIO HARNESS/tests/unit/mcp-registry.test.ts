import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExtendError } from "../../src/extend/errors.js";
import { ExtensionInventory } from "../../src/extend/inventory.js";
import { McpServerRegistry } from "../../src/extend/mcp/registry.js";
import { ExtensionSelectionStore } from "../../src/extend/selection.js";
import { assertNoSecretColumns } from "../../src/storage/migrations.js";
import {
  openDatabase,
  storageHandle,
  type StudioDatabase,
} from "../../src/storage/database.js";

const WINDOWS = process.platform === "win32";

/** An absolute path that is shaped correctly for whichever OS runs the suite. */
function programPath(name: string): string {
  return WINDOWS ? `C:\\Program Files\\${name}.exe` : `/usr/bin/${name}`;
}

const REMOTE = {
  id: "notion",
  title: "Notion",
  transport: "http",
  url: "https://mcp.notion.com/mcp",
  auth: "bearer",
} as const;

describe("the MCP server registry", () => {
  let db: StudioDatabase;
  let registry: McpServerRegistry;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    registry = new McpServerRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("no record holds a secret", () => {
    it("has no column the migration guard calls credential storage", () => {
      // The guard runs on every open, so reaching this line already proves it.
      // Asserted directly as well, because a future column added to this table
      // must fail here rather than in whatever opens a database next.
      expect(() => assertNoSecretColumns(storageHandle(db))).not.toThrow();
    });

    it("stores the name of the variable a secret arrives in, never a value", () => {
      registry.save({
        id: "github",
        title: "GitHub",
        transport: "stdio",
        command: programPath("node"),
        args: ["/opt/github-mcp/index.js"],
        auth: "none",
        authEnvVar: "GITHUB_TOKEN",
      });

      const row = db
        .prepare("SELECT auth_env_var FROM mcp_server WHERE id = ?")
        .get("github") as { auth_env_var: string };

      expect(row.auth_env_var).toBe("GITHUB_TOKEN");
    });

    it.each([
      {
        id: "nested-env",
        transport: "stdio" as const,
        command: programPath("node"),
        env: { API_TOKEN: "secret" },
        auth: "none" as const,
      },
      {
        id: "secret-arg",
        transport: "stdio" as const,
        command: programPath("node"),
        args: ["--password=secret"],
        auth: "none" as const,
      },
      {
        id: "secret-query",
        transport: "http" as const,
        url: "https://example.test/mcp?access_token=secret",
        auth: "none" as const,
      },
    ])("rejects secret-shaped configuration and persists nothing", (input) => {
      expect(() => registry.save({ title: input.id, ...input })).toThrow(ExtendError);
      expect(registry.get(input.id)).toBeUndefined();
    });
  });

  describe("a command is a program and an argument vector", () => {
    it("refuses a relative command", () => {
      // Spelled so only the absolute-path rule can refuse it: on Windows a
      // bare `node` is also caught by the extension check, which would let
      // this pass with the rule under test deleted.
      expect(() =>
        registry.save({
          id: "local",
          title: "Local",
          transport: "stdio",
          command: WINDOWS ? "node.exe" : "node",
          auth: "none",
        }),
      ).toThrow(ExtendError);
    });

    it("keeps arguments as a list rather than a string", () => {
      const saved = registry.save({
        id: "local",
        title: "Local",
        transport: "stdio",
        command: programPath("node"),
        args: ["/opt/server.js", "--port", "1234"],
        auth: "none",
      });

      expect(saved.args).toEqual(["/opt/server.js", "--port", "1234"]);
      expect(registry.get("local")?.args).toEqual([
        "/opt/server.js",
        "--port",
        "1234",
      ]);
    });

    it("tells a user what to do about a .cmd shim", () => {
      // Most npm-installed MCP servers arrive as a .cmd on Windows, so this is
      // the refusal a user is most likely to meet. Running one needs a shell,
      // and a shell reintroduces the argument parsing we removed on purpose.
      //
      // The message is asserted, not merely the refusal: on Windows the
      // extension check refuses this path anyway, so a test that only asked
      // "did it throw" would still pass with the shim rule deleted -- and the
      // whole value of the shim rule is that it says what to do instead.
      expect(() =>
        registry.save({
          id: "npx",
          title: "Something from npm",
          transport: "stdio",
          command: WINDOWS
            ? "C:\\Users\\me\\AppData\\Roaming\\npm\\some-mcp.cmd"
            : "/home/me/.npm/some-mcp.cmd",
          auth: "none",
        }),
      ).toThrow(/command shell/);
    });
  });

  describe("a record says one thing about how it is reached", () => {
    it("refuses a local server with no command", () => {
      expect(() =>
        registry.save({
          id: "x",
          title: "X",
          transport: "stdio",
          auth: "none",
        }),
      ).toThrow(ExtendError);
    });

    it("refuses a remote server with no address", () => {
      expect(() =>
        registry.save({ id: "x", title: "X", transport: "http", auth: "none" }),
      ).toThrow(ExtendError);
    });

    it("refuses a record carrying both", () => {
      expect(() =>
        registry.save({
          id: "x",
          title: "X",
          transport: "http",
          url: "https://example.com/mcp",
          command: programPath("node"),
          auth: "none",
        }),
      ).toThrow(ExtendError);
    });

    it("refuses an address that is not http or https", () => {
      expect(() =>
        registry.save({
          id: "x",
          title: "X",
          transport: "http",
          url: "file:///etc/passwd",
          auth: "none",
        }),
      ).toThrow();
    });

    it("accepts a loopback address, because that is what a local server is", () => {
      // Deliberately not the guard `fetch` uses. This URL was typed by the
      // user into a settings form, and where it may point is judged when the
      // connection is made, which is the only place a redirect can be judged
      // too.
      const saved = registry.save({
        id: "dev",
        title: "Dev server",
        transport: "http",
        url: "http://127.0.0.1:3000/mcp",
        auth: "none",
      });

      expect(saved.url).toBe("http://127.0.0.1:3000/mcp");
    });

    it("refuses a header sign-in with no header named", () => {
      expect(() =>
        registry.save({
          id: "x",
          title: "X",
          transport: "http",
          url: "https://example.com/mcp",
          auth: "header",
        }),
      ).toThrow(ExtendError);
    });

    it("refuses an id that would break the capability key", () => {
      expect(() =>
        registry.save({ ...REMOTE, id: "has/slash" }),
      ).toThrow(ExtendError);
    });
  });

  describe("editing a server", () => {
    it("replaces rather than duplicating", () => {
      registry.save(REMOTE);
      registry.save({ ...REMOTE, title: "Notion workspace" });

      expect(registry.list()).toHaveLength(1);
      expect(registry.get("notion")?.title).toBe("Notion workspace");
    });

    it("does not call a rename a change in how it is reached", () => {
      const before = registry.save(REMOTE);
      const after = registry.save({ ...REMOTE, title: "Renamed" });

      // The user approved a tool, not a label.
      expect(McpServerRegistry.reachChanged(before, after)).toBe(false);
    });

    it("calls a changed address, command, argument, or sign-in a change", () => {
      const before = registry.save(REMOTE);

      for (const after of [
        { ...before, url: "https://elsewhere.example/mcp" },
        { ...before, auth: "none" as const },
        { ...before, authHeader: "X-Key" },
        { ...before, args: ["--new"] },
        { ...before, env: { MODE: "debug" } },
      ]) {
        expect(McpServerRegistry.reachChanged(before, after), after.url).toBe(true);
      }
    });

    it("does not call a reordered environment a change", () => {
      const before = registry.save({ ...REMOTE, env: { ALPHA: "1", BETA: "2" } });
      const after = registry.save({ ...REMOTE, env: { BETA: "2", ALPHA: "1" } });

      // The order keys were written in is not something the server can observe,
      // and it must not be what decides whether a process restarts or an
      // approval is revoked.
      expect(McpServerRegistry.reachChanged(before, after)).toBe(false);
    });

    it("gives two servers two keys, however alike their commands", () => {
      const first = registry.save({ ...REMOTE, id: "one" });
      const second = registry.save({ ...REMOTE, id: "two" });

      // The key decides which process is which. Two servers configured
      // identically are still two servers.
      expect(McpServerRegistry.reachKey(first)).not.toBe(
        McpServerRegistry.reachKey(second),
      );
    });
  });

  describe("what the spine is told", () => {
    it("hands over an id, a title, and who wrote it, and nothing else", () => {
      registry.save(REMOTE);

      expect(registry.asExtensions()).toEqual([
        { id: "notion", title: "Notion", author: "third-party" },
      ]);
    });

    it("appears in the inventory but is off until a project selects it", () => {
      registry.save(REMOTE);

      const selection = new ExtensionSelectionStore(db);
      const inventory = new ExtensionInventory(selection);
      inventory.register("mcp", () => registry.asExtensions());

      expect(inventory.list("mcp", "project-a").map((e) => e.enabled)).toEqual([
        false,
      ]);
      expect(inventory.active("mcp", "project-a")).toEqual([]);

      selection.set(
        { kind: "mcp", extensionId: "notion", projectId: "project-a" },
        true,
      );

      expect(inventory.active("mcp", "project-a").map((e) => e.id)).toEqual([
        "notion",
      ]);
    });

    it("uses one spelling of the namespace, so a revoke matches a register", () => {
      expect(McpServerRegistry.namespaceOf("notion")).toBe("mcp:notion");
    });
  });

  describe("whether a server is given a network", () => {
    // #90. Every contained MCP server used to be granted the network, because
    // a record had no way to say otherwise. The grant is now declared.

    it("grants it when nothing says otherwise", () => {
      // The default is deliberately the permissive one. Most MCP servers exist
      // to call an API, and an offline-by-default sandbox is one users switch
      // off — a boundary nobody runs is worth nothing. This also means the
      // migration changes the behaviour of exactly no installed server.
      const saved = registry.save({
        id: "github",
        title: "GitHub",
        transport: "stdio",
        command: programPath("node"),
        args: ["/opt/github-mcp/index.js"],
        auth: "none",
      });

      expect(saved.needsNetwork).toBe(true);
      expect(registry.get("github")?.needsNetwork).toBe(true);
    });

    it("remembers a server that declared it does not need one", () => {
      // The case the field exists for: a filesystem server, a database server,
      // a formatter. Nothing about them wants the internet, and until this they
      // got it anyway.
      registry.save({
        id: "files",
        title: "Files",
        transport: "stdio",
        command: programPath("node"),
        args: ["/opt/fs-mcp/index.js"],
        auth: "none",
        needsNetwork: false,
      });

      expect(registry.get("files")?.needsNetwork).toBe(false);
      expect(registry.list().map((server) => server.needsNetwork)).toEqual([false]);
    });

    it("carries a changed declaration through a re-save", () => {
      // Editing a server is a re-save, and the flag has to move with it — a
      // declaration that only applied at install time would drift out of date
      // exactly when someone had just decided to change it.
      const input = {
        id: "files",
        title: "Files",
        transport: "stdio",
        command: programPath("node"),
        args: ["/opt/fs-mcp/index.js"],
        auth: "none",
      } as const;

      registry.save({ ...input, needsNetwork: false });
      expect(registry.get("files")?.needsNetwork).toBe(false);

      registry.save({ ...input, needsNetwork: true });
      expect(registry.get("files")?.needsNetwork).toBe(true);
    });
  });
});
