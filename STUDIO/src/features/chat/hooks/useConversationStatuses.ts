import { useState, useEffect } from "react";
import {
  backgroundSessionTracker,
  type ConversationSessionStatus,
} from "@/services/conversations/backgroundSessionTracker";

/**
 * Returns a live map of conversation IDs → their background status.
 * Only conversations that were navigated away from mid-stream appear here.
 *   "streaming"   — DO is still processing in the background
 *   "done_unread" — response completed but user hasn't returned yet
 */
export function useConversationStatuses(): Map<string, ConversationSessionStatus> {
  const [statuses, setStatuses] = useState<Map<string, ConversationSessionStatus>>(
    () => backgroundSessionTracker.getStatuses()
  );

  useEffect(() => {
    return backgroundSessionTracker.subscribe(setStatuses);
  }, []);

  return statuses;
}
