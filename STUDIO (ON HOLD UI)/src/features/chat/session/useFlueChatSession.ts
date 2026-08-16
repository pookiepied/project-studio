import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ChatSession, ChatStatus, TurnSettings } from "./types";
import { createHarnessClient, resetHarnessClientCache } from "@/platform/harness/client";
import { HarnessError } from "@/platform/harness/errors";
import { invalidateEndpoint } from "@/platform/harness/endpoint";

/**
 * Real Harness-backed chat session. Replaces the demo timer.
 *
 * One Flue thread per UI session (threadId = "studio-chat"). The hook owns:
 * - message mapping (Flue parts -> ChatPart)
 * - status union (idle/submitting/thinking/streaming/error)
 * - cancellation via AbortController
 * - stale-credential recovery (401 -> invalidate + restart_harness once)
 * - live observation via SSE (history polling as fallback)
 */

const THREAD_ID = "studio-chat";

function toErrorMessage(e: unknown): string {
  if (e instanceof HarnessError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function useFlueChatSession(): ChatSession {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);

  const abortRef = useRef<AbortController | null>(null);
  const observeCleanupRef = useRef<(() => void) | null>(null);
  const restartingRef = useRef(false);

  const cleanupObserve = useCallback(() => {
    if (observeCleanupRef.current) {
      observeCleanupRef.current();
      observeCleanupRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    cleanupObserve();
    setStatus("idle");
  }, [cleanupObserve]);

  // On mount, try to load history so reload restores transcript (Flue is durable)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await createHarnessClient();
        const hist = await client.history(THREAD_ID);
        if (!cancelled && hist.length > 0) setMessages(hist);
      } catch {
        // Host not ready yet — UI will show empty and surface error on first send
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      cleanupObserve();
    };
  }, [cleanupObserve]);

  const send = useCallback(
    async (text: string, _settings: TurnSettings) => {
      // Optimistically append user message
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        parts: [{ type: "text", text }],
      };
      setMessages((prev) => [...prev, userMsg]);
      setStatus("submitting");
      setError(undefined);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const client = await createHarnessClient();

        // Start live observation before send so we catch early events
        let lastMessages: ChatMessage[] = [];
        cleanupObserve();
        observeCleanupRef.current = client.observe(
          THREAD_ID,
          (msgs) => {
            // Only adopt server messages; keep optimistic user message until server echoes it
            // Flue will echo the user message as part of history; dedupe by id/text
            if (msgs.length === 0) return;
            lastMessages = msgs;
            setMessages(msgs);
            // Heuristic status from last assistant message parts
            const last = msgs[msgs.length - 1];
            if (last?.role === "assistant") {
              const hasReasoning = last.parts.some((p) => p.type === "reasoning");
              const hasText = last.parts.some((p) => p.type === "text");
              if (hasReasoning && !hasText) setStatus("thinking");
              else if (hasText) setStatus("streaming");
            }
          },
          controller.signal,
        );

        await client.send(THREAD_ID, text, controller.signal);
        setStatus("thinking");

        // Wait for terminal settlement (Flue durable). This also keeps SSE alive until done.
        // We use the SDK's wait via the same client — it will poll the streamUrl with token.
        // If wait throws, the observe path still has lastMessages.
        try {
          // We don't have direct wait on HarnessClient for Run; use history polling as wait
          // Poll history until a new assistant message appears beyond userMsg
          // Flue's wait is more precise but requires streamUrl; we use a simple poll here
          // and rely on observe to have already updated.
          // If SDK exposes wait, we call it via the underlying Flue client:
          // For now, poll history for up to 5 minutes
          const started = Date.now();
          while (!controller.signal.aborted && Date.now() - started < 300_000) {
            const hist = await client.history(THREAD_ID);
            if (hist.length > lastMessages.length) {
              setMessages(hist);
              const last = hist[hist.length - 1];
              if (last?.role === "assistant" && last.parts.some((p) => p.type === "text")) {
                break;
              }
            }
            // Also check if run is settled via Flue's stream — fallback to delay
            await new Promise((r) => setTimeout(r, 500));
            // If observe already has a complete assistant message, break
            if (
              lastMessages.length > 0 &&
              lastMessages[lastMessages.length - 1]?.role === "assistant" &&
              lastMessages[lastMessages.length - 1]?.parts.some((p) => p.type === "text")
            ) {
              // Give a little extra time for final flush
              await new Promise((r) => setTimeout(r, 300));
              break;
            }
          }
        } catch {
          // ignore poll errors, observe will have state
        }

        cleanupObserve();
        setStatus("idle");
      } catch (e) {
        cleanupObserve();
        const herr = e instanceof HarnessError ? e : null;
        if (herr?.code === "unauthorized" && !restartingRef.current) {
          restartingRef.current = true;
          try {
            // Invalidate and ask Host to restart; next send will use fresh credential
            resetHarnessClientCache();
            invalidateEndpoint();
            await invoke("restart_harness");
            setError("Harness session renewed. Please resend your message.");
          } catch (restartErr) {
            setError(toErrorMessage(restartErr));
          } finally {
            restartingRef.current = false;
          }
        } else if ((e as Error)?.name === "AbortError" || (e as DOMException)?.name === "AbortError") {
          setStatus("idle");
          return;
        } else {
          setError(toErrorMessage(e));
        }
        setStatus("error");
      } finally {
        abortRef.current = null;
      }
    },
    [cleanupObserve],
  );

  return { messages, status, error, send, stop };
}
