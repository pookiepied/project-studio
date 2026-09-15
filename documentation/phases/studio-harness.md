# Studio Harness — phases 1 to 18

The full plan. Descriptions live in `roadmap.md` and are not duplicated here;
this is the status ledger.

---

## Phases 1–11 — implemented, under remediation

> **Frozen for feature work.** These are not being extended. Everything
> outstanding against them is consolidated in
> `../work/phases-1-11-remediation.md` — one register, 62 numbered issues.
> Do not open new work against a phase below; open an issue in the meta-task.

<sub>

| Phase | Title | State |
|---|---|---|
| ~~1–4~~ | ~~Harness foundation~~ | implemented · unverified |
| ~~5~~ | ~~Observability foundation~~ | implemented · unverified |
| ~~6~~ | ~~Provider bootstrap~~ | implemented · unverified |
| ~~7~~ | ~~Studio Gateway integration~~ | blocked · decision #13 |
| ~~8~~ | ~~Auth, credentials, local BYOK~~ | implemented · unverified |
| ~~9~~ | ~~Capability and permission kernel~~ | implemented · unverified |
| ~~10~~ | ~~Native agent tools~~ | implemented · unverified |
| ~~11~~ | ~~MCP~~ | partial · 90 items in #49–#62 |

</sub>

**None is Verified.** When the suite was first run to completion, 21 tests
failed — including every Flue integration test, because two defects on
`POST /agents/:name/:id` meant no agent submission could succeed. A phase whose
integration tests could not have passed is not verified, whatever its checklist
says. They are promoted only when the meta-task closes.

Phase 7.5 in `roadmap.md` was an architecture review, not a delivery phase. Its
findings are meta-task issues #4–#8 and #19–#24.

---

## Phases 12–18 — the forward plan

Not started, and **not to be started** until the meta-task closes. This is the
work the remediation exists to make safe.

| Phase | Title | Depends on |
|---|---|---|
| **12** | Skills — application-owned and workspace-discovered skills, validation, catalog metadata, agent assignment. Instructions and resources, never authority. **Foundation landed 2026-09-15** (ADR 0056; proof `tests/integration/skills-flue.test.ts`): folders scanned, enablement over the spine, `useSkill()` in the render. Open: install from folder/URL, model-driven install, `.agents/skills/` trust, assignment. | 11 (same three-layer model), #49 trust |
| **13** | Subagents and tasks — delegation, `task` and `skill` tools. | 12, #49 grants must not leak parent → child |
| **14** | Projects, workspaces, and sandboxes | #15 OS isolation, #50 process/shell policy |
| **15** | Memory and context | #34 context optimizer is currently unwired |
| **16** | Workflows and schedules | 13, Flue `defineWorkflow`/`RunStore` (unused today) |
| **17** | Evals | 12, 13 |
| **18** | Product integration — the Client stops being a test harness. | all of the above, #13 Gateway |

### Two capabilities without a phase yet

Recorded in the meta-task §5. Both need a home in this plan, and both want the
same thing:

- **RTK** — compress large tool results, keep the original retrievable. Belongs
  at the `CallGate` result boundary, which needs a projection seam it does not
  have. Overlaps the truncation-vs-artifact-handles question in #54.
- **Execution guard** — refuse an edit to a file the agent has not read.
  Conversation-scoped *state*, distinct from permission (authority) and bounds
  (limits), so a fourth stage in the gate, not a kernel rule.

Both want a gate that carries state across calls within a conversation. That is
one design, and it should be decided once — probably as part of Phase 12, since
skills raise the same question.

---

## Rule

A phase is **Verified** only under `../README.md` §6: a named test that fails on
regression, the command actually run, and the commit. Nothing here is promoted
on the strength of a checklist.
