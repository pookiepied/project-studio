# Task 60: the dial that starts in the middle

## What this changes

Studio's reasoning control loses its "Default" step. The dial offers only the
levels a model actually supports, and it rests on medium. Every turn sent to a
reasoning model now carries an explicit level. A model that does not reason at
all keeps sending no reasoning parameter, exactly as it does today.

Nothing about the model picker changes. This is the reasoning dial only.

## Why, in one pass

"Default" meant "send no level and let the provider decide". Read the adapters
in `@earendil-works/pi-ai` and that is not what happens.

The chain today: the picker's choice reaches the conversation row through
`createTurnSettingsMiddleware`, the render reads the row, `studioThinkingLevel`
maps `"default"` to `"off"` through `runThinkingLevelForChoice`, Flue passes it
to the agent loop, and `pi-agent-core/dist/agent.js:286` turns `"off"` into
`reasoning: undefined`. So far so good - that really is "say nothing".

What each adapter does with that absence is where it falls apart:

- Omits the parameter, as intended: OpenAI Responses, Azure Responses, Codex
  Responses, OpenAI Completions (plain), Bedrock, Mistral, `ant-ling`.
- Sends an explicit "off", but checks `model.thinkingLevelMap?.off !== null`
  first, so a catalog entry can opt out: Anthropic, DeepSeek, OpenRouter,
  `string-thinking`. The harness already uses this escape for OpenRouter in
  `applyOpenRouterDefaultReasoning` (`src/models/local/runtime.ts`).
- Sends an explicit "off" with no escape hatch at all: Google Generative AI,
  Google Vertex, `zai`, `qwen`, `qwen-chat-template`, `together`.

That last group is the bug the user reported. On Google, `!options?.reasoning`
sends `thinking: { enabled: false }`, which becomes `thinkingBudget: 0` on
Gemini 2.x and the lowest available level on Gemini 3, which cannot be
disabled at all. Gemini's own default is thinking on. So "Default" was quietly
turning thinking down, and because `includeThoughts` is only set on the enabled
branch, no thinking was ever shown either.

Every one of these produces a valid request. Nothing errors. There is no
provider that requires the parameter. That is exactly why it went unnoticed.

Two fixes were considered and rejected. Patching the six adapters means
carrying vendored patches and re-auditing all eleven on every pi upgrade, for
behaviour upstream has no test defending. A table of per-model defaults means
maintaining guesses - pi itself has no such table, `Model` in
`pi-ai/dist/types.d.ts` has no default field, and pi's own CLI never sends a
level at all - and its fallback would have been medium anyway.

Resting on medium keeps every request on the explicit-level path that all
eleven adapters are built and tested for. No patch, no table, nothing to
re-audit. The user loses only the ability to ask for silence, which never
reliably meant anything.

## The resting rule

**Medium when the model supports it. Otherwise the nearest supported level in
`REASONING_LEVELS` order, preferring the lower one on a tie.**

Anchor on medium, not on the midpoint of the model's own list. A model
exposing `xhigh` and `max` has a longer list, and a list-midpoint rule would
rest such a model at high - quietly more expensive, and not what "the everyday
balance" says on the label. Anchoring on medium keeps the resting point stable
no matter how many exotic levels a model happens to expose.

`minimal`, `low`, `medium` and `high` are present unless a model marks them
unsupported, so the fallback is rare - but it is reachable, because any level
can be mapped to null, and it must be written rather than assumed.

## Work

### Harness

- `src/contracts/models.ts`. `runThinkingLevelForChoice` stops answering
  `"off"` for a stored `"default"`. `"off"` survives as one thing only: the
  value for a model that does not reason. Resolve `"default"` to the resting
  level using the rule above; the resolver needs the model's supported levels,
  so it takes them as an argument rather than guessing.
- The docblock above `runThinkingLevelForChoice` currently argues at length
  that absence must stay absence, and lists what each protocol does with it.
  Rewrite it. State the new rule, state that absence was abandoned, and say
  why - name the six adapters that answer silence by disabling thinking. The
  existing prose is accurate about the protocols and wrong about the
  conclusion; keep the facts, replace the conclusion.
- `src/agents/studio.ts`. `studioThinkingLevel` resolves through the new rule.
  It has the model reference from the conversation row but not the model
  record, and `ModelCatalog` is async while the render is synchronous. The
  local runtime already composes the Pi catalog synchronously - that is where
  `applyOpenRouterDefaultReasoning` mutates it - so expose a synchronous
  "supported levels for this model reference" lookup from there and feed the
  resolver. Do not make the render async.
- `reasoningChoiceOr` keeps accepting `"default"` from stored rows. Rows
  written before this change resolve to the resting level on read. No
  migration: migration 21 is applied and frozen, and nothing about the column
  changes.

### Frontend

- `src/shell/chrome/TurnMenu.tsx`. `reasoningSteps` drops its `'default'`
  entry and returns the model's levels alone. `reasoningLabel` loses both
  `'default'` branches. The `StepSlider` fallback on line 355 currently falls
  back to `'default'` when the choice is not among the steps; it falls back to
  the resting level instead.
- `src/stores/workspace/WorkspaceProvider.tsx:75` and
  `src/platform/harness/conversation.ts:488` both rest on `'default'`. They
  rest on the resolved level instead. Note that the frontend does not know a
  model's levels at every one of those points - if resolving there is not
  possible, the honest answer is to keep the stored value absent and let the
  harness resolve it, rather than writing a level the user did not pick.
  Decide which, and say which in the report.
- `src/domain/models/types.ts`. `ReasoningChoice` includes `'default'` today.
  Whether it stays as a read-only legacy value or goes entirely depends on the
  decision above. `REASONING_LEVEL_NOTES` is unchanged.
- A model with no levels keeps its control hidden. That check already exists
  (`model.reasoningLevels.length === 0`) and must keep working.

## Tests

Every one of these fails before the change and passes after. Run each negative
control and record what it said.

- The resolver: medium for a model that has it; the nearest lower level for a
  model whose list omits medium; and the tie case, named explicitly.
- A non-reasoning model still sends no reasoning parameter.
- A stored `"default"` row resolves to the resting level rather than `"off"`.
- Per adapter family, assert what reaches the wire for a resting turn. The
  Google one is the point of the task: it must carry a real `thinkingConfig`
  with `includeThoughts`, not `thinkingBudget: 0`. Anthropic must carry
  `thinkingEnabled: true`. An OpenAI-family model must carry an explicit
  `reasoning_effort` rather than omitting it.
- The dial offers no "Default" step, and rests on medium for a model that has
  medium.

## Constraints

The standing rules apply: no `any`, no non-const `as`, no non-null `!`, UTF-8
without BOM, American English, preserve each line's existing line ending, no
scripted search-and-replace across files. Do not run `git checkout`, `switch`,
`stash`, `reset`, `clean`, `commit`, or `rebase`. `Backend/`, `docs/`,
`documentation/`, `prompts/` and `opencode/` are read-only except this task's
own report file. Run vitest suites one at a time, and `pnpm build` before the
harness suite.

Do not patch anything in `node_modules`. If the change appears to need a
vendored patch, stop and say so in the report - it would mean the premise of
this task is wrong.
