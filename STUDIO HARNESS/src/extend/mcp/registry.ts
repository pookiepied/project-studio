import { extname, isAbsolute } from "node:path";

import { ExtendError } from "../errors.js";
import type { ExtensionSummary } from "../inventory.js";
import { parseHostPort } from "../../net/destination.js";
import type { StudioDatabase } from "../../storage/database.js";
import { assertSafeMcpRecord } from "./input-security.js";

/**
 * The MCP servers installed on this machine.
 *
 * Installed is the first of the three layers and the only one this file knows
 * about. A row here says a server exists and how to reach it. It does not say
 * any project gets it — that is `extension_selection` — and it does not say a
 * call may happen, which is the kernel's, per call. Keeping the three apart is
 * what stops "I added a server" from meaning "a server may now do things".
 *
 * **A record holds no secret.** A bearer token, or the value of an environment
 * variable a local server reads a key from, lives in the OS credential store
 * under `{ scope: "mcp", id }`. The row holds the *name* of the variable, which
 * is configuration. The migration guard enforces this rather than trusting the
 * comment.
 *
 * **A command is an executable and an argument vector.** Never a string, so
 * nothing downstream can re-split it, and no shell is ever involved. The checks
 * below happen at the moment a server is added, so a bad command is refused
 * while a person is looking at the form rather than months later when something
 * finally tries to spawn it.
 */

export type McpTransport = "stdio" | "http";

/** How a remote endpoint proves who we are. */
export type McpAuthKind =
  /** Nothing is sent. */
  | "none"
  /** `Authorization: Bearer <secret>`. */
  | "bearer"
  /** A named header carries the secret, for servers that use their own. */
  | "header";

/**
 * Who put this server here, and therefore how its tools are loaded.
 *
 * `system` — the capability ships with Project Studio and is part of what the
 * product is. Its tools load eagerly, exactly as the native ones do.
 * `user` — somebody attached it. Announced in the inventory, loaded on
 * request.
 *
 * The default is `user`, and that is the asymmetry of ADR 0048 §3 written
 * down: discovered → eager only ever appends to the tools array, which costs
 * the cache nothing, while eager → discovered is a removal and re-bills every
 * conversation already carrying it. A capability whose side is uncertain
 * belongs on the reversible one.
 */
export type McpProvenance = "system" | "user";

export interface McpServerRecord {
  readonly id: string;
  readonly title: string;
  /**
   * One sentence saying what this server is for, and NOT the title.
   *
   * The title is the label on a settings row and is usually a product name; a
   * model given "Blender" has been told nothing it can act on. This sentence
   * is what the capability inventory puts in the system block, so it answers
   * "what would I reach for this for".
   *
   * The empty string is a real value and means nobody has written one. The
   * inventory renders the server without a sentence rather than inventing one,
   * because a made-up purpose is worse than a missing one.
   *
   * **It reaches the most trusted position in the prompt, and it is a third
   * party's words.** `assertSafeMcpRecord` caps its length and refuses control
   * characters before it is ever stored, for the same reason `capabilities.ts`
   * frames tool results as untrusted — this is that argument one layer
   * earlier, at the point where the text becomes durable.
   */
  readonly description: string;
  /** Whose server this is, and therefore whether its tools load eagerly. */
  readonly provenance: McpProvenance;
  readonly transport: McpTransport;
  /** Absolute path to a real executable. `stdio` only. */
  readonly command?: string;
  readonly args: readonly string[];
  /**
   * Environment for the child. Non-secret only, and it does not inherit ours —
   * `buildEnvironment` decides what an OS needs, and this adds to that.
   */
  readonly env: Readonly<Record<string, string>>;
  /** `http` only. */
  readonly url?: string;
  readonly auth: McpAuthKind;
  /** Header name when `auth` is `header`. Not a secret. */
  readonly authHeader?: string;
  /**
   * The environment variable a local server reads its secret from. The value
   * comes from the credential store at spawn time and is never stored here.
   */
  readonly authEnvVar?: string;
  /**
   * Whether this server is given a network when it is contained.
   *
   * `stdio` only, and the reason this field exists at all: every contained MCP
   * server used to be granted the network because a record had no way to say
   * otherwise. Most exist to call an API, so the *default* is still `true` — an
   * offline-by-default sandbox is one users switch off, and a boundary nobody
   * runs is worth nothing.
   *
   * What changes is that the grant is now a **declaration** rather than an
   * assumption. A filesystem server, a database server, a formatter — the ones
   * with no reason to talk to anything — can be installed without it, and then
   * the strongest boundary either platform offers applies: an empty network
   * namespace on Linux, no `internetClient` on Windows.
   *
   * Irrelevant for `http` servers, which *are* the network: the harness makes
   * those requests itself and no child is contained.
   */
  readonly needsNetwork: boolean;
}

