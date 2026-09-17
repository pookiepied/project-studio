import type { SecureCredentialStore } from "../credentials/credential-store.js";
import type { AuthContext } from "../admission/context.js";
import { ExtendError } from "../extend/errors.js";
import type { ExtensionReconciler } from "../extend/reconcile.js";
import { McpServerRegistry, type McpServerInput, type McpServerRecord } from "../extend/mcp/registry.js";
import type { McpSupervisor } from "../extend/mcp/supervisor.js";
import { GLOBAL_SCOPE, conversationScope, projectScope, type ExtensionSelectionStore, type Resolution, type ResolutionContext, type Scope, type ScopeKind } from "../extend/selection.js";
import type { PermissionGrantStore } from "../permissions/grant-store.js";

/**
 * Which narrower context a read should answer for.
 *
 * Both scopes are optional and independently askable: a project's screen asks
 * about its project, a conversation's about its conversation, and the global
 * settings ask about neither - their rows carry no readings at all, because
 * they are editing the default itself and nothing else answers to it.
 */
export interface McpReadContext {
  readonly projectId?: string;
  readonly conversationId?: string;
}

/**
 * What one scope has decided, and what the whole chain answers.
 *
 * Three facts, because a settings row has to be honest about the effect, not
 * only the setting. `decision` is what is stored at this scope: true or false
 * when this scope has an opinion, and `null` when it inherits - which is a
 * real third answer and not a spelling of off. `resolved` and `decidedAt` are
 * what selection answers for the context the read was made in: when this
 * scope decided, its own answer; when it did not, the wider scope's, or off
 * when nothing anywhere had an opinion. A control that showed only the
 * decision would render "inherits" and "off" as the same silence, and the two
 * leave the model with different reach.
 */
export interface McpScopeReading {
  /** What this scope has stored: on, off, or `null` when it inherits. */
  readonly decision: boolean | null;
  /** What selection resolves for the context this read was made in. */
  readonly resolved: boolean;
  /** Which scope produced `resolved`. `undefined` when nothing anywhere decided; that resolves to off. */
  readonly decidedAt?: ScopeKind;
}

/**
 * The one mutation surface for installed MCP servers.
 *
 * The registry stores configuration, the selection store scopes it to a
 * project, and the grant store owns what an approval meant. Keeping the three
 * mutations here makes an edit impossible to apply to one layer and forget in
 * the other two.
 */
export interface McpManagementOptions {
  readonly registry: McpServerRegistry;
  readonly grants: PermissionGrantStore;
  readonly selection: ExtensionSelectionStore;
  readonly supervisor: Pick<McpSupervisor, "stop" | "status">;
  readonly extensions: Pick<ExtensionReconciler, "changed">;
  /**
   * Fires a reconcile pass for the change just written, without waiting for it.
   *
   * `extensions.changed()` marks the desired set dirty; this is the fast half
   * that applies the change now rather than at the next turn boundary. A
   * decision that starts a process must not wait for the process: a server
   * that takes ten seconds to handshake must not hold the settings screen's
   * response for ten seconds, so the callback is fire-and-forget by contract —
   * it must not throw, and nothing awaits its return. A server that fails to
   * start fails into the supervisor, which already holds the reason and the
   * retry.
   *
   * Optional because the turn boundary remains the correct slow path: a
   * composition without this still reconciles, just later, and nothing
   * anywhere depends on the pass having run.
   */
  readonly reconcile?: () => void;
  readonly credentials?: SecureCredentialStore;
  /**
   * This harness's own project: the scope whose decisions its tools array
   * resolves. It answers the read's question "and what does the wider leg say"
   * for a conversation that stands in no project, which is the leg the
   * historic projectless-conversation bug taught the runtime never to lose.
   */
  readonly projectId: string;
  /** Where one conversation's wider leg is, when it stands in a project. */
  readonly conversationProject?: (conversationId: string) => string | undefined;
}

