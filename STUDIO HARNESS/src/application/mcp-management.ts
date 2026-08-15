import type { SecureCredentialStore } from "../credentials/credential-store.js";
import type { AuthContext } from "../admission/context.js";
import { ExtendError } from "../extend/errors.js";
import type { ExtensionReconciler } from "../extend/reconcile.js";
import { McpServerRegistry, type McpServerInput, type McpServerRecord } from "../extend/mcp/registry.js";
import type { McpSupervisor } from "../extend/mcp/supervisor.js";
import type { ExtensionSelectionStore } from "../extend/selection.js";
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
  setEnabled(projectId: string, id: string, enabled: boolean, auth: AuthContext): void;
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
    return { ...record, status: this.#supervisor.status(record.id) };
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

  setEnabled(
    projectId: string,
    id: string,
    enabled: boolean,
    _auth: AuthContext,
  ): void {
    this.#requireServer(id);
    this.#selection.set({ kind: "mcp", extensionId: id, projectId }, enabled);
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
