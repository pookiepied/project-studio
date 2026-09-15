---
name: create-skill
description: How to write a skill for Project Studio - the folder, the SKILL.md file, its frontmatter, and how the person switches it on. Use when asked to create, write, package, or fix a skill.
---

A skill is a folder holding a `SKILL.md` file and, optionally, supporting
files. Studio reads the same format as Claude Code and every other harness
that follows the Agent Skills spec, so a skill written for one of them works
here unchanged.

## Where a skill lives

The person's own skills live in their Studio home:

```
~/.studio/skills/<name>/SKILL.md
```

On Windows that is `%USERPROFILE%\.studio\skills\<name>\SKILL.md`.

You cannot write there. The folder is outside every working directory, and a
write to it is refused. Produce the files in the working directory, in a
folder named after the skill, and tell the person to move that folder into
`~/.studio/skills/`. Then they switch the skill on in Settings > Skills, or
per project on the project's Extensions screen. A skill is off until they do.

## The SKILL.md file

It starts with YAML frontmatter between two `---` lines, then the
instructions in Markdown.

```markdown
---
name: review-pr
description: Reviews a pull request for correctness and style. Use when asked to review a PR, a diff, or a branch.
---

Read the whole diff before commenting on any of it.
...
```

Frontmatter fields:

- `name` (required). Lowercase letters, digits and single hyphens; at most 64
  characters; and it must equal the folder's name exactly. `review-pr` in a
  folder called `review-pr`.
- `description` (required). At most 1024 characters. This is the only part of
  the skill a model sees before it decides to load it, so it must say what
  the skill does *and* when to use it. Write the sentence the person would
  say when they want it.
- `license`, `compatibility`, `metadata` (optional). Free text, a note about
  what the skill needs, and a small string-to-string mapping.
- `allowed-tools` (optional). Part of the format, and read by Studio's runtime,
  but it grants nothing here: every tool a skill asks for is checked exactly
  as it would be without the skill.

## Writing the body

The body is loaded only when a task matches the description, so it can be as
long as it needs to be, but every line costs the person context when it is
loaded. Keep it to what changes how the work is done.

- Give the steps in the order they happen.
- Say what to check before acting and what "done" looks like.
- Put long reference material in supporting files beside `SKILL.md` and
  mention them by relative path. They are listed when the skill is activated
  and read only when asked for.
- Do not repeat what the model already knows how to do; say what is
  particular to this person, this project, or this kind of work.

## Supporting files

Anything else in the folder ships with the skill: templates, checklists,
example output, small scripts. Dotfiles and symbolic links are left out.
Keep each file under 1 MB and the folder under 8 MB; a skill is
instructions and templates, not a dataset.

## Checking it

A folder that does not parse is skipped and listed under Settings > Skills
with the reason. The common mistakes: a missing `---` line, a `name` that
does not match the folder, and a description over the limit.
