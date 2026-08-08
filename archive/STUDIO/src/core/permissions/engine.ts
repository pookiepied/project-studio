/**
 * Permission engine - the single decision point for every local MCP tool call.
 *
 * `evaluateToolCall` is a PURE function: trusted context in, a decision out. It
 * touches no storage, React, or network - callers assemble the
 * {@link PermissionContext} from conversation state + `grants.ts` and act on the
 * returned {@link PermissionDecision}. This is the enforcement heart the whole
 * system funnels through, so the security guarantees live here:
 *
 *   1. Cloud conversations can never run local tools.
 *   2. A disabled MCP server can never run.
 *   3. A path tool can never escape its granted root(s) without a global grant.
 *   4. An untrusted workspace can never take mutating actions.
 *   5. High-risk actions confirm even under autonomy (hard floor).
 *
 * None of these read a value the model supplied - `args` is inspected only to
 * discover a tool's target path, and the *allowed* roots come from trusted
 * state. The model cannot widen its own scope by changing a request field.
 *
 * The decision table is driven by `toolRisk.ts` so classification stays in one
 * place; adding a tool there automatically gives it correct enforcement, and an
 * unknown tool fails safe to "high-risk".
 */

import type {
  GrantScope,
  PermissionContext,
  PermissionDecision,
  PermissionDenyCode,
  PermissionPromptCode,
} from "./model";
import { getToolRisk, RISK_CLASS_META } from "./toolRisk";
import { isLocalMcpServer } from "./scope";
import { extractTargetPaths, isPathWithinRoots, resolveAgainst } from "./paths";

// ---------------------------------------------------------------------------
// Decision builders
// ---------------------------------------------------------------------------

