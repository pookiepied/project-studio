import { Hono } from "hono";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import type { GrantFilters, PermissionGrantsView } from "../../../permissions/grant-store.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";

/**
 * The stored grants — the approvals the person has already given — listed so
 * they can be seen and revoked so they can be taken back. This is the other
 * half of the promise the grant store's header makes: an approval the user
 * cannot see or take back is worse than never having asked. The pending
 * routes beside it answer "may I"; these answer "what did I already say" —
 * one surface per question, kept apart so neither grows the other's
 * semantics, the same split the approval broker and the question broker draw.
 *
 * Guarded by the `approval` scope, the same one the pending routes hold.
 * Giving a permission and withdrawing it are one act seen from its two ends,
 * so there is no second scope vocabulary to mint; a client trusted to answer
 * an ask is trusted to see what its answers have accumulated into.
 */
export function createGrantsRoutes(
  grants: PermissionGrantsView,
): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.APPROVAL));

  routes.get("/", (context) => {
    // A query parameter names a column to conjoin; an absent one says
    // nothing about that column. Anything else about the listing — the
    // revoked rows' absence, the ordering — is the store's own rule and is
    // not re-decided here.
    const agentId = context.req.query("agentId");
    const projectId = context.req.query("projectId");
    const conversationId = context.req.query("conversationId");
    const filters: GrantFilters = {
      ...(agentId === undefined ? {} : { agentId }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(conversationId === undefined ? {} : { conversationId }),
    };
    return context.json(grants.list(filters));
  });

  routes.delete("/:id", (context) =>
    grants.revoke(context.req.param("id"))
      ? context.body(null, 204)
      : context.json(
          { error: "That grant does not exist or is already revoked." },
          404,
        ),
  );

  return routes;
}