/** A server as a caller sees it: what was configured, plus what it is doing. */
export type McpServerView = McpServerRecord & {
  readonly status: ReturnType<McpSupervisor["status"]>;
  /** Whether the user's default has this server on. Not per project. */
  readonly enabledByDefault: boolean;
  /**
   * The readings for the narrower scopes the read asked about, when it did.
   *
   * They are absent from the global read, which is about the default only.
   * Each reading's `resolved` is the whole chain's answer for the read's
   * context, so a project row shows what a conversation of that project gets
   * before any conversation of its own had a say, and a conversation row
   * shows what this conversation resolves to right now.
   */
  readonly project?: McpScopeReading;
  readonly conversation?: McpScopeReading;
};

/**
 * Everything the HTTP surface needs, and nothing else.
 *
 * The route module used to take the whole `StudioRuntime` and compose
 * `registry.get` with `supervisor.status` itself, which put a domain join in
 * the transport layer and meant a route could reach anything the runtime
 * exposed. This interface is the seam instead (ADR 0035 §2).
 */
export interface McpAdministration {
  list(context?: McpReadContext): readonly McpServerView[];
  get(id: string, context?: McpReadContext): McpServerView | undefined;
  save(input: McpServerInput, auth: AuthContext): McpServerView;
  remove(id: string, auth: AuthContext): Promise<boolean>;
  /** Stops the connection and lets the reconciler start it again at once. */
  restart(id: string, auth: AuthContext): Promise<McpServerView>;
  /** `null` clears the decision at this scope, so the wider scope applies. */
  setEnabled(scope: Scope, id: string, enabled: boolean | null, auth: AuthContext): void;
  setCredential(id: string, secret: string, auth: AuthContext): Promise<void>;
  deleteCredential(id: string, auth: AuthContext): Promise<boolean>;
}

export class McpManagementService implements McpAdministration {
  readonly #registry: McpServerRegistry;
  readonly #grants: PermissionGrantStore;
  readonly #selection: ExtensionSelectionStore;
  readonly #supervisor: Pick<McpSupervisor, "stop" | "status">;
  readonly #extensions: Pick<ExtensionReconciler, "changed">;
  readonly #reconcile: (() => void) | undefined;
  readonly #credentials: SecureCredentialStore | undefined;
  readonly #projectId: string;
  readonly #conversationProject:
    | ((conversationId: string) => string | undefined)
    | undefined;

  constructor(options: McpManagementOptions) {
    this.#registry = options.registry;
    this.#grants = options.grants;
    this.#selection = options.selection;
    this.#supervisor = options.supervisor;
    this.#extensions = options.extensions;
    this.#reconcile = options.reconcile;
    this.#credentials = options.credentials;
    this.#projectId = options.projectId;
    this.#conversationProject = options.conversationProject;
  }

