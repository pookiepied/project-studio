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
      // A global (no-project) chat has no workspace to be "inside": the user is
      // intentionally working machine-wide. Offer a one-time global-access grant
      // rather than a hard block. A bounded project, by contrast, must never
      // silently reach outside its root - that stays a deny.
      if (ctx.localContext === "global") {
        return prompt(
          "global_access_required",
          `This chat isn't tied to a project, so ${ctx.toolName} needs machine-wide file access. ` +
            `Ask the user to grant global access, or open a project folder to scope the work.`
        );
      }
      return deny(
        "out_of_roots",
        `Path "${outside[0].raw}" is outside the granted workspace. ` +
          `Operate within the open project, or ask the user to grant broader access.`
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
 * Servers whose tools operate on the local filesystem and must respect
 * workspace roots. Computer Use acts on the OS/screen, not project files, so it
 * is governed by enablement + risk + action mode rather than path boundaries.
 */
function isRootBoundedServer(server: string): boolean {
  return server === "studio-harness";
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
