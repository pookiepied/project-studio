---
name: skill_create
description: Create a new STUDIO skill using the standard SKILL.md format, with optional STUDIO skill.json metadata. Use when the user wants to create, author, scaffold, improve, or package a reusable skill for tools, workflows, or domain knowledge.
---

# Skill Create

Create a production-ready STUDIO skill. The required artifact is `SKILL.md` with standard YAML frontmatter; `skill.json` is optional STUDIO metadata for catalog display, runtime filtering, and registration.

## Prerequisites

Use Studio Harness file tools for local writes. If `mcp_studio_harness__*` tools are unavailable, ask the user to start **Studio Harness** from STUDIO Extensions.

Use Skills system tools when available:

- `skill_validate` to validate package metadata and frontmatter.
- `skill_register_local` to register the finished local skill.
- `skill_list` to detect key collisions.

## Format Rules

Every skill must contain:

```markdown
---
name: skill-key
description: What the skill does and when to use it.
---

# Skill Name

Instructions for the agent.
```

Rules:

- Use lowercase letters, numbers, and hyphens for new skill keys; keep keys under 64 characters.
- Keep the frontmatter `description` under 1024 characters and include both capability and trigger context.
- Put trigger/use-case wording in the frontmatter description because the body loads only after the skill is selected.
- Do not add extra frontmatter fields. Put STUDIO-specific metadata in `skill.json` instead.
- Legacy built-in STUDIO management skills may use underscores; do not copy that style for new user-created skills.

Optional `skill.json`:

```json
{
  "key": "skill-key",
  "name": "Skill Name",
  "description": "Same meaning as the SKILL.md description.",
  "category": "General",
  "version": "1.0.0",
  "scope": "local",
  "allowed_runtime": "local",
  "entrypoint": "SKILL.md",
  "when_to_use": ["User asks for this workflow"],
  "required_tools": [],
  "permissions": []
}
```

Runtime guidance:

- Use `"local"` for skills that need Studio Harness, Computer Use, local files, local MCP tools, or desktop access.
- Use `"both"` for pure knowledge or text workflows that work in cloud and local contexts.
- Use `"cloud"` only for STUDIO-managed system skills that do not need local files or desktop tools.

## Creation Workflow

1. Gather only missing essentials: key, display name, description, skill type, required tools, and whether it needs reference files, scripts, or assets.
2. Pick exactly one template: `tooling`, `workflow`, or `knowledge`.
3. Check for collisions with `skill_list` when available. If the key exists, ask whether to overwrite, rename, or cancel.
4. Create `$HOME/.studio/skills/{key}/`.
5. Write `SKILL.md`. Add `skill.json` unless the user explicitly wants frontmatter-only portability.
6. Add only necessary resources:
   - `references/` for optional documentation loaded on demand.
   - `scripts/` for deterministic repeatable code.
   - `assets/` for templates, images, fonts, examples, or files used as output inputs.
7. Validate with `skill_validate`. Fix blocking errors and revalidate.
8. Register with `skill_register_local`.
9. Report the key, path, runtime, and any resources created.

Do not create README, changelog, installation guide, or extra docs unless the user explicitly asks. The skill package should contain only files the agent needs to perform the skill.

## Template Selection

| Type | Use when | Main shape |
|---|---|---|
| `tooling` | The skill coordinates MCP/local/API tools | Prerequisites, tool routing, operating loop, verification, safety |
| `workflow` | The skill guides a repeatable process | Decision tree, paths, checkpoints, escalation |
| `knowledge` | The skill provides domain judgment or reference | Principles, procedures, pitfalls, optional references |

If a skill combines multiple types, choose the dominant behavior. Put supporting details in references instead of mixing templates.

## Tooling Template

Use for skills like desktop automation, GitHub operations, database work, app-specific MCP usage, or any repeatable tool orchestration.

