import type { SecureCredentialStore } from "../../credentials/credential-store.js";
import { containCommand, programRoots } from "../../sandbox/isolation/index.js";
import { createSandboxPolicy } from "../../sandbox/policy.js";
import { ExtendError } from "../errors.js";
import { CUSTOMIZATION_SERVER_ID } from "./builtin.js";
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

    // The project's root, never ours. A server started in our own directory
    // would be a filesystem server pointed at the harness.
    const cwd = projectRoot();

    // **A server Studio wrote is not a third party's program, and containment
    // is the answer to exactly that question.** `isolation/kinds.ts` sets out
    // the taxonomy and it is provenance, not behaviour: a `tool` is ours and
    // runs in-process, a `shell` is the model's and an `mcp-server` is a third
    // party's, and both of those are contained. A built-in server is the first
    // case wearing the third one's clothes — its program, its arguments and
    // its call site were all written and reviewed here, so containing it buys
    // nothing it does not already have.
    //
    // It buys nothing and it costs the capability. A contained child is
    // refused loopback under every capability Windows offers (see
    // `isolation/backend.ts`, measured), and the single most common thing to
    // ask a browser is to look at a dev server on `localhost:3000`. Containing
    // it would ship a browser that cannot see the thing it exists to see.
    //
    // What still holds the line: the kernel approves every tool call, the
    // network policy still judges every destination host and port, and this
    // exemption is decided by a column no user-installed server can set —
    // `provenance` is written by `registerBuiltInServers` and the save route
    // refuses it from outside (see `routes/mcp.ts`).
    if (record.provenance === "system") {
      // The relay's accreditation, injected rather than configured. The
      // customization server speaks the harness's own management routes, so
      // it needs the credential the Host published and the port the listen
      // actually bound - neither of which can live in the record, because the
      // port does not exist until the harness binds, and a port inside the
      // record would change its reach key at every launch and cost every
      // conversation its approvals.
      //
      // The bind lands a few dozen milliseconds into a harness boot, and the
      // first reconcile races it. Throwing and letting the supervisor's
      // retry win that race a second later costs more than it looks: a turn
      // arriving in the window records its instructions without the relay's
      // tools, and when the relay joins - on the next turn, or on another
      // process's resume of an in-flight submission - the recorded digest no
      // longer matches, and the instructions signal lands in the middle of
      // whatever is running. Inside a model-retry wait that is a hijacked
      // turn: the signal rides in as the latest user entry and the attempt
      // answers it instead of continuing the submission. So the launch waits
      // out the bind itself - bounded, because `ensure` awaits this call,
      // and the supervisor's retry remains the net if the wait expires.
      let management = managementChildEnv(process.env);
      if (
        record.id === CUSTOMIZATION_SERVER_ID &&
        (management.STUDIO_MANAGEMENT_URL === undefined ||
          management.STUDIO_MANAGEMENT_CREDENTIAL === undefined)
      ) {
        management = await managementEnvOncePublished();
      }
      if (
        record.id === CUSTOMIZATION_SERVER_ID &&
        (management.STUDIO_MANAGEMENT_URL === undefined ||
          management.STUDIO_MANAGEMENT_CREDENTIAL === undefined)
      ) {
        throw new ExtendError("internal", {
          message:
            "The harness's management endpoint is not published yet, so its customization relay cannot " +
            "start. This is retried; once the harness's listen has bound, the next attempt goes through.",
        });
      }
      return StdioChannel.start({
        command: record.command,
        args: record.args,
        cwd,
        env: { ...env, ...management },
        ...(options.startupTimeoutMs === undefined
          ? {}
          : { startupTimeoutMs: options.startupTimeoutMs }),
      });
    }

    // **The one place a third party's program is handed to the OS.** It goes
    // through the same verdict `shell` gets — `containCommand` — rather than a
    // second rule written here, because this is the kind with the *strongest*
    // claim on containment and it was the last one still outside it. On a host
    // with a backend the command that comes back is the launcher; on one
    // without, it is unchanged, and on a host that owes containment and cannot
    // supply it, this throws before anything is spawned.
    //
    // The policy is derived from the project root rather than passed in. That
    // is a second call to `createSandboxPolicy` for the same workspace, and it
    // is safe only because the function is a pure function of the root — the
    // supervisor deliberately holds no project (see this file's header), so
    // there is no existing sandbox here to borrow.
    const contained = await containCommand("mcp-server", {
      policy: createSandboxPolicy({ workspaceRoot: cwd }),
      executable: record.command,
      args: record.args,
      cwd,
      // What the record says, rather than the `true` this used to be. Most MCP
      // servers exist to call an API, so `true` is still what a server gets when
      // nothing says otherwise — an offline-by-default sandbox is one users turn
      // off, and a boundary nobody runs is worth nothing. What changed is that
      // the grant is now a *declaration*: a filesystem server, a database
      // server or a formatter can be installed without it, and then gets the
      // strongest boundary either platform has.
      //
      // Narrow either way. Measured on both: the granted network reaches the
      // internet and is refused loopback, RFC1918 and carrier-grade NAT, so
      // even a server that declares it cannot touch a dev server, a local
      // database or the router.
      network: record.needsNetwork,
      // Without this the server cannot read its own entry script. It is
      // installed under the user's npm root, not in their project, so every
      // real server exited 1 with nothing to say until this was added.
      programRoots: programRoots(record.args),
    });

    return StdioChannel.start({
      command: contained.executable,
      args: contained.args,
      cwd,
      env,
      ...(options.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: options.startupTimeoutMs }),
    });
  };

  return { key, open };
}

