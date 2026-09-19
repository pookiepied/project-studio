/**
 * What the summariser is told when a conversation is compacted.
 *
 * ---- Why Studio writes its own -------------------------------------------
 *
 * Flue's checkpoint format is a good ledger: goal, constraints, progress,
 * decisions, next steps, critical context, plus the file lists the engine
 * appends itself. It is written for a coding session and it is only a
 * ledger. Two things a person keeps missing from summaries like it are
 * added here, and one rule.
 *
 * **Overview** - a short plain narrative of what this stretch of the
 * conversation was about and how it went. The ledger is what to do next;
 * the overview is the story that makes the ledger make sense, and it is the
 * part a person reads when they open the marker in the transcript. It must
 * not restate the sections under it: the story is not the ledger repeated
 * in prose.
 *
 * **Reminders** - the walls. Things the person said not to do, corrections
 * they gave, mistakes the assistant made and must not repeat. A preference
 * is how to work; a reminder is a line not to cross, and a summary that
 * files "do not touch the migrations" under preferences loses it among the
 * formatting notes.
 *
 * **The rule for conversations that are not work.** One prompt serves a
 * coding session, a plan, a piece of writing and an afternoon of questions,
 * and it says so: when no files, commands or tasks were involved, the
 * ledger sections are left out entirely and the overview, preferences and
 * reminders carry the summary. A second model call to classify the
 * conversation first would be a second thing to fail; the summariser can
 * see for itself what the transcript holds.
 *
 * The update prompt keeps Flue's own preserve-and-move rules - a second
 * compaction updates the summary, it does not start over - with the same
 * sections. Both are handed to the engine through the `prompts` field the
 * runtime patch adds to its compaction config.
 */

export const COMPACTION_SYSTEM_PROMPT = `You are writing the checkpoint that lets an assistant continue a conversation after the earlier part of it has been folded away. Read the conversation, then write the checkpoint in the exact format asked for.

Do not continue the conversation. Do not answer any question in it. Write only the checkpoint. Use plain, complete English sentences. Keep exact file paths, function names, commands, identifiers and error messages exactly as they appear.`;

const SECTIONS = `## Overview
Five to ten sentences of plain narrative: what this stretch of the conversation was about, what was tried, and how it went. Written so a person can read it and so the assistant knows where it stands. Do not restate the sections below - this is the story, they are the ledger.

## Goal
[What the person is trying to accomplish. Several items if the conversation covers several tasks.]

## Constraints & Preferences
- [How the person wants the work done: style, tools, language, scope. "(none)" if nothing was said.]

## Reminders
- [Things the person said not to do, corrections they gave, and mistakes the assistant made and must not repeat. Each one a wall, stated plainly. "(none)" if nothing applies.]

## Progress
### Done
- [x] [Completed tasks and changes]

### In Progress
- [ ] [Current work. Name the file and say exactly what is half done, so an edit split across several steps can be finished and not redone.]

### Blocked
- [What is preventing progress, if anything]

## Key Decisions
- **[Decision]**: [The reason, in one line]

## Next Steps
1. [What should happen next, in order]

## Critical Context
- [Data, examples, references or facts needed to continue. "(none)" if nothing applies.]`;

const NOT_WORK_RULE = `If the conversation involved no files, no commands and no tasks - it was questions, discussion, planning in the abstract, or writing done entirely in the chat - leave out the Progress, Next Steps and Critical Context sections entirely, and let Overview, Goal, Constraints & Preferences and Reminders carry the whole checkpoint. Do not invent tasks to fill a section.`;

export const COMPACTION_SUMMARY_PROMPT = `The messages above are a conversation to fold into a checkpoint that another assistant will read to continue the work.

Use this exact format:

${SECTIONS}

${NOT_WORK_RULE}

Keep each section short. Keep exact file paths, function names, commands and error messages.`;

export const COMPACTION_UPDATE_PROMPT = `The messages above are NEW messages to fold into the existing checkpoint given in <previous-summary> tags.

Update the checkpoint rather than starting over. Rules:
- Keep everything from the previous checkpoint that is still true.
- Add new progress, decisions, reminders and context from the new messages.
- Move items from "In Progress" to "Done" when they were completed.
- Rewrite "Next Steps" for the current state.
- Rewrite the Overview so it covers the whole conversation so far, still in five to ten sentences.
- Keep exact file paths, function names, commands and error messages.
- Remove what is no longer relevant.

Use this exact format:

${SECTIONS}

${NOT_WORK_RULE}

Keep each section short.`;

/**
 * The summariser thinks at low effort. On providers where the thinking
 * budget shares the output cap, "high" can spend most of the cap thinking
 * and leave the checkpoint itself short; the checkpoint is the point.
 */
export const COMPACTION_REASONING = "low";

/** The prompts as the engine's compaction config takes them. */
export const COMPACTION_PROMPTS = {
  system: COMPACTION_SYSTEM_PROMPT,
  summary: COMPACTION_SUMMARY_PROMPT,
  update: COMPACTION_UPDATE_PROMPT,
  reasoning: COMPACTION_REASONING,
} as const;
