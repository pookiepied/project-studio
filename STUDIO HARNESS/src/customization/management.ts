import { ExtendError } from "../extend/errors.js";

/**
 * The harness's own management API, reached over loopback.
 *
 * This module runs inside the bundled customization server - a separate
 * process (ADR 0049 §3) - so it cannot call the `McpManagementService`
 * directly: that lives in the harness, which holds the database, the
 * supervisor and the reconciler. Rather than grow a second stateful copy of
 * any of it, the relay speaks the same routes the settings screens speak,
 * which keeps one authority over the state and makes this file a transport
 * and nothing more.
 *
 * **What the endpoint is.** The harness publishes the credential the Host
 * handed it as `PROJECT_STUDIO_ADMISSION_CREDENTIAL` and, once the listen
 * binds, the port as `PROJECT_STUDIO_BOUND_PORT`. The launcher copies that
 * pair into this process's environment at spawn, because the port does not
 * exist until the harness binds and a bundled record's stored env must not
 * carry it - a port inside the record would change its reach key at every
 * launch and cost every conversation its approvals.
 */

/** What a connection looks like over the management routes. */
export interface ConnectionView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly provenance: string;
  readonly transport: string;
  readonly command?: string;
  readonly args: readonly string[];
  readonly url?: string;
  readonly auth: string;
  readonly needsNetwork: boolean;
  readonly enabledByDefault: boolean;
  readonly status:
    | {
        readonly state: string;
        readonly attempts: number;
        readonly lastError?: string;
        readonly diagnostics: readonly string[];
      }
    | undefined;
  readonly conversation?: {
    /** What this scope has stored: on, off, or null when it inherits. */
    readonly decision: boolean | null;
    readonly resolved: boolean;
    readonly decidedAt?: string;
  };
}

/** Where the harness's management endpoint can be found, when it can. */
export interface ManagementEndpoint {
  readonly url: string;
  readonly credential: string;
}

/** How long one management round trip may take. Tool calls are bounded far above this. */
const TIMEOUT_MS = 30_000;

/** The credential and base URL, when the launcher injected them; otherwise nothing. */
export function managementEndpoint(
  environment: ManagementEnvironment,
): ManagementEndpoint | undefined {
  const url = environment.STUDIO_MANAGEMENT_URL;
  const credential = environment.STUDIO_MANAGEMENT_CREDENTIAL;
  if (url === undefined || url === "" || credential === undefined || credential === "") {
    return undefined;
  }
  return { url, credential };
}

/** The environment keys the launcher injects, as this bundle reads them. */
export interface ManagementEnvironment {
  readonly STUDIO_MANAGEMENT_URL?: string;
  readonly STUDIO_MANAGEMENT_CREDENTIAL?: string;
}

/**
 * The readable cause, when the network hides its own: undici rejects every
 * connection failure as a bare "fetch failed" with the truth in `cause`, and
 * a message that says only "fetch failed" tells the model nothing to do.
 */
function reasonOf(reason: unknown): string {
  if (!(reason instanceof Error)) return String(reason);
  const cause = reason.cause;
  return cause instanceof Error ? cause.message : reason.message;
}

/**
 * One connection of the harness's settings, as this bundle serves it.
 *
 * Deliberately the same verbs the settings screen drives, in the same order
 * its own forms drive them: the record first, the secret second, the switch
 * last. A failure part way is reported with the step that failed, and
 * because a save is an upsert, the honest answer to a half-finished add is
 * to run it again.
 */
export class ManagementClient {
  readonly #endpoint: ManagementEndpoint;
  readonly #fetch: typeof fetch;

  constructor(endpoint: ManagementEndpoint, fetcher: typeof fetch = fetch) {
    this.#endpoint = endpoint;
    this.#fetch = (input, init) => fetcher(input, init);
  }