export type McpServerInput = Omit<
  McpServerRecord,
  "args" | "env" | "needsNetwork" | "description" | "provenance"
> & {
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** Optional on the way in, and the empty string when omitted. */
  readonly description?: string;
  /**
   * Optional on the way in, and `user` when omitted.
   *
   * Omitted is the common case and must mean the reversible thing. A caller
   * that wants a server loaded eagerly has to say so, which is the only way
   * round that cannot be arrived at by forgetting.
   */
  readonly provenance?: McpProvenance;
  /**
   * Optional on the way in, and `true` when omitted.
   *
   * The default matches what every already-installed server has, so an upgrade
   * changes nothing a user would notice. Making it required would have been the
   * tidier type and would have turned "we now record this" into "every existing
   * caller is a compile error and every existing server might change behaviour".
   */
  readonly needsNetwork?: boolean;
};

/** Ids become part of a capability namespace, so they may not carry a separator. */
const VALID_ID = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Windows extensions that are scripts for `cmd.exe` rather than programs.
 *
 * Refused here for the same reason `shell` refuses them: running one needs a
 * command shell, and a shell reintroduces metacharacter parsing of arguments we
 * built ourselves (CVE-2024-27980). Most npm-installed MCP servers arrive as a
 * `.cmd` shim on Windows, so this is the message a user is most likely to meet.
 */
const SHIM_EXTENSIONS = new Set([".cmd", ".bat", ".ps1"]);

function assertValidId(id: string): void {
  if (!VALID_ID.test(id)) {
    throw new ExtendError("internal", {
      message:
        "A server id may contain only letters, numbers, dots, dashes, and underscores.",
    });
  }
}

/**
 * Refuses a command before it is ever stored.
 *
 * Storing it and checking at spawn time would put the refusal months away from
 * the person who can fix it, and would leave a row that looks installed and can
 * never run.
 */
function assertValidCommand(command: string): void {
  if (!isAbsolute(command)) {
    throw new ExtendError("internal", {
      message:
        "A server command must be the full path to a program, so the program we run cannot depend on what else is installed.",
    });
  }

  const extension = extname(command).toLowerCase();

  if (SHIM_EXTENSIONS.has(extension)) {
    throw new ExtendError("internal", {
      message:
        `${command} is a script that needs a command shell, and Project Studio does not use one. ` +
        `Point at the underlying program instead — for an npm-installed server that usually means ` +
        `node and the server's own .js entry point.`,
    });
  }

  if (process.platform === "win32" && extension !== ".exe" && extension !== ".com") {
    throw new ExtendError("internal", {
      message: "On Windows a server command must be an .exe or .com program.",
    });
  }
}

/**
 * Refuses an endpoint that is not a well-formed http or https URL.
 *
 * Deliberately *not* the same guard `fetch` uses. This URL was typed by the
 * user into a settings form, and the whole point of a local MCP server is that
 * it is on this machine. `C-17` is the open question of exactly how far that
 * relaxation goes; until it is answered, the shape is checked and the
 * destination is judged where the connection is actually made, which is the
 * only place that can also re-judge a redirect.
 */
function assertValidUrl(url: string): void {
  // Throws a `DestinationError` for a malformed URL or a scheme that is not
  // http or https, and judges nothing about where it points.
  parseHostPort(url);
}

