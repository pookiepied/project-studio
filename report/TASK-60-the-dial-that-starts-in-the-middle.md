# TASK 60 - The dial that starts in the middle

Brief: Studio's reasoning control loses its Default step. The dial offers only the levels a model supports and rests on medium. Every turn sent to a reasoning model carries an explicit level. A model that does not reason keeps sending no reasoning parameter.

## Implemented

### Harness

- `src/contracts/models.ts`
  - Added `restingReasoningLevel(supported)`. It returns medium when the model supports it, otherwise the nearest supported level in `REASONING_LEVELS` order, preferring the lower one on a tie. Empty means the model does not reason and answers `off`.
  - Changed `runThinkingLevelForChoice(choice, supported)` to take the model's supported levels. A stored `default`, null, or undefined resolves through the resting rule. Empty supported always returns `off`, even for an explicit stored level, so a non-reasoning model stays silent.
  - Rewrote the docblock above the resolver. It states the new rule, states that absence was abandoned, names the six adapters that answer silence by disabling thinking with no escape hatch (Google Generative AI, Google Vertex, `zai`, `qwen`, `qwen-chat-template`, `together`), and keeps the existing protocol facts about the other families.
  - Added `supportedReasoningLevels(modelId)` to `ModelProviderAdapter`.
- `src/models/local/runtime.ts`
  - Added `supportedReasoningLevels(modelId)` to `LocalRuntime` and the `createLocalRuntime` return. It reads the same Pi collection `applyOpenRouterDefaultReasoning` mutates, so the answer agrees with the request path. Null resolves through the configured target. Unknown or malformed references answer `medium` to stay on the explicit path. Only a known non-reasoning model answers empty.
  - Added the shared `reasoningLevelsForPiModel` helper (`getSupportedThinkingLevels` minus `off`, filtered to the contract vocabulary).
- `src/models/adapters/local-adapter.ts` and `test-adapter.ts` implement the new adapter method. The test source answers empty.
- `src/models/bootstrap.ts` added `bootstrappedSupportedReasoningLevels(modelId)`. It delegates to the bootstrapped local or test adapter. Before bootstrap it answers `medium`.
- `src/application/studio-runtime.ts` added `supportedReasoningLevels(modelId)` to `AgentHost` and implemented it on `StudioRuntime` through the bootstrap helper.
- `src/agents/studio.ts` changed `studioThinkingLevel(settings, supported)` to take the settings row (`modelId` plus `reasoningLevel`) and the supported levels, then feed both to the resolver. The `Studio` render reads both synchronously and stays synchronous.

`reasoningChoiceOr` still accepts stored `default`. Old rows resolve to the resting level on read. No migration.

### Frontend

- `src/domain/models/types.ts`
  - Dropped `default` from the domain vocabulary. `ReasoningChoice` is now a level. `REASONING_CHOICES` matches. `REASONING_LEVEL_NOTES` is unchanged.
  - Added `restingReasoningLevel(supported)` with the same rule as the harness (medium, else nearest, lower on tie, medium fallback for empty since the control is hidden there anyway).
- `src/domain/models/catalog.ts` simplified `reasoningChoiceNote` to levels only.
- `src/domain/session/types.ts` and `settings.ts` now carry `ReasoningChoice | null`. Null means the user has not picked a level.
- `src/stores/workspace/WorkspaceProvider.tsx` rests on null instead of `default`. Legacy `default` rows map to null on read.
- `src/platform/harness/conversation.ts` carries `reasoningLevel: string | null` through `TurnSettingsWire` and `EffectiveTurnSettings`. The no-settings fallback rests on null instead of `default`, so the harness rests it on medium.
- `src/shell/chrome/TurnMenu.tsx` drops the Default step, drops both `default` branches in the label, and falls back to the resting level when the stored choice is absent or not among the steps. The control stays hidden when `reasoningLevels.length === 0`.
- `src/features/models/library/ModelDetail.tsx` drops the Default step and shows the resting level when stored is absent.
- `src/features/models/ModelLibraryDialog.tsx` starts absent (null) and resets to absent. An untouched dial stores absent. The harness rests it.

### Decision for the two rest points

`WorkspaceProvider.tsx:75` and `conversation.ts:488` both keep the stored value absent (null) and let the harness resolve it.

The window does not know the model's levels at either point. Writing medium there would be writing a level the user did not pick. For the common case Pi would clamp it to the same answer, but for a model without medium it would clamp forward to high instead of resting low. Absent is the honest answer and the harness gives the correct resting level in all cases.

`ReasoningChoice` in the domain therefore goes entirely (no `default`). The wire mirror in `platform/harness/contracts.ts` keeps `default` for parsing old index rows. The store maps legacy `default` to null on read.

## Issues found

- The first OpenAI wire pick returned a Responses-API model, so `reasoning_effort` was undefined. The test now accepts either `reasoning_effort` (Completions) or `reasoning.effort` (Responses), both explicit medium.
- The first Anthropic wire pick returned an adaptive-thinking model (`thinking.type: adaptive`), not budget-based `enabled`. Both are the enabled branch. The test accepts either and refuses `disabled`.
- Google's adapter rejects a custom fetch, so wire capture uses Pi's own `onPayload` seam and aborts after capturing. No mock server or credential is needed.

No vendored patch was needed.

## Outcome

- Harness typecheck passes. Frontend typecheck passes. Harness build passes.
- New tests pass:
  - `tests/unit/reasoning-rest.test.ts` (10 tests): medium, nearest lower, tie named explicitly, exotic `xhigh`/`max` rests at `xhigh`, off only for empty, default resolves to resting, explicit carries verbatim.
  - `tests/unit/reasoning-wire.test.ts` (7 tests): OpenAI explicit effort, Anthropic enabled/adaptive, Google `includeThoughts` without `thinkingBudget: 0`, mute sends nothing, plus three lookup tests (known reasoning has medium, known mute empty, unknown medium).
  - `STUDIO/src/domain/models/resting.test.ts` (3 tests): frontend resting rule.
  - Updated `agent-scope.test.ts` (default rests on medium, mute stays silent), `local-byok.test.ts` (non-reasoning sends nothing), and `TurnMenu.test.tsx` (no Default step, rests on Medium, PATCH carries null when untouched).
- Full frontend suite: 76 files, 795 tests, all pass.
- Harness spot suites pass one at a time: `agent-scope`, `reasoning-rest`, `reasoning-wire`, `turn-settings`, `local-byok`, plus `model-catalog`, `model-providers`, `background-model`.

## Notes

Negative controls, each broken on purpose and restored:

- Resolver back to `default -> off`: `reasoning-rest.test.ts` fails with `expected 'off' to be 'medium'`, and the studio default-row test fails the same way.
- Resting back to first element: `reasoning-rest.test.ts` fails with `expected 'minimal' to be 'medium'`.
- Tie preferring higher: the tie test fails with `expected 'high'` where `low` was wanted (`expected "low"`, received `"high"`).
- OpenAI wire with old silence: `reasoning-wire.test.ts` fails with `expected 'off' to be 'medium'` before reaching the wire assertion.
- Dial with Default restored in `ModelDetail`: `TurnMenu.test.tsx` fails with `expected '6' to be '5'` (seven steps instead of six).

No files in `Backend/`, `docs/`, `documentation/`, `prompts/`, or `opencode/` were changed.