  /** Every installed connection, as the conversation leg reads them. */
  async list(conversationId: string): Promise<readonly ConnectionView[]> {
    return this.#json<readonly ConnectionView[]>(
      "GET",
      `/api/mcp/servers${conversationQuery(conversationId)}`,
      "the connection list",
    );
  }

  /** One connection, with its whole story. */
  async read(id: string, conversationId: string): Promise<ConnectionView> {
    return this.#json<ConnectionView>(
      "GET",
      `/api/mcp/servers/${encodeURIComponent(id)}/status${conversationQuery(conversationId)}`,
      "reading the connection",
    );
  }

  /**
   * Installs a connection: the record, then its secret, then the switch.
   *
   * `scope` is where the enabling decision is written - a conversation by
   * default, because that is the narrowest thing an asker could mean, and
   * the wider scopes are one call of `set_connection` away. The scope
   * decision is separate from the record on purpose: the registry says a
   * connection exists, the selection says who gets it, and neither answer
   * implies the other.
   */
  async add(
    record: Record<string, unknown>,
    options: {
      readonly conversationId: string;
      readonly secret?: string;
      readonly scope: "conversation" | "project" | "everywhere";
      readonly projectId?: string;
    },
  ): Promise<ConnectionView> {
    const saved = await this.#json<ConnectionView>(
      "POST",
      "/api/mcp/servers",
      "installing the connection",
      record,
    );
    const id = saved.id;

    if (options.secret !== undefined && options.secret !== "") {
      await this.#json(
        "PUT",
        `/api/mcp/servers/${encodeURIComponent(id)}/credential`,
        "saving its secret",
        { secret: options.secret },
      );
    }

    await this.#json(
      "PUT",
      decisionPath(id, options.scope, options.conversationId, options.projectId),
      "switching it on",
      { enabled: true },
    );
    return saved;
  }

  /** Records a decision at one scope, `inherit` meaning the wider scope again. */
  async set(
    id: string,
    scope: "conversation" | "project" | "everywhere",
    state: "on" | "off" | "inherit",
    conversationId: string,
    projectId?: string,
  ): Promise<ConnectionView> {
    const enabled = state === "on" ? true : state === "off" ? false : null;
    await this.#json(
      "PUT",
      decisionPath(id, scope, conversationId, projectId),
      "recording the switch",
      { enabled },
    );
    return this.read(id, conversationId);
  }

  /** Stops one connection and lets the reconciler bring it straight back. */
  async restart(id: string): Promise<ConnectionView> {
    return this.#json(
      "POST",
      `/api/mcp/servers/${encodeURIComponent(id)}/restart`,
      "restarting the connection",
    );
  }

  /**
   * Replaces one connection's saved secret.
   *
   * The service's credential route already stops the connection and asks the
   * reconciler to start it again, because the secret is read at launch; that
   * walk is the rotation, which is why this verb adds nothing of its own.
   */
  async setSecret(id: string, secret: string, conversationId: string): Promise<ConnectionView> {
    await this.#json(
      "PUT",
      `/api/mcp/servers/${encodeURIComponent(id)}/credential`,
      "replacing the connection's secret",
      { secret },
    );
    return this.read(id, conversationId);
  }

  /** Uninstalls: the record, its approvals, its key, its decisions, its process. */
  async remove(id: string): Promise<boolean> {
    return (
      (await this.#status(
        "DELETE",
        `/api/mcp/servers/${encodeURIComponent(id)}`,
        "removing the connection",
      )) === 204
    );
  }

  #json<T = Record<string, unknown>>(
    method: string,
    path: string,
    step: string,
    payload?: unknown,
  ): Promise<T> {
    const withoutBody = payload === undefined;
    return this.#fetch(`${this.#endpoint.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#endpoint.credential}`,
        ...(withoutBody ? {} : { "content-type": "application/json" }),
      },
      ...(withoutBody ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).then((response) => {
      if (!response.ok) return this.#refuse(step, response);
      // Some of these answers are 204s with no body at all - the credential
      // route is one - and an absent answer parses as the empty record
      // rather than as a transport failure.
      return response.text().then((text) => (text === "" ? ({} as T) : (JSON.parse(text) as T)));
    }, (reason: unknown) => {
      throw new ExtendError("internal", {
        message:
          `${step}: the harness's management interface could not be reached: ` +
          `${reasonOf(reason)}`,
      });
    });
  }

  /** One call whose only answer is the status code. */
  #status(method: string, path: string, step: string): Promise<number> {
    return this.#fetch(`${this.#endpoint.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.#endpoint.credential}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).then((response) => {
      if (!response.ok) return this.#refuse(step, response).then(() => 0);
      return response.status;
    }, (reason: unknown) => {
      throw new ExtendError("internal", {
        message:
          `${step}: the harness's management interface could not be reached: ` +
          `${reasonOf(reason)}`,
      });
    });
  }

  /**
   * Turns a non-2xx into the thrown, named thing the tool answers with.
   *
   * The management routes already write their refusals for a person reading
   * a settings screen, so the message travels as it came; what this adds is
   * only which step failed, because "the connection" failing tells a model
   * nothing about whether to retry the whole verb or just the half that
   * broke.
   */
  async #refuse(step: string, response: Response): Promise<never> {
    const detail = (await response.json().catch(() => undefined)) as
      | { error?: unknown }
      | undefined;
    const reason =
      detail === undefined || detail === null || typeof detail.error !== "string"
        ? `the management interface answered ${String(response.status)}`
        : detail.error;
    throw new ExtendError("internal", { message: `${step}: ${reason}` });
  }
}

