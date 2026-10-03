import { dispatch, type DeliveredMessageInput } from "@flue/runtime";

import { agentRegistry } from "./index.js";
import { AgentRegistryError } from "./registry.js";

/**
 * The one in-process dispatcher for background agents (ADR 0058 D5).
 *
 * Three modules — the titling orchestrator, the text improver, the image
 * describer — each carried the same handful of lines: resolve the agent,
 * `dispatch(Agent, { id, message })`, and let the observation bus carry the
 * answer back. This is those lines, stated once, with the registry now
 * between the caller and the agent function so a dispatch cannot name an
 * agent the harness does not know it has.
 *
 * Deliberately fire-and-forget in shape (the receipt's submissionId is
 * returned for callers that want it; the titler does not read it, and Flue
 * rejects at admission rather than here for an unknown target). The
 * observation-bus wait that each orchestrator builds around its own take-id
 * vocabulary stays where it is — that logic is per-agent (a ladder, a
 * promise, a proposal), and sharing it would be the wrong consolidation.
 *
 * **No idempotency key, and that is the recorded decision.** ADR 0033's
 * conservative rule bars automatic resend, and every caller here dispatches
 * exactly once per user-visible action; a scheduler that wants retry-on-
 * crash semantics must open the idempotency question itself (the plan
 * records the reopen condition: a path that resends a submission
 * automatically carries the key).
 */
export async function dispatchBackgroundAgent(
  agentName: string,
  id: string,
  message: DeliveredMessageInput,
): Promise<string> {
  const registered = agentRegistry.get(agentName);
  if (registered === undefined || registered.definition.kind !== "background") {
    // Names are pinned literals shared with the caller's module, so this is
    // a build-time authoring failure showing up at dispatch time - the
    // registry's own error vocabulary, not a generic "unknown agent".
    throw new AgentRegistryError(
      "invalid",
      `No background agent named "${agentName}" is registered.`,
      { agentName },
    );
  }
  const receipt = await dispatch(registered.agent, { id, message });
  return receipt.submissionId;
}