  /**
   * Applies the change now, in the background, in every mutating path.
   *
   * Not a replacement for `changed()` — both are called, always. The
   * reconciler's whole argument is that a missed notification costs one stale
   * cycle rather than a permanent lie, and that argument survives this: the
   * pass is the fast path, the dirty generation is the correct slow one, and
   * a failure of the fast path leaves the slow one exactly as it was.
   *
   * A throwing callback is caught here rather than trusted not to throw,
   * because the caller just made a settings change and the settings change
   * succeeded: failing the mutation because a background pass could not
   * start would report a breakage that did not happen, and un-apply nothing —
   * the durable row is already written. The pass's own failures report
   * themselves — a kind that fails aborts its pass with the message, and the
   * supervisor holds any server's failure — so swallowing here costs a
   * log-shaped nothing.
   */
  #applyNow(): void {
    this.#extensions.changed();
    try {
      this.#reconcile?.();
    } catch {
      // Deliberately empty: see above.
    }
  }

  /**
   * The chain the read's resolution runs down.
   *
   * A conversation asked about alone resolves through the project it is filed
   * under - the chain its conversations actually stand in - and through this
   * harness's project when it stands in none, which is the leg the tools
   * array has always consulted. A read naming both scopes is answered as
   * given; neither is invented for the other.
   */
  #resolutionContext(context: McpReadContext): ResolutionContext {
    const projectId =
      context.projectId ??
      (context.conversationId === undefined
        ? undefined
        : (this.#conversationProject?.(context.conversationId) ?? this.#projectId));
    return {
      ...(projectId === undefined ? {} : { projectId }),
      ...(context.conversationId === undefined ? {} : { conversationId: context.conversationId }),
    };
  }

  /**
   * What one scope stores, beside what the chain resolves.
   *
   * One resolution serves every reading on the row, because both questions
   * are answered by the same chain: the stored decision is read at the
   * scope's own key, and the resolution is the chain's answer. Computing them
   * apart would let a row say "inherits" while its resolution came from
   * somewhere the inheritance does not reach.
   */
  #reading(extensionId: string, scope: Scope, resolution: Resolution): McpScopeReading {
    return {
      decision: this.#selection.decisionAt({ kind: "mcp", extensionId, scope }) ?? null,
      resolved: resolution.enabled,
      ...(resolution.decidedAt === undefined ? {} : { decidedAt: resolution.decidedAt }),
    };
  }

  #view(record: McpServerRecord, context: McpReadContext = {}): McpServerView {
    const resolution = this.#selection.resolve("mcp", record.id, this.#resolutionContext(context));
    return {
      ...record,
      status: this.#supervisor.status(record.id),
      // The user's DEFAULT, read at the global scope only. A settings screen
      // showing this list is editing defaults, and it needs the stored answer
      // rather than something inferred from whether a process happens to be
      // running: a server can be on by default and not yet started, or running
      // for a project that overrode the default to on. Inferring from `status`
      // would show the wrong switch in both cases.
      enabledByDefault:
        this.#selection.decisionAt({
          kind: "mcp",
          extensionId: record.id,
          scope: GLOBAL_SCOPE,
        }) ?? false,
      ...(context.projectId === undefined
        ? {}
        : {
            project: this.#reading(record.id, projectScope(context.projectId), resolution),
          }),
      ...(context.conversationId === undefined
        ? {}
        : {
            conversation: this.#reading(
              record.id,
              conversationScope(context.conversationId),
              resolution,
            ),
          }),
    };
  }

  list(context: McpReadContext = {}): readonly McpServerView[] {
    return this.#registry.list().map((record) => this.#view(record, context));
  }

  get(id: string, context: McpReadContext = {}): McpServerView | undefined {
    const record = this.#registry.get(id);
    return record === undefined ? undefined : this.#view(record, context);
  }

  save(input: McpServerInput, _auth: AuthContext): McpServerView {
    const before = this.#registry.get(input.id);
    this.#refuseIfOurs(before, "edited");
    const after = this.#registry.save(input);

    if (before !== undefined && McpServerRegistry.reachChanged(before, after)) {
      this.#grants.revokeNamespace(McpServerRegistry.namespaceOf(input.id));
    }

    this.#applyNow();
    return this.#view(after);
  }

  /**
   * Studio's own capabilities are not editable or removable from outside.
   *
   * Switching one off is a person's decision and always works — that is the
   * selection store, and nothing here touches it. What is refused is changing
   * *what the server is*: its command, its arguments, whether it exists at
   * all. Those are the fields that decide what gets launched, and a system
   * server is launched without containment because Studio wrote it. An edit
   * would make that sentence untrue while the row still claimed it.
   *
   * The refusal names the thing a person actually wants, because someone who
   * reaches for Delete on the browser wants it to stop running, and there is a
   * switch for exactly that one screen away.
   */
  #refuseIfOurs(record: McpServerRecord | undefined, verb: string): void {
    if (record?.provenance !== "system") return;
    throw new ExtendError("internal", {
      message:
        `${record.title} is one of Studio's own capabilities, so it cannot be ${verb}. ` +
        "Switch it off instead - globally, for a project, or for one conversation.",
    });
  }

  async remove(id: string, _auth: AuthContext): Promise<boolean> {
    const server = this.#registry.get(id);
    if (server === undefined) return false;
    this.#refuseIfOurs(server, "removed");

    // Delete the keychain entry before the durable row. If the secure store
    // refuses, the configuration remains retryable instead of orphaning a key.
    if (this.#credentials !== undefined) {
      await this.#credentials.delete({ scope: "mcp", id });
    }

    const removed = this.#registry.remove(id);
    if (!removed) return false;

    this.#grants.revokeNamespace(McpServerRegistry.namespaceOf(id));
    this.#selection.forget("mcp", id);
    await this.#supervisor.stop(id);
    this.#applyNow();
    return true;
  }

  /**
   * Stops one connection and lets the reconciler bring it straight back.
   *
   * There is no stronger "restart" to expose, and that is the point: the
   * supervisor's record of how to launch a connection *is* the record, so
   * stopping and asking for what should be running is the whole of it, for
   * wedged processes and changed secrets alike. A wedged relay is a process
   * to restart; an in-process hang would have been the harness, which is one
   * reason the capability is its own process (ADR 0049 §3).
   *
   * Studio's own connections are restartable like any other - they are
   * launched from their recorded selves, so a restart cannot make the row's
   * claim untrue, which is the only thing `#refuseIfOurs` guards.
   *
   * The returned view's status is what the supervisor knows right then -
   * usually nothing, because the reconciler's wake is deferred behind a
   * microtask and this answers with the connection already stopped. Whether
   * it came back is the next connection_status read's story, which is what
   * every caller of this one is told.
   */
  async restart(id: string, _auth: AuthContext): Promise<McpServerView> {
    const record = this.#requireServer(id);
    await this.#supervisor.stop(id);
    this.#applyNow();
    return this.#view(record);
  }

  /**
   * Records a decision at one scope.
   *
   * `clear` rather than `set(false)` is how a project or conversation goes back
   * to inheriting, which is a third answer the caller has to be able to
   * express: on, off, and "no opinion here". Offering only the first two traps
   * the user at the narrow scope with no way back to the default.
   */
  setEnabled(
    scope: Scope,
    id: string,
    enabled: boolean | null,
    _auth: AuthContext,
  ): void {
    this.#requireServer(id);
    const key = { kind: "mcp", extensionId: id, scope } as const;
    if (enabled === null) this.#selection.clear(key);
    else this.#selection.set(key, enabled);
    this.#applyNow();
  }

  async setCredential(
    id: string,
    secret: string,
    _auth: AuthContext,
  ): Promise<void> {
    this.#requireServer(id);
    const credentials = this.#credentials;
    if (credentials === undefined) {
      throw new ExtendError("internal", {
        message: "Secure credential storage is not configured for MCP servers.",
      });
    }
    const server = this.#registry.get(id);
    if (server?.auth === "none") {
      throw new ExtendError("internal", {
        message: "A server without authentication cannot have a saved credential.",
      });
    }
    await credentials.set({ scope: "mcp", id }, secret);
    await this.#supervisor.stop(id);
    this.#applyNow();
  }

  async deleteCredential(id: string, _auth: AuthContext): Promise<boolean> {
    this.#requireServer(id);
    const credentials = this.#credentials;
    if (credentials === undefined) {
      throw new ExtendError("internal", {
        message: "Secure credential storage is not configured for MCP servers.",
      });
    }
    const deleted = await credentials.delete({ scope: "mcp", id });
    await this.#supervisor.stop(id);
    this.#applyNow();
    return deleted;
  }

  #requireServer(id: string): McpServerRecord {
    const server = this.#registry.get(id);
    if (server === undefined) {
      throw new ExtendError("internal", {
        message: `MCP server "${id}" is not installed.`,
      });
    }
    return server;
  }
}
