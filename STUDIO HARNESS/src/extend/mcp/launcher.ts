import type { SecureCredentialStore } from "../../credentials/credential-store.js";
import { ExtendError } from "../errors.js";
import type { McpChannel } from "./connection.js";
import { HttpChannel } from "./http-channel.js";
import { McpServerRegistry, type McpServerRecord } from "./registry.js";
import { StdioChannel } from "./stdio-channel.js";
import type { McpLauncher } from "./supervisor.js";

/**
 * Turns a stored server record into a live channel.
 *
 * The supervisor takes a launcher rather than starting servers itself, and this
 * is the reason: starting one needs two things the supervisor must never hold.
 *
 * 1. **The project root**, which becomes a local server's working directory. A
 *    supervisor that knew about projects would be a second place the folder wall
 *    is decided.
 * 2. **The secret**, read from the OS credential store *at this moment*, held
 *    for as long as the call takes, and never stored. A supervisor holds live
 *    objects for the length of a session, and a secret must not live that long.
 *
 * **The record never holds the secret.** It holds the *name* of the environment
 * variable a local server reads it from, or the name of the header a remote one
 * expects it in. That is configuration. The value is in the credential store
 * under `{ scope: "mcp", id }` and is read here, once, per launch.
 *
 * **This is the only place a transport is chosen.** Everything above takes a
 * channel and does not ask which kind it is — see ADR 0027 — so if a third
 * transport ever arrives, this function is the only one that learns about it.
 */

export interface McpLauncherOptions {
  readonly credentials: SecureCredentialStore;
  /**
   * The open project's root, read at the moment of the launch.
   *
   * A function rather than a value because a launch may happen long after the
   * launcher is built, and the answer is whatever is open then. One project is
   * open at a time today, which is what makes a single answer correct; `L-05`
   * is the item that revisits this when that stops being true.
   */
  readonly projectRoot: () => string;
  /** How long a local server has to survive before we believe it started. */
  readonly startupTimeoutMs?: number;
}

/**
 * Reads the one secret a server needs, or says plainly that it is missing.
 *
 * A server whose sign-in method needs a secret and has none cannot start, and
 * saying so here is far better than letting it start and fail its first call
 * with whatever the far end says about an empty token.
 */
async function readSecret(
  record: McpServerRecord,
  credentials: SecureCredentialStore,
): Promise<string | undefined> {
  if (record.auth === "none") return undefined;

  const secret = await credentials.get({ scope: "mcp", id: record.id });
  if (secret === null || secret === "") {
    throw new ExtendError("internal", {
      // Names the server and the fix, and cannot name the value: there is no
      // value to name.
      message: `${record.title} needs a saved secret to sign in, and none is stored. Add it in settings.`,
    });
  }
  return secret;
}

export function createMcpLauncher(options: McpLauncherOptions): McpLauncher {
  const { credentials, projectRoot } = options;

  /**
   * What makes two launches the same launch — `C-18`'s second half.
   *
   * `reachKey` is the registry's one list of the fields that matter, the same
   * list that decides whether an edit invalidates an approval. The working
   * directory is added here because it is the one thing that varies without the
   * record changing at all: the same server, the same command, two projects.
   *
   * **A remote server has no working directory**, so two projects reaching one
   * endpoint are reaching one endpoint and share a connection. There is nothing
   * project-shaped to get wrong, which is why the root is left out rather than
   * added for symmetry — a key that varied on something the server cannot
   * observe would open a second connection for no reason.
   */
  const key = (record: McpServerRecord): string => {
    const reach = McpServerRegistry.reachKey(record);
    if (record.transport === "http") return reach;
    return `${reach} ${projectRoot()}`;
  };

  const open = async (record: McpServerRecord): Promise<McpChannel> => {
    const secret = await readSecret(record, credentials);

    if (record.transport === "http") {
      if (record.url === undefined) {
        // The registry refuses this at the moment a server is added, so
        // reaching it means a row was written by something else.
        throw new ExtendError("internal", {
          message: `${record.title} is a remote server with no address.`,
        });
      }

      return HttpChannel.open({
        url: record.url,
        ...(secret === undefined ? {} : { secret }),
        ...(record.authHeader === undefined ? {} : { authHeaderName: record.authHeader }),
      });
    }

    if (record.command === undefined) {
      throw new ExtendError("internal", {
        message: `${record.title} is a local server with no command to run.`,
      });
    }

    // Built here and discarded when this call returns. The child receives it,
    // and nothing on our side keeps a reference — which is what "held for as
    // long as the call takes" means in practice.
    const env: Record<string, string> = { ...record.env };
    if (record.authEnvVar !== undefined && secret !== undefined) {
      env[record.authEnvVar] = secret;
    }

    return StdioChannel.start({
      command: record.command,
      args: record.args,
      // The project's root, never ours. A server started in our own directory
      // would be a filesystem server pointed at the harness.
      cwd: projectRoot(),
      env,
      ...(options.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: options.startupTimeoutMs }),
    });
  };

  return { key, open };
}
