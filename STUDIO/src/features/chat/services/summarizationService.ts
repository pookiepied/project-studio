/**
 * Conversation Summarization Service
 *
 * Generates a rolling, high-fidelity summary of older conversation turns.
 * Structured output (numbered sections + <analysis> scratchpad) ensures the
 * model covers every required dimension before writing the final summary.
 *
 * Design decisions:
 *  - Always uses the caller's current conversation model — quality over cost.
 *  - Rolling: each compaction extends the previous summary rather than
 *    replacing it, so there is always a single growing summary in storage.
 *  - <analysis> block is stripped from the stored summary — it is only a
 *    drafting scratchpad to improve output quality.
 *  - Direct, non-streaming, single-turn call so it resolves quickly.
 */

import { apiClient } from "@/utils/api";
import { logger } from "@/core/logging/logger";
import { ChatMessage } from "@/types";

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
Your entire response must be an <analysis> block followed by a <summary> block.

`;

const ANALYSIS_INSTRUCTION = `Before writing the final summary, wrap your full reasoning in <analysis> tags.
In that block, go through the conversation chronologically and note:
- Every explicit user request and intent change
- All technical decisions, file edits, code snippets, function names, paths
- Every error encountered and how it was resolved
- Any user feedback that changed the approach
- What was being worked on at the very end
- Any pending or open tasks

Then write the summary in <summary> tags using the exact structure below.`;

const SUMMARY_STRUCTURE = `Your <summary> must contain these numbered sections:

1. Primary Request and Intent
   Capture every explicit user request in detail, including intent changes.

2. Key Technical Concepts
   All important technologies, frameworks, APIs, and design patterns discussed.

3. Files and Code Sections
   For every file examined, modified, or created:
   - Why it matters
   - What changed (if anything)
   - Full relevant code snippets (function signatures, key blocks, configs)

4. Errors and Fixes
   Every error encountered, how it was fixed, and any user correction of your approach.

5. Problem Solving
   Problems solved and any ongoing/unresolved issues.

6. All User Messages
   List every user message verbatim (skip tool results). Critical for tracking intent drift.

7. Pending Tasks
   Everything the user has asked for that is not yet done.

8. Current Work
   Precise description of what was happening in the final messages — include file names
   and code snippets. This is what the next session resumes from.

9. Optional Next Step
   The immediate next action, ONLY if it directly follows from the last user request.
   Include verbatim quotes from the conversation to prevent task drift.`;

const INITIAL_SYSTEM_PROMPT = `You are an expert technical conversation archivist.
Your summaries are the sole record of a conversation — future AI sessions will have no
other access to the original messages. Be thorough and precise. A long accurate summary
is strictly better than a short lossy one. Write in third person throughout.`;

const ROLLING_SYSTEM_PROMPT = `You are an expert technical conversation archivist.
An earlier portion of the conversation has already been summarized. Your job is to extend
that summary by incorporating new turns. Write in third person. Do NOT repeat content
already in the existing summary unless correcting or refining it with newer information.
Produce a single unified updated summary in the same structured format.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip the <analysis> scratchpad and extract the content between <summary> tags.
 * Falls back to the full text if the tags are missing (older model outputs).
 */
function formatSummary(raw: string): string {
  // Remove <analysis>...</analysis> block
  const withoutAnalysis = raw.replace(/<analysis>[\s\S]*?<\/analysis>/i, "").trim();

  // Extract <summary>...</summary>
  const summaryMatch = withoutAnalysis.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch) return summaryMatch[1].trim();

  // No tags — return cleaned text as-is (graceful fallback)
  return withoutAnalysis;
}

function buildExcerpt(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const role = m.role === "user" ? "User" : "Assistant";
      return `[${role}]\n${m.content}`;
    })
    .join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SummarizationResult {
  summary: string;
  /** Index (inclusive) of the last message covered by this summary. */
  summarizedUpToIndex: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generate or extend a rolling summary.
 *
 * @param messagesToSummarize  Raw turns to compress (oldest-first slice).
 * @param previousSummary      Existing summary to extend, if any.
 * @param lastMessageIndex     Index in the full messages array of the last
 *                             message included in messagesToSummarize.
 * @param model                The model to use — always the user's current
 *                             conversation model, no fallback waterfall.
 */
export async function summarizeMessages(
  messagesToSummarize: ChatMessage[],
  previousSummary: string | undefined,
  lastMessageIndex: number,
  model: string
): Promise<SummarizationResult | null> {
  if (messagesToSummarize.length === 0) return null;

  const excerpt = buildExcerpt(messagesToSummarize);
  const isRolling = Boolean(previousSummary);

  const systemPrompt = isRolling ? ROLLING_SYSTEM_PROMPT : INITIAL_SYSTEM_PROMPT;

  const userPrompt = isRolling
    ? `${NO_TOOLS_PREAMBLE}${ANALYSIS_INSTRUCTION}

${SUMMARY_STRUCTURE}

---

Existing summary to extend:

${previousSummary}

---

New conversation turns to incorporate:

${excerpt}`
    : `${NO_TOOLS_PREAMBLE}${ANALYSIS_INSTRUCTION}

${SUMMARY_STRUCTURE}

---

Conversation to summarize:

${excerpt}`;

  logger.debug("SummarizationService", "Calling model for summarization", {
    model,
    isRolling,
    inputMessages: messagesToSummarize.length,
    lastMessageIndex,
  });

  try {
    const response = await apiClient.post<{
      choices: Array<{ message: { content: string } }>;
    }>("/chat/completions", {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      direct: true,
      stream: false,
    });

    if (!response.success || !response.data) {
      logger.warn("SummarizationService", "API call failed", response.error);
      return null;
    }

    const raw = response.data.choices[0]?.message?.content?.trim();
    if (!raw) {
      logger.warn("SummarizationService", "Empty summary returned");
      return null;
    }

    const content = formatSummary(raw);

    logger.info("SummarizationService", "Summary generated", {
      model,
      isRolling,
      inputMessages: messagesToSummarize.length,
      summaryLength: content.length,
      summarizedUpToIndex: lastMessageIndex,
    });

    return { summary: content, summarizedUpToIndex: lastMessageIndex };
  } catch (err) {
    logger.error("SummarizationService", "Summarization call threw", err);
    return null;
  }
}