function decide(ctx: PermissionContext): PermissionDecision {
  const riskClass = getToolRisk(ctx.toolName);
  const meta = RISK_CLASS_META[riskClass];

  const deny = (code: PermissionDenyCode, reason: string): PermissionDecision => ({
    outcome: "deny",
    code,
    reason,
    riskClass,
  });
  const prompt = (code: PermissionPromptCode, reason: string): PermissionDecision => ({
    outcome: "prompt",
    code,
    reason,
    riskClass,
    offeredScopes: offeredScopesFor(ctx),
  });
  const allow = (): PermissionDecision => ({
    outcome: "allow",
    code: "ok",
    reason: "",
    riskClass,
  });

  // -- 1. Cloud scope - local machine tools are local-mode only ------------
  if (ctx.chatMode === "cloud" && isLocalMcpServer(ctx.server)) {
    return deny(
      "cloud_scope",
      `${ctx.server} runs on your machine and is only available in local mode. ` +
        `Tell the user local file/computer access requires a local conversation.`
    );
  }

  // -- 2. MCP enablement - a disabled server can do nothing ----------------
  if (!ctx.mcpEnabled) {
    return deny(
      "mcp_disabled",
      `The ${ctx.server} server is disabled. Ask the user to enable it in Settings.`
    );
  }

  if (
    ctx.localContext === "global" &&
    isRootBoundedServer(ctx.server) &&
    !ctx.hasGlobalGrant &&
    requiresGlobalMachineGrant(ctx.toolName)
  ) {
    return prompt(
      "global_access_required",
      `This chat isn't tied to a project, so ${ctx.toolName} needs machine-wide access. ` +
        `Ask the user to grant global access, or open a project folder to scope the work.`
    );
  }

  // -- 3. Placement - a path tool must stay inside its granted root(s) ------
  // Skipped when a global grant is active (access is machine-wide by consent).
  if (!ctx.hasGlobalGrant && isRootBoundedServer(ctx.server)) {
    const outside = extractTargetPaths(ctx.toolName, ctx.args)
      .map((p) => ({ raw: p, resolved: resolveAgainst(ctx.workspaceRoot, p) }))
      .filter(({ resolved }) => !isPathWithinRoots(resolved, ctx.grantedRoots));

    if (outside.length > 0) {
      // Reaching outside the granted root(s) — offer a machine-wide grant rather
      // than a hard block, in BOTH contexts:
      //   - A global (no-project) chat has no workspace to be "inside": the user
      //     is intentionally working machine-wide.
      //   - A project chat that needs to touch something outside its folder (e.g.
      //     clone a repo elsewhere) previously hit a dead-end deny with no way to
      //     grant. It now surfaces the same full-screen machine-wide grant gate;
      //     the model cannot self-escalate (the grant is an explicit user action),
      //     and once granted this rule is skipped (hasGlobalGrant short-circuit).
      return prompt(
        "global_access_required",
        ctx.localContext === "global"
          ? `This chat isn't tied to a project, so ${ctx.toolName} needs machine-wide file access. ` +
              `Ask the user to grant global access, or open a project folder to scope the work.`
          : `Path "${outside[0].raw}" is outside the open project, so ${ctx.toolName} needs machine-wide ` +
              `access to reach it. Ask the user to grant machine-wide access, or keep the work inside the project.`
      );
    }
  }

  // -- 4. Trust - untrusted project workspaces cannot mutate ---------------
  if (
    ctx.chatMode === "local" &&
    ctx.localContext === "project" &&
    ctx.workspaceTrust !== "trusted" &&
    meta.mutating
  ) {
    return deny(
      "untrusted_workspace",
      `This workspace is not trusted, so ${ctx.toolName} (a mutating action) is blocked. ` +
        `Ask the user to trust the workspace to enable changes.`
    );
  }

  // -- 5. Approval - does this action need a prompt in the current mode? ----
  const requiresApproval =
    ctx.actionMode === "autonomous"
      ? meta.autonomousRequiresApproval // only the high-risk hard floor
      : meta.reviewRequiresApproval;    // review: every sensitive/mutating action

  if (!requiresApproval) return allow();

  // A prior session/workspace/global approval satisfies the requirement.
  if (ctx.existingGrants.has(ctx.toolName)) return allow();

  return prompt(
    ctx.actionMode === "autonomous" ? "autonomous_floor" : "review_required",
    `${ctx.toolName} (${meta.label}) needs your approval before running.`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Local servers that do NOT operate on project files, so they are governed by
 * enablement + risk + action mode rather than workspace-path boundaries:
 *   - computer-use     — acts on the OS/screen, not the filesystem
 *   - mcp-management    ┐ first-party control-server tools that manage MCP/skill
 *   - skill-management  │ configuration, not arbitrary project files
 *   - skill-execution  ┘
 */
const NON_ROOT_BOUNDED_LOCAL_SERVERS: ReadonlySet<string> = new Set([
  "computer-use",
  "mcp-management",
  "skill-management",
  "skill-execution",
]);

/**
 * Servers whose tools must respect workspace roots. Any machine-bound server is
 * root-bounded unless it is a known non-filesystem server (above). This means a
 * third-party local MCP of unknown capability fails safe to being confined to
 * the workspace, rather than silently reaching anywhere on disk — the boundary
 * check itself is a no-op unless a tool actually carries a path argument
 * (see extractTargetPaths), so exempting nothing here is cheap and safe.
 */
function isRootBoundedServer(server: string): boolean {
  return isLocalMcpServer(server) && !NON_ROOT_BOUNDED_LOCAL_SERVERS.has(server);
}

function requiresGlobalMachineGrant(toolName: string): boolean {
  return toolName !== "ask_user_question" && toolName !== "sleep";
}

/**
 * Grant scopes to offer in the approval prompt, widening with context.
 *   - Every prompt offers "once" (this call) and "session" (this conversation).
 *   - A trusted project chat additionally offers "workspace" ("always allow
 *     here"), a durable per-folder grant. Global/untrusted contexts do not - a
 *     no-project chat has no folder identity to bind a persistent grant to.
 */
function offeredScopesFor(ctx: PermissionContext): GrantScope[] {
  const canPersistToWorkspace =
    ctx.localContext === "project" &&
    ctx.workspaceTrust === "trusted" &&
    !!ctx.workspaceRoot;
  return canPersistToWorkspace
    ? ["once", "session", "workspace"]
    : ["once", "session"];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Evaluate a single tool call against trusted permission state.
 * Returns `allow` (run now), `prompt` (ask the user, then re-check the grant),
 * or `deny` (block; surface `reason` to the model as a structured error).
 */
export function evaluateToolCall(ctx: PermissionContext): PermissionDecision {
  return decide(ctx);
}