/** Where one scope's decision is written, exactly as the routes spell it. */
function decisionPath(
  id: string,
  scope: "conversation" | "project" | "everywhere",
  conversationId: string,
  projectId: string | undefined,
): string {
  if (scope === "everywhere") return `/api/mcp/extensions/mcp/${encodeURIComponent(id)}`;
  if (scope === "project") {
    return (
      `/api/mcp/projects/${encodeURIComponent(projectId ?? "")}` +
      `/extensions/mcp/${encodeURIComponent(id)}`
    );
  }
  return (
    `/api/mcp/conversations/${encodeURIComponent(conversationId)}` +
    `/extensions/mcp/${encodeURIComponent(id)}`
  );
}

/** The read that answers for one conversation, as the list route reads it. */
function conversationQuery(conversationId: string): string {
  return conversationId === "" || conversationId === "shared"
    ? ""
    : `?conversationId=${encodeURIComponent(conversationId)}`;
}

/**
 * Builds the record a connection is installed from, without any secret in
 * it: the secret rides the body of the credential route, and the row holds
 * only the *name* of the variable a local server reads its key from. Every
 * key here is one the management route's own `serverInput` reads, because a
 * field it silently drops is a lie the tool's answer would then repeat.
 */
export function connectionRecord(input: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: "address" | "package" | "command";
  readonly url?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly auth: "none" | "bearer" | "header";
  readonly authHeader?: string;
  readonly needsNetwork?: boolean;
  readonly secretEnvVar?: string;
  readonly installed?: { readonly command: string; readonly args: readonly string[] };
}): Record<string, unknown> {
  const transported: Record<string, unknown> =
    input.kind === "address"
      ? { url: input.url, auth: input.auth, ...(input.authHeader === undefined ? {} : { authHeader: input.authHeader }) }
      : {
          command: (input.installed ?? { command: input.command }).command,
          args: (input.installed ?? { args: input.args ?? [] }).args,
          auth: "none",
          ...(input.secretEnvVar === undefined ? {} : { authEnvVar: input.secretEnvVar }),
        };

  return {
    id: input.id,
    title: input.title,
    description: input.description,
    provenance: "user",
    transport: input.kind === "address" ? "http" : "stdio",
    args: [],
    env: {},
    needsNetwork: input.needsNetwork ?? true,
    ...transported,
  };
}
