import * as v from "valibot";

import { modelIdSchema, reasoningChoiceSchema } from "./models.js";

/**
 * Agent identity.
 *
 * `ExecutionScope.agentId` names **the agent**, not the conversation it is
 * having — its own doc comment says so, and the grant store's `agent_id`
 * column exists beside `conversation_id` and `project_id` for that reason.
 *
 * Flue's initializer receives an `id` that is the agent *instance*, one per
 * conversation thread. Passing it as `agentId` put a conversation identity in
 * the agent field, which left `duration: "always"` unable to outlive the
 * conversation that granted it and made it indistinguishable from
 * `duration: "conversation"` (issue #69). The constant below is what an agent
 * is called; the thread id belongs in `conversationId`.
 *
 * There is one agent today. That is exactly why this is worth naming rather
 * than inlining: with a single agent the two readings of `agentId` produce
 * identical behaviour, so nothing would catch the confusion returning.
 */
export const STUDIO_AGENT_ID = "studio";

/**
 * The turn settings a submission may carry beside its message.
 *
 * A submission body cannot carry these through to the run: Flue parses every
 * direct payload through `DirectAgentPayloadSchema` (`message` and `images`,
 * unknown keys stripped), and the agent initializer receives only `{ id, env }`.
 * These two fields are therefore consumed at our own admission boundary - the
 * middleware in `transport/http/middleware/turn-settings.ts` reads them, writes
 * them to the conversation index, and lets Flue strip them - so the durable
 * row is settled BEFORE the run's initializer reads it. Neither field is
 * required: absent means the conversation's stored settings stand.
 *
 * `modelId` is the local runtime's `<provider>/<model>` reference, the same
 * vocabulary the conversation index stores and the run initializer resolves.
 * `reasoningLevel` is a level or "default"; "default" means the provider's own
 * behaviour and is stored verbatim rather than folded into a synonym.
 */
export const submissionTurnSettingsSchema = v.object({
  modelId: v.optional(v.nullable(modelIdSchema)),
  reasoningLevel: v.optional(v.nullable(reasoningChoiceSchema)),
});

export type SubmissionTurnSettings = v.InferOutput<typeof submissionTurnSettingsSchema>;
