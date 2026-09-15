# 0056 — A Skill Is a Folder, and Flue Reads It

**Status:** Accepted
**Date:** 2026-09-15
**Builds on:** [ADR 0048](0048-a-capability-is-announced-before-it-is-loaded.md) —
progressive disclosure: announce cheaply, load on request. Skills are the
second capability to follow that rule, and they follow it on a surface Flue
already owns rather than on the discover tool.
**Builds on:** [ADR 0012](0012-permission-and-containment.md) — the kernel
decides, per call. Nothing here adds to what it decides.

## Context

Phase 12 asked for skills: instructions and files packaged for a kind of
work, switched on per project, loaded only when the work matches, and never a
source of authority. Three facts shaped the answer.

**Flue already implements the Agent Skills format.** `useSkill()` mounts a
skill in the render; Flue composes one line per skill — name and description —
into a `## Available Skills` section of the system prompt, exposes a framework
`activate_skill { name }` tool whose result is the `SKILL.md` body, and a
`read_skill_resource` tool for supporting files. The catalog is frozen into
the prompt at the conversation's baseline, and a later change to the mounted
set is narrated as a `resources` signal rather than by rewriting the prompt,
which is the cache discipline 0048 §1 demands. `@flue/runtime/internal`
exports the parser and the packager, so a folder on disk can become exactly
the object a build-time `SKILL.md` import produces.

**The format is the one people already have.** `SKILL.md` with YAML
frontmatter — `name`, `description`, optional `license`, `compatibility`,
`metadata`, `allowed-tools` — is what Claude Code and every other harness that
follows the spec reads. A person with a folder of skills should be able to
copy it in unchanged.

**The extend spine was built for this.** `src/extend/inventory.ts` and
`selection.ts` have carried a `"skill"` kind since Phase 11, on the promise
that a second kind would arrive by adding a folder and editing nothing.

## Options

**A. Build a skills engine in the harness.** Our own parser, our own catalog
section, our own load tool through the gate. Full control, and a second
opinion about every file that Flue would then disagree with at activation.
Rejected: glue, not platform.

**B. Route skills through the discover tool.** `discover skill:review-pr`
returning the body. One tool for both kinds, but it fights Flue: Flue would
still catalog and offer `activate_skill` for anything mounted, so either the
skill is mounted (and there are two doors) or it is not (and Flue's own
section, signals, and resource tool are lost). Rejected.

**C. Mount enabled skills with `useSkill()`; the harness only decides the
folders and the enablement.** Chosen.

Where the person's folder lives was a separate choice:

**`~/.studio/config/skills/`** fits the six-category rule in
`platform/paths.ts` (config = user-authored, losing it loses preferences).
**`~/.studio/skills/`** mirrors `~/.claude/skills/`, the path a person
following any published instructions will reach for. Chosen, as a deliberate
seventh top-level category; the header in `paths.ts` records why.

## Decision

Three layers, the same three as MCP (0048 §4), and only the first differs.

| Layer | Skills | Where |
|---|---|---|
| Installed | `<root>/<name>/SKILL.md` exists and parses | `extend/skills/registry.ts`. The filesystem is the record; nothing is stored. |
| Enabled | selection store, kind `skill`, three scopes, off by default | `extend/selection.ts`, unchanged |
| Loaded | `useSkill()` per enabled skill in the render; Flue's catalog line and `activate_skill` | `agents/studio.ts` |

Two roots, in trust order: the installation's `skills/` (provenance
`system`, author `studio`) and the person's `~/.studio/skills/` (`user`,
`third-party`). A user folder that reuses a bundled name is refused and
reported; Studio's own identity cannot be shadowed. A folder that does not
parse is skipped and reported with Flue's own sentence, never thrown — a typo
in a frontmatter must not fail a turn or hide the other skills.

A skill is packaged whole — every regular file under the folder, dotfiles and
symbolic links excluded, 1 MB per file and 8 MB per skill — because the
folder is outside every sandbox root and Flue's resource tool reads packaged
bytes rather than the disk. The packaged id carries a content hash, so an
edit is a new reference.

**A skill grants nothing.** `allowed-tools` is parsed and ignored. Every tool a
skill's text names still passes `CallGate` and the kernel, with the same
question a call would face without the skill. Enabling a skill is scoping,
not permission — rule 5 of `rules.md`, kept whole.

**Flue's workspace discovery is left alone.** Flue also reads
`<cwd>/.agents/skills/` for a conversation standing in a project folder, on
its own, outside the enable layer. The harness drops an enabled skill whose
name is also a folder there (Flue throws on the collision, and a thrown render
fails the run). The trust gap this leaves is recorded under Consequences.

## Consequences

- A person installs a skill by copying a folder and uninstalls it by deleting
  it; the settings screen shows what the folder holds and what failed to
  parse. Cost follows use: an enabled skill is one line per turn until the
  model asks for it.
- The desktop client renders skills with the same scope control servers use,
  because the decision is the same decision.
- `activate_skill` exists in the tools array only while at least one skill is
  mounted. Switching the last skill off removes a tool, which is the ruinous
  direction of 0048 §3 for conversations already open. Flue's trade, accepted:
  it is rare, and the alternative is a permanent tool that answers "nothing
  is mounted".
- `.agents/skills/` in a project folder is read without trust or enablement.
  A repository someone sends can add a catalog line to the prompt before the
  folder is trusted. Open: gate it on `WorkspaceTrustStore`, or extend the
  runtime patch to switch discovery off.
- The model cannot write to `~/.studio/skills/`: it is outside every root.
  Creating a skill from a conversation therefore means producing the files in
  the working directory and the person moving them. An install path — from a
  folder, an archive, or a URL — and a model-driven install through a
  permission are later work, and the bundled `create-skill` skill says so.
- `~/.studio` has seven top-level categories rather than six.

## Required proof

- A folder with a valid `SKILL.md` lists with its sentence and provenance; a
  root that does not exist lists nothing and reports nothing.
- A missing frontmatter and a name/folder mismatch are problems, not throws,
  and the other skills still list.
- A user skill with a bundled name is refused, and the bundled one stays.
- Packaging includes supporting files with forward-slash paths and excludes
  dotfiles and links; an edit changes the reference; nothing changed answers
  the same reference.
- The decision routes land each scope's answer at its own scope, `null`
  clears, and an uninstalled skill is a 404.
- Through the built server: off by default there is no catalog line and no
  `activate_skill`; switched on, the line is in the prompt and the tool
  returns the body in the same turn; switched off, a new conversation has
  neither. `tests/integration/skills-flue.test.ts`.
