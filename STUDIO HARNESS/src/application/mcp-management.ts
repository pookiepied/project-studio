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
    this.#credentials = options.credentials;
    this.#projectId = options.projectId;
    this.#conversationProject = options.conversationProject;
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
    const after = this.#registry.save(input);

    if (before !== undefined && McpServerRegistry.reachChanged(before, after)) {
      this.#grants.revokeNamespace(McpServerRegistry.namespaceOf(input.id));
    }

    this.#extensions.changed();
    return this.#view(after);
  }

  async remove(id: string, _auth: AuthContext): Promise<boolean> {
    const server = this.#registry.get(id);
    if (server === undefined) return false;

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
    this.#extensions.changed();
    return true;
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
    this.#extensions.changed();
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
    this.#extensions.changed();
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
    this.#extensions.changed();
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
