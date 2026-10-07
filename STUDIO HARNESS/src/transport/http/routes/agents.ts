import { Hono } from "hono";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import type { RegisteredAgent } from "../../../agents/definitions/registry.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";

/**
 * The agent roster, read-only (S5.3's Settings surface).
 *
 * One route that answers "what agents does this harness have", straight
 * from the registry — the same list the `useSubagent` mount, the gate's
 * per-acting-agent filter, and the scope substitution resolve through, so
 * a pane showing it cannot drift from what actually runs. The honest-list
 * rule is the route's own shape: a delegate row carries its whole policy
 * (the fields exist to be read), and a conversation or background row
 * carries none of them, because `studio` composes its surface from live
 * per-conversation state and the background three hold nothing — showing
 * a static list for either would be a second, competing source of the
 * same answer.
 *
 * Nothing here is editable, and the route serves no detail a definition
 * does not already state: definitions are code, reviewed like the skills
 * folders they sit beside (the plan's Part V), so the roster is a window,
 * not a form.
 *
 * Guarded by `agent:run`, the conversation router's own scope: the roster
 * is the run surface's self-description, and a client trusted to run the
 * agent is trusted to see what the agent is.
 */
export function createAgentRoutes(
  registry: { list(): readonly RegisteredAgent[] },
): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.AGENT_RUN));

  routes.get("/", (context) =>
    context.json(
      registry.list().map((entry) => {
        const definition = entry.definition;
        const delegate = definition.kind === "delegate";
        return {
          agentName: definition.identity.agentName,
          title: definition.identity.title,
          description: definition.identity.description,
          kind: definition.kind,
          model: definition.model,
          // The delegate-only policy, present only for the kind it is
          // policy FOR. An absent field is the honest answer for an agent
          // whose surface is not its own to state.
          ...(delegate
            ? {
                tools: definition.tools,
                skills: definition.skills,
                permissions: definition.permissions,
              }
            : {}),
          durability: definition.durability,
        };
      }),
    ),
  );

  return routes;
}