```markdown
---
name: {key}
description: {description}
---

# {Name}

Use this skill to {one-sentence purpose}. Prefer the listed tools and verify every user-visible change.

## Prerequisites

- Required tools: `{tool-or-server}`.
- If required tools are unavailable, ask the user to enable them before acting.
- Confirm before destructive, irreversible, privileged, or external side-effect actions.

## Operating Loop

1. Establish the target, user goal, current state, and risk level.
2. Inspect before acting with the lowest-impact read tool.
3. Choose the most semantic tool available before using broad or manual controls.
4. Make one logical change at a time.
5. Verify with a direct read-back, status check, screenshot/OCR, test, or tool result.
6. Report what changed and what remains uncertain.

## Tool Routing

| Task | Use |
|---|---|
| {task category} | `{primary tool}` |
| {task category} | `{primary tool}`, then `{verification tool}` |
| Files/code/shell/git | Use Studio Harness tools, not unrelated MCP tools |

## Safety

- Ask before {specific risky action}.
- Prefer reversible user-scope changes over system-wide changes.
- Never invent hidden state; inspect or ask.

## Recovery

- If a tool fails, read the error and retry once only when the cause is clear.
- If state changed unexpectedly, re-inspect and choose a new path.
- If verification is impossible, say what evidence is missing.
```

## Workflow Template

Use for repeatable procedures such as deployment, triage, onboarding, release checks, migration, debugging, or review workflows.

```markdown
---
name: {key}
description: {description}
---

# {Name}

Use this skill to run the {process name} process from intake through verified completion.

## Intake

Collect only the missing information needed to choose a path:

- Goal:
- Target environment or artifact:
- Constraints:
- Definition of done:

## Decision Tree

| Condition | Path |
|---|---|
| {condition A} | [Path A](#path-a) |
| {condition B} | [Path B](#path-b) |
| Unclear or conflicting | Ask one focused clarification question |

## Path A

1. Inspect {artifact/state}.
2. Perform {action}.
3. Verify {signal}.
4. Continue only if {condition}.

## Path B

1. Inspect {artifact/state}.
2. Perform {action}.
3. Verify {signal}.

## Escalation

- Stop and ask the user when {blocking condition}.
- Roll back or preserve evidence when {failure condition}.
- Do not continue when required access, data, or confirmation is missing.

## Completion Checklist

- {checkpoint}
- {checkpoint}
- {final user-visible result}
```

## Knowledge Template

Use for company/project knowledge, domain-specific reasoning, product rules, policy, design standards, schemas, or procedures that should shape answers and decisions.

```markdown
---
name: {key}
description: {description}
---

# {Name}

Use this skill when reasoning about {domain}. Apply these rules before giving recommendations or making changes.

## Core Model

- {concept}: {short explanation}
- {concept}: {short explanation}
- {constraint}: {what must remain true}

## Working Rules

1. {rule with action-oriented wording}.
2. {rule with decision criteria}.
3. {rule with verification or exception}.

## Common Pitfalls

| Pitfall | Correct approach |
|---|---|
| {mistake} | {fix} |
| {mistake} | {fix} |

## References

Load only when needed:

- `references/{file}.md` for {specific detail}.
- `references/{file}.md` for {specific detail}.
```

## Resource Guidance

Use progressive disclosure:

- Keep `SKILL.md` focused on core workflow and routing.
- Move long examples, schemas, policies, API details, or domain tables into `references/`.
- Mention each reference from `SKILL.md` with a clear condition for when to read it.
- Add scripts only when repeated code would be fragile or tedious to rewrite. Test scripts before registering the skill.
- Add assets only when the skill needs reusable output inputs such as templates or media.

## Validation Checklist

Before registering, verify:

- `SKILL.md` starts with valid frontmatter.
- `name` matches `skill.json.key` when `skill.json` exists.
- `description` is useful as a trigger and under 1024 characters.
- The body avoids duplicated or conflicting instructions.
- Required tools in `skill.json` match the workflow.
- Any risky operations have confirmation rules.
- Any created resources are referenced from `SKILL.md`.
- No placeholder text remains.

## Registration

Compute the SKILL.md hash:

```powershell
(Get-FileHash "{skillDir}\SKILL.md").Hash.ToLower()
```

Register:

```text
skill_register_local(
  key="{key}",
  name="{name}",
  description="{description}",
  category="{category}",
  version="1.0.0",
  allowed_runtime="{runtime}",
  source_type="local_path",
  local_path="{skillDir}",
  manifest_json=<raw skill.json or "{}">,
  content_hash="{sha256}"
)
```

If registration fails after files were created, report the local path and the validation result so the user can retry without losing work.
