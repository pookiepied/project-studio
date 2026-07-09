import { getAllConversations, loadConversation } from "@/core/storage/chatHistoryService";

export interface MessageHit {
  conversationId:    string;
  conversationTitle: string;
  messageId:         string;
  role:              string;
  snippet:           string;
}

interface CachedConv {
  id:       string;
  title:    string;
  messages: { id: string; role: string; content: string }[];
}

// Session cache of all conversation message content. Built lazily on first
// search and reused across keystrokes; cleared when the palette (re)opens or
// when storage changes, so results stay fresh without re-reading every file
// on every keypress.
let cache: CachedConv[] | null = null;

export function invalidateSearchCache() {
  cache = null;
}

async function ensureCache(): Promise<CachedConv[]> {
  if (cache) return cache;
  const metas = await getAllConversations();
  cache = await Promise.all(
    metas.map(async (m) => {
      const conv = await loadConversation(m.id).catch(() => null);
      return {
        id:    m.id,
        title: m.title,
        messages: (conv?.messages ?? []).map((msg) => ({
          id:      msg.id,
          role:    msg.role,
          content: msg.content ?? "",
        })),
      };
    })
  );
  return cache;
}

function makeSnippet(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  if (idx === -1) return flat(content).slice(0, 90);
  const start = Math.max(0, idx - 32);
  const end   = Math.min(content.length, idx + query.length + 56);
  return (
    (start > 0 ? "…" : "") +
    flat(content.slice(start, end)) +
    (end < content.length ? "…" : "")
  );
}

/**
 * Search message content across every locally-stored conversation.
 * Returns up to `limit` hits. Requires at least 2 query characters.
 */
export async function searchMessages(query: string, limit = 25): Promise<MessageHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const data = await ensureCache();
  const hits: MessageHit[] = [];

  for (const conv of data) {
    for (const msg of conv.messages) {
      if (msg.content && msg.content.toLowerCase().includes(q)) {
        hits.push({
          conversationId:    conv.id,
          conversationTitle: conv.title,
          messageId:         msg.id,
          role:              msg.role,
          snippet:           makeSnippet(msg.content, query),
        });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
