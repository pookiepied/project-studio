/**
 * Harness client boundary for the desktop webview.
 *
 * This is the only place the UI imports @flue/sdk. Every component above
 * codes against the `ChatSession` seam and never sees Flue types. The client
 * is created per-endpoint and carries the per-launch bearer for both REST and
 * Durable Streams reconnections.
 */

import { createFlueClient, type FlueClient } from "@flue/sdk";
import type { ChatMessage, ChatPart } from "@/features/chat/session/types";
import { getHarnessEndpoint, invalidateEndpoint } from "./endpoint";
import { harnessErrorFromUnknown } from "./errors";

export interface HarnessClient {
  readonly baseUrl: string;
  readonly token: string;
  send(threadId: string, message: string, signal?: AbortSignal): Promise<SendResult>;
  history(threadId: string): Promise<ChatMessage[]>;
  observe(threadId: string, onMessages: (messages: ChatMessage[]) => void, signal?: AbortSignal): () => void;
  cancel(threadId: string): Promise<boolean>;
}

export interface SendResult {
  readonly threadId: string;
  readonly submissionId: string;
  readonly streamUrl: string;
  readonly offset: string;
}

let clientCache: { key: string; client: FlueClient } | null = null;

function getFlueClient(baseUrl: string, token: string): FlueClient {
  const key = `${baseUrl}::${token.slice(0, 8)}`;
  if (clientCache && clientCache.key === key) return clientCache.client;
  const client = createFlueClient({ baseUrl, token });
  clientCache = { key, client };
  return client;
}

export async function createHarnessClient(): Promise<HarnessClient> {
  const endpoint = await getHarnessEndpoint();
  const flue = getFlueClient(endpoint.url, endpoint.token);

  const mapParts = (parts: unknown[]): ChatPart[] => {
    const out: ChatPart[] = [];
    for (const p of parts as Array<{ type: string; text?: string }>) {
      if (p.type === "text" && typeof p.text === "string") out.push({ type: "text", text: p.text });
      else if (p.type === "reasoning" && typeof p.text === "string") out.push({ type: "reasoning", text: p.text });
      // dynamic-tool parts are rendered as text for now; transcript will evolve to tool blocks
      else if (p.type === "dynamic-tool" && typeof p.text === "string") out.push({ type: "text", text: p.text });
    }
    return out;
  };

  const toChatMessages = (snapshot: { messages?: Array<{ id?: string; role: string; parts: unknown[] }> }): ChatMessage[] => {
    const messages = snapshot.messages ?? [];
    return messages.map((m, idx) => ({
      id: m.id ?? `msg-${idx}`,
      role: (m.role === "assistant" ? "assistant" : "user") as ChatMessage["role"],
      parts: mapParts(m.parts as unknown[]),
    }));
  };

  return {
    baseUrl: endpoint.url,
    token: endpoint.token,

    async send(threadId: string, message: string, signal?: AbortSignal): Promise<SendResult> {
      try {
        const admission = await flue.agents.send("studio", threadId, {
          message,
          ...(signal ? { signal } : {}),
        });
        return {
          threadId,
          submissionId: admission.submissionId,
          streamUrl: admission.streamUrl,
          offset: admission.offset,
        };
      } catch (e) {
        // On 401, the per-launch credential is stale — invalidate and surface so caller can restart
        const herr = harnessErrorFromUnknown(e);
        if (herr.code === "unauthorized") invalidateEndpoint();
        throw herr;
      }
    },

    async history(threadId: string): Promise<ChatMessage[]> {
      try {
        const snap = await flue.agents.history("studio", threadId);
        return toChatMessages(snap as unknown as { messages?: Array<{ id?: string; role: string; parts: unknown[] }> });
      } catch (e) {
        throw harnessErrorFromUnknown(e);
      }
    },

    observe(threadId: string, onMessages: (messages: ChatMessage[]) => void, signal?: AbortSignal): () => void {
      const obs = flue.agents.observe("studio", threadId, { live: "sse" });
      const onSnapshot = () => {
        try {
          const snap = obs.getSnapshot() as unknown as { conversation?: { messages?: Array<{ id?: string; role: string; parts: unknown[] }> } };
          const conv = snap.conversation;
          if (conv) onMessages(toChatMessages(conv));
        } catch {
          // Snapshot may be empty before first event
        }
      };

      // Poll snapshot — Flue observation updates via SSE; we reflect via interval + refresh
      const interval = window.setInterval(() => {
        obs.refresh();
        onSnapshot();
      }, 200);

      // Also listen to raw events if available
      const cleanup = () => {
        window.clearInterval(interval);
        try {
          obs.close();
        } catch {}
        signal?.removeEventListener("abort", cleanup);
      };
      signal?.addEventListener("abort", cleanup, { once: true });

      // Initial
      onSnapshot();
      return cleanup;
    },

    async cancel(threadId: string): Promise<boolean> {
      try {
        const r = await flue.agents.abort("studio", threadId);
        return r.aborted;
      } catch (e) {
        throw harnessErrorFromUnknown(e);
      }
    },
  };
}

export function resetHarnessClientCache(): void {
  clientCache = null;
  invalidateEndpoint();
}
