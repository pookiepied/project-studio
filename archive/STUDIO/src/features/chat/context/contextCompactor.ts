/**
 * Context compaction (background summarisation).
 *
 * When the conversation grows close to the context window limit, the oldest
 * half of raw turns is summarised into a rolling system message.  Future
 * calls to buildApiMessages will use this summary in place of the raw turns,
 * keeping the token budget stable over long conversations.
 *
 * This function is intentionally fire-and-forget (called with .catch()).
 * It never blocks sending a message.
 */

import { countMessageTokensAsync } from "@/lib/tokenEstimator";
import { logger } from "@/core/logging/logger";
import {
  loadConversation,
  updateConversationSummary,
} from "@/features/chat/conversations/chatHistoryService";
import { summarizeMessages } from "@/features/chat/services/summarizationService";
import type { ChatConversation } from "@/types";

/** Minimum raw-turn count before compaction is considered. */
const MIN_RAW_TURNS = 10;

/** Compact when within 15K tokens of the model's input limit. */
const COMPACT_BUFFER = 15_000;

export async function maybeCompact(
  conv:            ChatConversation,
  currentModel:    string,
  getContextLimit: (model: string) => number,
  isSummarizingRef: React.MutableRefObject<boolean>,
  setIsSummarizing: (v: boolean) => void,
  setConversation:  (c: ChatConversation) => void
): Promise<void> {
  if (isSummarizingRef.current) return;

  const { messages, contextSummary, summarizedUpToIndex } = conv;
  const rawStartIndex =
    contextSummary !== undefined && summarizedUpToIndex !== undefined
      ? summarizedUpToIndex + 1
      : 0;
  const rawMessages = messages.slice(rawStartIndex);

  if (rawMessages.length < MIN_RAW_TURNS) return;

  const currentLimit = getContextLimit(conv.model || currentModel);
  const tokens = await countMessageTokensAsync(
    rawMessages.map((m) => ({ content: m.content }))
  );
  if (tokens < currentLimit - COMPACT_BUFFER) return;

  // Summarise the oldest half
  const splitAt          = Math.floor(rawMessages.length / 2);
  const toSummarize      = rawMessages.slice(0, splitAt);
  const lastSummarizedIdx = rawStartIndex + splitAt - 1;

  isSummarizingRef.current = true;
  setIsSummarizing(true);

  logger.info("contextCompactor", "Starting background summarization", {
    conversationId: conv.id,
    messagesToSummarize: toSummarize.length,
    tokensEstimate: tokens,
  });

  try {
    const result = await summarizeMessages(
      toSummarize,
      contextSummary,
      lastSummarizedIdx,
      conv.model || currentModel
    );

    if (result) {
      await updateConversationSummary(
        conv.id,
        result.summary,
        result.summarizedUpToIndex
      );
      const refreshed = await loadConversation(conv.id);
      if (refreshed) setConversation(refreshed);

      logger.info("contextCompactor", "Summarization complete", {
        summarizedUpToIndex: result.summarizedUpToIndex,
        summaryLength:       result.summary.length,
      });
    }
  } catch (err) {
    logger.error("contextCompactor", "Background summarization failed", err);
  } finally {
    isSummarizingRef.current = false;
    setIsSummarizing(false);
  }
}