function assertConsistent(input: McpServerInput): void {
  if (input.transport === "stdio") {
    if (input.command === undefined) {
      throw new ExtendError("internal", {
        message: "A local server needs a command to run.",
      });
    }
    assertValidCommand(input.command);
    if (input.url !== undefined) {
      throw new ExtendError("internal", {
        message: "A local server has a command or an address, not both.",
      });
    }
  } else {
    if (input.url === undefined) {
      throw new ExtendError("internal", {
        message: "A remote server needs an address.",
      });
    }
    assertValidUrl(input.url);
    if (input.command !== undefined) {
      throw new ExtendError("internal", {
        message: "A remote server has an address or a command, not both.",
      });
    }
  }

  if (input.auth === "header" && (input.authHeader ?? "") === "") {
    throw new ExtendError("internal", {
      message: "That sign-in method needs the name of the header to send.",
    });
  }
}

interface ServerRow {
  id: string;
  title: string;
  description: string;
  provenance: string;
  transport: string;
  command: string | null;
  args: string;
  env: string;
  url: string | null;
  auth_kind: string;
  auth_header: string | null;
  auth_env_var: string | null;
  needs_network: number;
}

function toRecord(row: ServerRow): McpServerRecord {
  return {
    id: row.id,
    title: row.title,
    // `?? ""` and the `=== "system"` test rather than a cast: a row written
    // before these columns existed carries the migration's defaults, and a
    // hand-edited file could carry anything. An unrecognised provenance reads
    // as `user`, which is the side that withholds — a typo in the database
    // must not be the thing that loads a server eagerly.
    description: row.description ?? "",
    provenance: row.provenance === "system" ? "system" : "user",
    transport: row.transport as McpTransport,
    ...(row.command === null ? {} : { command: row.command }),
    args: JSON.parse(row.args) as string[],
    env: JSON.parse(row.env) as Record<string, string>,
    ...(row.url === null ? {} : { url: row.url }),
    auth: row.auth_kind as McpAuthKind,
    ...(row.auth_header === null ? {} : { authHeader: row.auth_header }),
    ...(row.auth_env_var === null ? {} : { authEnvVar: row.auth_env_var }),
    // `!== 0` rather than `=== 1`: SQLite holds this as an integer, and a row
    // written before the column existed carries the migration's default. Reading
    // it as "anything but off" keeps a surprising value on the permissive side,
    // which is where the behaviour already was.
    needsNetwork: row.needs_network !== 0,
  };
}

