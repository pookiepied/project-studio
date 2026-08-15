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
