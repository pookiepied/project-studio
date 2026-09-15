import type { AuthContext } from "../admission/context.js";
import { ExtendError } from "../extend/errors.js";
import type { ExtensionReconciler } from "../extend/reconcile.js";
import type { SkillProblem, SkillRecord, SkillRegistry } from "../extend/skills/registry.js";
import {
  GLOBAL_SCOPE,
  conversationScope,
  projectScope,
  type ExtensionSelectionStore,
  type Resolution,
  type ResolutionContext,
  type Scope,
} from "../extend/selection.js";
import type { McpReadContext, McpScopeReading } from "./mcp-management.js";

/**
 * The one mutation surface for installed skills.
 *
 * There is exactly one mutation, because a skill has exactly one thing a
 * person decides about it: whether it is on, and at which scope. Installing
 * is copying a folder and uninstalling is deleting it; nothing here writes
 * to disk, and a route that could would be the model's write tool by another
 * door.
 *
 * The read context and the scope reading are the MCP ones, imported rather
 * than redeclared: a settings row asks the same three questions of a skill
 * as of a server — what did this scope decide, what does the chain resolve
 * to, and where was that decided — and a second vocabulary for the same
 * three answers would be the first thing a shared settings control tripped
 * over.
 */

export type SkillReadContext = McpReadContext;
export type SkillScopeReading = McpScopeReading;

export interface SkillManagementOptions {
  readonly registry: SkillRegistry;
  readonly selection: ExtensionSelectionStore;
  readonly extensions: Pick<ExtensionReconciler, "changed">;
  /** This harness's own project; see `McpManagementOptions.projectId`. */
  readonly projectId: string;
  readonly conversationProject?: (conversationId: string) => string | undefined;
}

/** A skill as a caller sees it: the folder's facts, plus what was decided. */
export type SkillView = SkillRecord & {
  readonly enabledByDefault: boolean;
  readonly project?: SkillScopeReading;
  readonly conversation?: SkillScopeReading;
};

/** Everything the HTTP surface needs, and nothing else. */
export interface SkillAdministration {
  list(context?: SkillReadContext): readonly SkillView[];
  /** The folders that looked like skills and were not, for the settings screen. */
  problems(): readonly SkillProblem[];
  get(id: string, context?: SkillReadContext): SkillView | undefined;
  /** `null` clears the decision at this scope, so the wider scope applies. */
  setEnabled(scope: Scope, id: string, enabled: boolean | null, auth: AuthContext): void;
}

export class SkillManagementService implements SkillAdministration {
  readonly #registry: SkillRegistry;
  readonly #selection: ExtensionSelectionStore;
  readonly #extensions: Pick<ExtensionReconciler, "changed">;
  readonly #projectId: string;
  readonly #conversationProject:
    | ((conversationId: string) => string | undefined)
    | undefined;

  constructor(options: SkillManagementOptions) {
    this.#registry = options.registry;
    this.#selection = options.selection;
    this.#extensions = options.extensions;
    this.#projectId = options.projectId;
    this.#conversationProject = options.conversationProject;
  }

  list(context: SkillReadContext = {}): readonly SkillView[] {
    // Listed once, so the problems answer beside it is from the same scan.
    return this.#registry.list().map((record) => this.#view(record, context));
  }

  problems(): readonly SkillProblem[] {
    return this.#registry.problems();
  }

  get(id: string, context: SkillReadContext = {}): SkillView | undefined {
    const record = this.#registry.get(id);
    return record === undefined ? undefined : this.#view(record, context);
  }

  setEnabled(scope: Scope, id: string, enabled: boolean | null, _auth: AuthContext): void {
    if (this.#registry.get(id) === undefined) {
      throw new ExtendError("not_installed", { message: `No skill named "${id}" is installed.` });
    }
    const key = { kind: "skill", extensionId: id, scope } as const;
    if (enabled === null) this.#selection.clear(key);
    else this.#selection.set(key, enabled);
    // Nothing runs for a skill, so there is no fast path to fire; the mark
    // is kept so the reconciler's generation stays honest about what changed.
    this.#extensions.changed();
  }

  /** The same chain `McpManagementService.#resolutionContext` builds, for the same reason. */
  #resolutionContext(context: SkillReadContext): ResolutionContext {
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

  #reading(extensionId: string, scope: Scope, resolution: Resolution): SkillScopeReading {
    return {
      decision: this.#selection.decisionAt({ kind: "skill", extensionId, scope }) ?? null,
      resolved: resolution.enabled,
      ...(resolution.decidedAt === undefined ? {} : { decidedAt: resolution.decidedAt }),
    };
  }

  #view(record: SkillRecord, context: SkillReadContext): SkillView {
    const resolution = this.#selection.resolve("skill", record.id, this.#resolutionContext(context));
    return {
      ...record,
      enabledByDefault:
        this.#selection.decisionAt({ kind: "skill", extensionId: record.id, scope: GLOBAL_SCOPE }) ??
        false,
      ...(context.projectId === undefined
        ? {}
        : { project: this.#reading(record.id, projectScope(context.projectId), resolution) }),
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
}
