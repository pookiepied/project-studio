import { dirname } from "node:path";

import type { ResourceKind } from "./matcher.js";

/**
 * The choices offered when the user is asked to approve something.
 *
 * The problem this solves: without it, "always allow" means "always allow this
 * one file", and a real session accumulates one grant per file touched. The
 * mechanism for a wider grant already exists — patterns match, and the store
 * prefers the narrowest — but nothing produced a pattern to store.
 *
 * The decision is *who* produces it. Here, always: the harness generates a small
 * ladder of candidates from the resolved resource, and the approver picks one by
 * id. An approver cannot invent a pattern, so no dialog can ever grant something
 * wider than what it displayed. That is a property of the type, not a rule a
 * future screen has to remember.
 *
 * See ADR 0015.
 */

export interface PermissionScope {
  /** Stable across releases; a UI may key layout off it. */
  readonly id: string;
  /** Shown to the user verbatim. Plain language, no globs. */
  readonly label: string;
  /** What it covers, concretely — a file name, a folder name. */
  readonly detail: string;
  /** What gets stored. `undefined` means the whole capability. */
  readonly pattern: string | undefined;
}

export interface ScopeContext {
  readonly resource: string | undefined;
  readonly kind: ResourceKind;
  /** The workspace root, so no rung can reach above it. */
  readonly root: string | undefined;
}

function unify(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function lastSegment(path: string): string {
  const unified = unify(path);
  return unified.slice(unified.lastIndexOf("/") + 1) || unified;
}

/**
 * The ladder for a filesystem path: this file, its folder, the project.
 *
 * Capped at the workspace root, and the cap is the point rather than a detail.
 * A rung above the root would let one click authorize the user's home
 * directory, and there is no honest way to phrase that in a dialog.
 */
function pathScopes(resource: string, root: string | undefined): PermissionScope[] {
  const scopes: PermissionScope[] = [
    {
      id: "this-file",
      label: "Just this file",
      detail: lastSegment(resource),
      pattern: resource,
    },
  ];

  const unifiedRoot = root === undefined ? undefined : unify(root);
  const folder = unify(dirname(resource));

  // Skipped when the resource *is* the root: `dirname` would climb out of the
  // workspace, and the project rung below already covers it.
  const folderIsInsideRoot =
    unifiedRoot === undefined ||
    folder === unifiedRoot ||
    folder.startsWith(`${unifiedRoot}/`);

  if (folderIsInsideRoot && folder !== unify(resource)) {
    scopes.push({
      id: "this-folder",
      label: "This folder",
      detail: `Everything in ${lastSegment(folder)}`,
      pattern: `${folder}/**`,
    });
  }

  if (unifiedRoot !== undefined) {
    scopes.push({
      id: "this-project",
      label: "This project",
      detail: `Everything in ${lastSegment(unifiedRoot)}`,
      pattern: `${unifiedRoot}/**`,
    });
  }

  // Two rungs describing the same set is a dialog asking a question with one
  // real answer. Keeps the narrowest, which is the one listed first.
  const seen = new Set<string>();
  return scopes.filter((scope) => {
    const key = scope.pattern ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The ladder for a command: one rung, deliberately.
 *
 * `git:push` gets "this command" and nothing wider. The obvious second rung
 * would be `git:*`, and it is exactly what must not be one click away in a
 * mid-task dialog: it contains `push`, `reset`, and `clean`, so a user
 * approving a `git status` would be authorizing history rewrites.
 *
 * Approving a whole family is a real thing to want, and it belongs in settings —
 * authored deliberately, read in full, away from a waiting agent.
 */
function commandScopes(resource: string): PermissionScope[] {
  return [
    {
      id: "this-command",
      label: "This command",
      detail: resource,
      pattern: resource,
    },
  ];
}

/**
 * What the user may choose from, narrowest first.
 *
 * Order is load-bearing: a UI rendering these in order puts the safest option
 * where a hurried click lands.
 */
export function offerScopes(context: ScopeContext): readonly PermissionScope[] {
  if (context.resource === undefined) {
    // Nothing about the arguments narrows what this reaches, so the only honest
    // description is the capability itself.
    return [
      {
        id: "this-capability",
        label: "This tool",
        detail: "Every use of it",
        pattern: undefined,
      },
    ];
  }

  return context.kind === "command"
    ? commandScopes(context.resource)
    : pathScopes(context.resource, context.root);
}

/**
 * Resolves a chosen id to the pattern to store.
 *
 * An id we did not offer resolves to the narrowest scope rather than failing the
 * call. A broken or outdated approver is then merely repetitive, never
 * over-permissive — and the caller reports it, so it does not stay invisible.
 */
export function resolveScope(
  offered: readonly PermissionScope[],
  scopeId: string | undefined,
): { readonly scope: PermissionScope | undefined; readonly recognized: boolean } {
  const narrowest = offered[0];

  if (scopeId === undefined) return { scope: narrowest, recognized: true };

  const chosen = offered.find((scope) => scope.id === scopeId);
  return chosen === undefined
    ? { scope: narrowest, recognized: false }
    : { scope: chosen, recognized: true };
}
