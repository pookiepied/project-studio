import type { SecureCredentialStore } from "../credentials/credential-store.js";
import type { AuthContext } from "../admission/context.js";
import { ExtendError } from "../extend/errors.js";
import type { ExtensionReconciler } from "../extend/reconcile.js";
import { McpServerRegistry, type McpServerInput, type McpServerRecord } from "../extend/mcp/registry.js";
import type { McpSupervisor } from "../extend/mcp/supervisor.js";
import { GLOBAL_SCOPE, type ExtensionSelectionStore, type Scope } from "../extend/selection.js";
import type { PermissionGrantStore } from "../permissions/grant-store.js";

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
}

/** A server as a caller sees it: what was configured, plus what it is doing. */
export type McpServerView = McpServerRecord & {
  readonly status: ReturnType<McpSupervisor["status"]>;
  /** Whether the user's default has this server on. Not per project. */
  readonly enabledByDefault: boolean;
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
  list(): readonly McpServerView[];
  get(id: string): McpServerView | undefined;
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

  constructor(options: McpManagementOptions) {
    this.#registry = options.registry;
    this.#grants = options.grants;
    this.#selection = options.selection;
    this.#supervisor = options.supervisor;
    this.#extensions = options.extensions;
    this.#credentials = options.credentials;
  }

  /** Configuration joined with live status — the join belongs here, not in a route. */
  #view(record: McpServerRecord): McpServerView {
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
    };
  }

  list(): readonly McpServerView[] {
    return this.#registry.list().map((record) => this.#view(record));
  }

  get(id: string): McpServerView | undefined {
    const record = this.#registry.get(id);
    return record === undefined ? undefined : this.#view(record);
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
