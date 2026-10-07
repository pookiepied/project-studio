import { GENERAL_AGENT_ID } from "../../contracts/agents.js";
import { GENERAL_PROMPT } from "../../context/general-prompt.js";
import { validateAgentDefinition } from "./registry.js";

/**
 * The hands-on delegate's definition (ADR 0058 D11, Stage 5) — the
 * `GeneralSubagent` equivalent, Studio-shaped.
 *
 * The allowlist is the D11 row's "natives minus destructive" made concrete,
 * and the concrete list is narrower than the row's shorthand because the
 * shorthand answers one question (what is too dangerous) while an allowlist
 * has to answer two (what is dangerous, and what is not this delegate's
 * job). Present: the working set — the five filesystem and repository
 * surfaces that read, the two that write (`write`, `edit`), the runner
 * (`shell`), and the two web readers. Absent, by category:
 *
 * - **The destructive pair** — `delete`, `move` — the D11 row's recorded
 *   exclusion. A delegated task that needs something gone is a task the
 *   parent does itself; nothing the child can say makes a deletion the
 *   person approved of less.
 * - **The conversation-keyed mutators** — `discover`, `request_folder`,
 *   `jobs`. All three write into sets the parent conversation owns
 *   (adoptions, folder trust, the job registry) that the child cannot see
 *   or clean up — the two-writer bug ADR 0029 and D4's withhold exist for.
 *   `discover` would be refused by name even if named; these two are kept
 *   out by the same principle rather than a second rule with the same
 *   shape.
 * - **The interactive family** — `ask_user_question`, `plan`,
 *   `library_search`, `library_keep`, `studio_image`, `studio_video`,
 *   `ocr`. The ask tool parks a run on a question the approval UX does not
 *   yet attribute to a delegate, the plan tool is the other delegate's
 *   whole job (D11's `plan` row), and the library and media families write
 *   person-curated or billed state a background task has no business
 *   editing. Naming one of these later is an allowlist line away, each
 *   with its own reasoning at that moment.
 *
 * `mcpNamespaces: ["*"]` is the wildcard, and it is the honest form of the
 * D11 row's "parent's adopted, allowlisted": MCP namespaces are
 * `mcp:<server id>`, the server id is user-minted, and a definition that
 * named one would behave differently on every machine. The star says "the
 * namespaces this conversation has adopted, and nothing more" — the gate
 * still holds the conversation's enablement chain and its adopted set, so
 * the star widens nothing the person did not switch on. A delegate that
 * must not touch MCP at all names `[]`, as `explore` does.
 *
 * `maxEffects` is the whole vocabulary, which reads odd beside `explore`'s
 * `["read"]` and is the point: general's permission story is ask-based, not
 * refusal-based. Nothing it holds is refused outright — the dangerous pair
 * is withheld by the allowlist above — and everything reachable stops at
 * the kernel, under this agent's own id, because `mode: "ask"` is the
 * delegate's own consent default: a delegated task asks before it changes
 * or runs anything even when the parent conversation runs in Auto. Writes
 * and executes alike are reachable (the D11 row's "`write` allowed,
 * `execute` asks" — allowed meaning in scope and approvable, as against
 * `explore`, where a write is refused at the ceiling whatever the grants).
 * Each ask renders under `general`'s agent id, and an answered one becomes
 * a grant keyed to `general` — the isolation property the live tests
 * assert.
 *
 * The module imports the definition, never the reverse; the function-value
 * pairing the `useSubagent` mount needs lives in `index.ts`.
 */
export const generalDefinition = validateAgentDefinition({
  identity: {
    agentName: GENERAL_AGENT_ID,
    title: "General",
    description:
      "Hands-on work: writes and edits files, runs commands, and carries out a change end to end. Use it for work that would flood this conversation with intermediate output — scaffolding, bulk edits, setup.",
  },
  kind: "delegate",
  instructions: GENERAL_PROMPT,
  // Inherits the conversation's settled model, for the same reason the
  // explorer does: the parent already chose the model it trusts with its
  // own work, and a delegate that silently downgraded would surprise the
  // person who is about to approve its writes.
  model: { inherit: true },
  tools: {
    natives: ["read", "write", "edit", "glob", "grep", "git", "shell", "web_search", "fetch"],
    mcpNamespaces: ["*"],
  },
  skills: { ids: [] },
  permissions: {
    maxEffects: ["read", "write", "execute", "network"],
    // The delegate's own consent default (the contract's words): when no
    // grant and no rule has spoken, a default `ask` asks — under this
    // agent's id, even in an Auto conversation. A delegated task is work
    // the person handed off, not attention they withdrew.
    mode: "ask",
  },
  // The human-wait ceiling, not the explore one: `mode: "ask"` means a run
  // legitimately parks on an approval, which is Studio.durability's exact
  // reasoning for its hour — what this bound covers is waiting for a
  // person, and every tool call is bounded far more tightly beside it.
  durability: { maxAttempts: 3, timeoutMs: 3_600_000 },
});