export class McpServerRegistry {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  /**
   * Adds or replaces a server.
   *
   * Replacing is how an edit happens, and an edit that changes how a server is
   * reached must revoke its grants — the approval was for what the old server's
   * tools said they did. This class does not do that itself: the grant store is
   * the only thing allowed to decide what an approval meant, and a registry
   * that could quietly revoke would be a second place permissions are decided.
   * `reachChanged` is here so the caller can ask.
   */
  save(input: McpServerInput): McpServerRecord {
    assertValidId(input.id);
    assertSafeMcpRecord(input);
    assertConsistent(input);

    const now = Date.now();
    const record: McpServerRecord = {
      ...input,
      args: input.args ?? [],
      env: input.env ?? {},
      needsNetwork: input.needsNetwork ?? true,
      description: input.description ?? "",
      provenance: input.provenance ?? "user",
    };

    this.#db
      .prepare(
        `INSERT INTO mcp_server
           (id, title, description, provenance, transport, command, args, env, url,
            auth_kind, auth_header, auth_env_var, needs_network,
            installed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           provenance = excluded.provenance,
           transport = excluded.transport,
           command = excluded.command,
           args = excluded.args,
           env = excluded.env,
           url = excluded.url,
           auth_kind = excluded.auth_kind,
           auth_header = excluded.auth_header,
           auth_env_var = excluded.auth_env_var,
           needs_network = excluded.needs_network,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.id,
        record.title,
        record.description,
        record.provenance,
        record.transport,
        record.command ?? null,
        JSON.stringify(record.args),
        JSON.stringify(record.env),
        record.url ?? null,
        record.auth,
        record.authHeader ?? null,
        record.authEnvVar ?? null,
        record.needsNetwork ? 1 : 0,
        now,
        now,
      );

    return record;
  }

  get(id: string): McpServerRecord | undefined {
    const row = this.#db
      .prepare(`SELECT * FROM mcp_server WHERE id = ?`)
      .get(id) as ServerRow | undefined;

    return row === undefined ? undefined : toRecord(row);
  }

  list(): readonly McpServerRecord[] {
    const rows = this.#db
      .prepare(`SELECT * FROM mcp_server ORDER BY id`)
      .all() as unknown as ServerRow[];

    return rows.map(toRecord);
  }

  remove(id: string): boolean {
    const result = this.#db
      .prepare(`DELETE FROM mcp_server WHERE id = ?`)
      .run(id);
    return Number(result.changes) > 0;
  }

  /**
   * The namespace this server's capabilities live under.
   *
   * One function, because the grant store revokes by namespace and the gate
   * registers by it. Two places spelling it would be two chances to disagree,
   * and the disagreement would look like approvals that survive a removal.
   */
  static namespaceOf(id: string): string {
    return `mcp:${id}`;
  }

  /**
   * The server a namespace belongs to, or `undefined` when the string is not
   * one this class would have written.
   *
   * The inverse of `namespaceOf`, held beside it because a reader that needs
   * to undo a namespace must not spell its own slice: the day `namespaceOf`'s
   * spelling changed, a private un-joiner would be splitting on a separator
   * that is no longer the one that joined. `undefined` rather than an error
   * because the strings this reads arrive from places that never promised to
   * be namespaces, and a reader that cannot tolerate a string it does not
   * recognize is a reader that cannot be pointed at anything but itself.
   */
  static serverOf(namespace: string): string | undefined {
    return namespace.startsWith("mcp:") && namespace.length > "mcp:".length
      ? namespace.slice("mcp:".length)
      : undefined;
  }

  /**
   * Everything about how this server is reached, as one comparable string.
   *
   * **The list of fields that matter, written once.** Three questions read it
   * and they must never disagree: does an edit invalidate the approvals, does an
   * edit require a restart, and are two launches the same launch. Three copies
   * of a field list is how one of them quietly stops including a field, and the
   * symptom is an approval that survives an edit or a process shared between two
   * things that are not the same.
   *
   * `title` is absent because the user approved a tool, not a label. `id` is
   * present because two servers are two servers, however alike their commands.
   *
   * `description` and `provenance` are absent for the same reason as the
   * title, and it is worth saying why rather than leaving it to be inferred.
   * Neither changes what a tool does or where the call goes, so neither can
   * invalidate an approval; and rewriting a purpose sentence must not restart
   * a running server, which is what including it here would mean. Provenance
   * decides whether tools are loaded eagerly, which is a question the tools
   * array answers at session start, not one the supervisor answers.
   */
  static reachKey(record: McpServerRecord): string {
    return JSON.stringify([
      record.id,
      record.transport,
      record.command ?? null,
      record.args,
      // Sorted, so two records that set the same variables in a different order
      // are the same reach. Object key order is not meaningful and would
      // otherwise decide whether a server restarts.
      Object.entries(record.env).sort(([a], [b]) => a.localeCompare(b)),
      record.url ?? null,
      record.auth,
      record.authHeader ?? null,
      record.authEnvVar ?? null,
    ]);
  }

  /**
   * Whether an edit changed how the server is reached.
   *
   * The events that invalidate an approval. Renaming a server or changing its
   * title does not: the user approved a tool, not a label.
   */
  static reachChanged(before: McpServerRecord, after: McpServerRecord): boolean {
    return McpServerRegistry.reachKey(before) !== McpServerRegistry.reachKey(after);
  }

  /**
   * What the spine needs to list this kind, and no more.
   *
   * The registry knows what an MCP server is; the spine does not. This is the
   * one function that crosses between them, and it is deliberately narrow — the
   * spine receives an id, a title, and who wrote it, and learns nothing about
   * transports or endpoints.
   */
  asExtensions(): readonly ExtensionSummary[] {
    return this.list().map((server) => ({
      id: server.id,
      title: server.title,
      author: "third-party" as const,
    }));
  }
}
