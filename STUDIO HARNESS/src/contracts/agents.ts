import * as v from "valibot";

import { modelIdSchema, reasoningChoiceSchema } from "./models.js";
import { executionModeSchema } from "../permissions/mode.js";

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
 * There is one conversation agent. That is exactly why this is worth naming
 * rather than inlining: with a single agent the two readings of `agentId`
 * produce identical behaviour, so nothing would catch the confusion
 * returning.
 */
export const STUDIO_AGENT_ID = "studio";

/**
 * The automatic titling agent, named for the same reason.
 *
 * Its module is `agents/title.ts`, so the basename below is also the name
 * Flue discovers it under and the stream prefix it owns
 * (`agents/title/<conversation id>`). The module exports no `route`, which is
 * what keeps it off the HTTP surface entirely: Flue only exposes agents that
 * export a route handler, so the only caller that can reach this agent is
 * this harness, in process, through `dispatch()`. A person can never start a
 * conversation with it, and no client can address it over HTTP.
 */
export const TITLE_AGENT_ID = "title";

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
 *
 * `permissionMode` is the execution mode the turn is sent under, in the
 * harness's own vocabulary (`manual` / `auto-edit` / `full-auto`) - the one
 * spelling every wire value is validated against, with no translation before
 * it. It is a consent, so it settles into the index like the other two:
 * before the run is admitted, so the posture the run is decided under is the
 * one the sender chose.
 */
export const submissionTurnSettingsSchema = v.object({
  modelId: v.optional(v.nullable(modelIdSchema)),
  reasoningLevel: v.optional(v.nullable(reasoningChoiceSchema)),
  permissionMode: v.optional(executionModeSchema),
});

export type SubmissionTurnSettings = v.InferOutput<typeof submissionTurnSettingsSchema>;
