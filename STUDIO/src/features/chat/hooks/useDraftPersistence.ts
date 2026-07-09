import { useState, useEffect, useCallback } from "react";
import { useDebouncedValue } from "@/lib/hooks/useDebounce";

const KEY_PREFIX = "studio_draft_";
const DEBOUNCE_MS = 800;

/**
 * Persists the chat input draft to localStorage, keyed by conversation ID.
 * Draft is restored when the conversation is (re)loaded and cleared on send.
 * Works for both the Tauri desktop app and the web version because both
 * expose a localStorage-compatible API through the WebView.
 */
export function useDraftPersistence(conversationId: string | undefined) {
  const [inputMessage, setInputMessage] = useState("");

  // Restore draft whenever the active conversation changes.
  useEffect(() => {
    if (!conversationId) {
      setInputMessage("");
      return;
    }
    try {
      const saved = localStorage.getItem(`${KEY_PREFIX}${conversationId}`);
      setInputMessage(saved ?? "");
    } catch {
      setInputMessage("");
    }
  }, [conversationId]);

  // Debounce the value so we don't thrash localStorage on every keystroke.
  const debouncedMessage = useDebouncedValue(inputMessage, DEBOUNCE_MS);

  // Write (or remove) the draft whenever the debounced value settles.
  useEffect(() => {
    if (!conversationId) return;
    try {
      if (debouncedMessage.trim()) {
        localStorage.setItem(`${KEY_PREFIX}${conversationId}`, debouncedMessage);
      } else {
        localStorage.removeItem(`${KEY_PREFIX}${conversationId}`);
      }
    } catch {
      // Storage may be full or restricted — fail silently.
    }
  }, [conversationId, debouncedMessage]);

  // Immediately remove the draft (called right after the message is sent).
  const clearDraft = useCallback(() => {
    if (!conversationId) return;
    try {
      localStorage.removeItem(`${KEY_PREFIX}${conversationId}`);
    } catch {
      // ignore
    }
  }, [conversationId]);

  return { inputMessage, setInputMessage, clearDraft };
}