/**
 * How long a launch waits for the harness's own listen to publish itself.
 *
 * The bind lands within the first tens of milliseconds of a healthy boot, so
 * five seconds is far past anything a real boot needs and short enough that a
 * process which will never bind is not hung on it - the expiry re-raises the
 * same refusal the pre-wait code threw, and the supervisor's retry takes over
 * exactly as before.
 */
const MANAGEMENT_ENV_POLL_MS = 50;
const MANAGEMENT_ENV_WAIT_MS = 5_000;

/**
 * Waits until `managementChildEnv` can produce both facts, re-reading the
 * environment on every poll because nothing announces when the listen binds.
 * Returns the last read, published or not - the caller decides what absence
 * means.
 */
async function managementEnvOncePublished(): Promise<
  Readonly<Record<string, string>>
> {
  const deadline = Date.now() + MANAGEMENT_ENV_WAIT_MS;
  for (;;) {
    const management = managementChildEnv(process.env);
    if (
      management.STUDIO_MANAGEMENT_URL !== undefined &&
      management.STUDIO_MANAGEMENT_CREDENTIAL !== undefined
    ) {
      return management;
    }
    if (Date.now() >= deadline) return management;
    await new Promise((resolve) => setTimeout(resolve, MANAGEMENT_ENV_POLL_MS));
  }
}

/**
 * The facts a customization relay needs, read from this process's own
 * environment, and otherwise nothing.
 *
 * The credential travels by environment here rather than by bootstrap frame,
 * because the relay is our own child, spawned inside the same trust domain
 * that already published the credential to the harness - a second framing
 * mechanism would be ceremony, not security. `PROJECT_STUDIO_HOME` rides
 * along whenever the harness itself overrides the default, so the relay's
 * `tools/` tree is the one the harness's own paths answer for; a divided
 * home would have the relay downloading beside a database it cannot see.
 */
export function managementChildEnv(
  reads: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const credential = reads["PROJECT_STUDIO_ADMISSION_CREDENTIAL"];
  const port = reads["PROJECT_STUDIO_BOUND_PORT"];
  const home = reads["PROJECT_STUDIO_HOME"];
  const granted: Record<string, string> = home === undefined ? {} : { PROJECT_STUDIO_HOME: home };
  if (credential === undefined || credential === "" || port === undefined || port === "") {
    return granted;
  }
  const hostname = reads["PROJECT_STUDIO_HARNESS_HOSTNAME"] ?? "127.0.0.1";
  return {
    ...granted,
    // Bracketed, because the WHATWG parser reads a scoped IPv6 literal's
    // second colon as a port: `::1:1234` throws, `::1` is exactly what a
    // deliberate Host choice looks like.
    STUDIO_MANAGEMENT_URL: `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`,
    STUDIO_MANAGEMENT_CREDENTIAL: credential,
  };
}
