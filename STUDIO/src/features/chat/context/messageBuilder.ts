/**
 * Message preparation pipeline.
 *
 * Pure functions — no React dependencies. Each function takes messages in
 * and returns messages out, making the pipeline easy to test and compose.
 *
 * Typical call chain in sendMessage:
 *   buildApiMessages(conv)
 *   → addCoreSystemMessages
 *   → addStudioHarnessSystemMessages(runningServers)
 *   → addGenerationModelsSystemMessage(imageModel, videoModel)
 *   → addProjectContextSystemMessage(projectContext)
 *   → pruneContextByTokens(limit)
 */

import {
  estimateTokens,
  countMessageTokensAsync,
} from "@/utils/tokenEstimator";
import { logger } from "@/services/logging/logger";
import type { APIChatMessage } from "@/services/ai/types";
import type { ChatConversation } from "@/types";
import { extractMessageText } from "@/services/ai/types";
import {
  PROJECT_CONTEXT_MARKER,
  buildProjectContextSystemPrompt,
  buildProjectContextUserBlock,
} from "@/utils/projectContextUtils";
import { MAX_CONTEXT_MESSAGES } from "./constants";

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

/**
 * Build the full API message array for a conversation turn.
 *
 * Injects the rolling context summary (if compaction has run) so older turns
 * are represented as a concise system block rather than raw messages.
 * Also counts tokens and returns them for the context health indicator.
 */
export async function buildApiMessages(
  conv:         ChatConversation,
  currentModel: string,
  getContextLimit: (model: string) => number,
  setContextTokens: (n: number) => void,
  setContextLimit:  (n: number) => void
): Promise<APIChatMessage[]> {
  const { messages, contextSummary, summarizedUpToIndex } = conv;

  const rawStartIndex =
    contextSummary !== undefined && summarizedUpToIndex !== undefined
      ? summarizedUpToIndex + 1
      : 0;

  const rawMessages = messages
    .slice(rawStartIndex)
    .slice(-MAX_CONTEXT_MESSAGES);

  const apiMessages: APIChatMessage[] = rawMessages.map((m) => ({
    role:    m.role,
    content: m.content,
  }));

  if (contextSummary) {
    apiMessages.unshift({
      role:    "system",
      content: `Summary of earlier conversation:\n${contextSummary}`,
    });
  }

  // Update context health indicator
  const currentLimit = getContextLimit(conv.model || currentModel);
  setContextLimit(currentLimit);
  const tokens = await countMessageTokensAsync(apiMessages);
  setContextTokens(tokens);

  return apiMessages;
}

// ---------------------------------------------------------------------------
// Token pruning
// ---------------------------------------------------------------------------

/**
 * Prune messages to fit within `maxTokens`. Always keeps the system message.
 * Drops oldest non-system turns first.
 */
export function pruneContextByTokens(
  messages:  APIChatMessage[],
  maxTokens: number
): APIChatMessage[] {
  let totalTokens = 0;
  const pruned: APIChatMessage[] = [];

  const systemMsg = messages.find((m) => m.role === "system");
  if (systemMsg) {
    totalTokens += estimateTokens(extractMessageText(systemMsg.content)) + 4;
    pruned.push(systemMsg);
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "system") continue;
    const msgTokens =
      estimateTokens(extractMessageText(messages[i].content)) + 4;
    if (totalTokens + msgTokens > maxTokens) {
      const dropped =
        messages.filter((m) => m.role !== "system").length -
        pruned.filter((m) => m.role !== "system").length;
      if (dropped > 0) {
        logger.debug(
          "messageBuilder",
          `Pruned ${dropped} old messages to fit ${maxTokens} token limit`
        );
      }
      break;
    }
    totalTokens += msgTokens;
    pruned.unshift(messages[i]);
  }

  return pruned;
}

// ---------------------------------------------------------------------------
// System message injectors
// ---------------------------------------------------------------------------

const CORE_SYSTEM_MARKER       = "[core-tools:";
const GENERATION_MODELS_MARKER = "[generation-models:";
const FORMATTING_MARKER        = "[formatting:";
const STUDIO_HARNESS_SYSTEM_MARKER = "[studio-harness:";
const STUDIO_HARNESS_SYSTEM_PROMPT = "[studio-harness: local machine access enabled]";

/** Inject the task_write task-management context. */
export function addCoreSystemMessages(
  messages: APIChatMessage[]
): APIChatMessage[] {
  if (alreadyInjected(messages, CORE_SYSTEM_MARKER)) return messages;
  return prependSystem(messages, {
    role:    "system",
    content: `[core-tools: session task management]
## task_write — Task Management

Use the task_write tool to create and manage a structured task checklist for the current session.
It renders a live task panel in the UI and is available in every conversation.

Use it proactively for any multi-step task (3+ steps). Each item requires:
- content: imperative form, e.g. "Fix the login bug"
- activeForm: present-continuous form, e.g. "Fixing the login bug"
- status: "pending" | "in_progress" | "completed"

Rules:
- Create the full list BEFORE starting work
- Mark one task in_progress BEFORE beginning it — only one at a time
- Mark tasks completed IMMEDIATELY when done — never batch completions
- Remove tasks that are no longer relevant
- When all tasks complete, call task_write with the completed list (the UI clears automatically)

Skip task_write for: single trivial tasks, purely conversational replies, tasks under 3 steps.`,
  });
}

/** Inject configured image/video generation model names. */
export function addGenerationModelsSystemMessage(
  messages:   APIChatMessage[],
  imageModel?: string,
  videoModel?: string
): APIChatMessage[] {
  if (!imageModel && !videoModel) return messages;
  if (alreadyInjected(messages, GENERATION_MODELS_MARKER)) return messages;

  const lines = [
    `${GENERATION_MODELS_MARKER} configured]`,
    "When calling image_generate or video_generate tools, always pass the user's " +
    "pre-selected model as the `model` parameter — do not guess or substitute a different model.",
  ];
  if (imageModel) lines.push(`- image_generate model: "${imageModel}"`);
  if (videoModel) lines.push(`- video_generate model: "${videoModel}"`);

  return prependSystem(messages, { role: "system", content: lines.join("\n") });
}

/** Inject Studio Harness system prompt when the local engine is connected. */
export function addStudioHarnessSystemMessages(
  messages:       APIChatMessage[],
  runningServers: string[]
): APIChatMessage[] {
  if (!runningServers.includes("studio-harness")) return messages;
  if (alreadyInjected(messages, STUDIO_HARNESS_SYSTEM_MARKER)) return messages;
  return prependSystem(messages, {
    role:    "system",
    content: STUDIO_HARNESS_SYSTEM_PROMPT,
  });
}

/** Inject text-block formatting guidance. */
export function addFormattingSystemMessage(
  messages: APIChatMessage[]
): APIChatMessage[] {
  if (alreadyInjected(messages, FORMATTING_MARKER)) return messages;
  return prependSystem(messages, {
    role:    "system",
    content: `[formatting: text and artifact blocks]
## text — Formatted Text Output

When producing standalone formatted prose — rewrites, summaries, polished drafts, translations, organized versions, cleaned-up text, or any self-contained text the user will want to copy or edit — wrap it in a text block.

Also use a text block when the user uses vague requests like: "organize it", "clean this up", "write it in proper English", "make it sound better", "fix the writing", "write it nicely", "format this", "improve the wording", "tidy it up", "make it professional", or any similar intent to produce a polished deliverable:

\`\`\`text
Your formatted text here.
\`\`\`

This renders as a clean, copyable, editable panel in the UI. Do NOT use it for conversational replies or explanations — only for output that is a deliverable piece of text.

## artifact — Universal Studio Artifact Output

When returning a structured result that should render as a reusable UI object rather than plain prose, use:

\`\`\`artifact
{
  "type": "artifact",
  "version": 1,
  "category": "general",
  "kind": "search",
  "title": "Short title",
  "presentation": {
    "surface": "chat",
    "density": "card"
  }
}
\`\`\`

Use artifact blocks for search results, link bundles, weather/location snapshots, memory summaries, timelines, task summaries, agent summaries, records, and other app-style outputs. Keep low-level tool names out of user-facing labels; describe the work in human terms such as "Exploring codebase" or "Checking sources". Do not use artifact blocks for ordinary conversation.`,
  });
}

/** Inject project context (opened folder) as a system message. */
export function addProjectContextSystemMessage(
  messages:       APIChatMessage[],
  projectContext: { path: string; name: string } | null
): APIChatMessage[] {
  if (!projectContext) return messages;
  if (alreadyInjected(messages, PROJECT_CONTEXT_MARKER)) return messages;
  return prependSystem(messages, {
    role:    "system",
    content: buildProjectContextSystemPrompt(projectContext),
  });
}

/**
 * Compose all system injectors in the standard order.
 * Equivalent to calling each addXxx function in sequence.
 */
export function applyAllSystemMessages(
  messages:           APIChatMessage[],
  runningServers:     string[],
  imageModel?:        string,
  videoModel?:        string,
  projectContext:     { path: string; name: string } | null = null
): APIChatMessage[] {
  return addGenerationModelsSystemMessage(
    addProjectContextSystemMessage(
      addStudioHarnessSystemMessages(
        addFormattingSystemMessage(
          addCoreSystemMessages(messages)
        ),
        runningServers
      ),
      projectContext
    ),
    imageModel,
    videoModel
  );
}

/**
 * Prepend a project context block to the last user message.
 * Used in sendMessage so the context is always visible regardless of
 * whether the model processes system messages (Ollama, some local models).
 */
export function prependProjectContextToLastUser(
  messages:       APIChatMessage[],
  projectContext: { path: string; name: string } | null
): APIChatMessage[] {
  if (!projectContext) return messages;
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { idx = i; break; }
  }
  if (idx < 0) return messages;
  const block = buildProjectContextUserBlock(projectContext);
  const existing = typeof messages[idx].content === "string"
    ? messages[idx].content as string
    : extractMessageText(messages[idx].content);
  return messages.map((m, i) =>
    i === idx ? { ...m, content: `${block}\n\n${existing}` } : m
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function alreadyInjected(messages: APIChatMessage[], marker: string): boolean {
  return messages.some(
    (m) =>
      m.role === "system" &&
      extractMessageText(m.content).startsWith(marker)
  );
}

function prependSystem(
  messages: APIChatMessage[],
  systemMsg: APIChatMessage
): APIChatMessage[] {
  const existing = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  return [systemMsg, ...existing, ...nonSystem];
}
