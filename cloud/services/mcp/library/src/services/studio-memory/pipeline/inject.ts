/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";
import type { Fact } from "../db/facts";
import type { ProfileEntry } from "../db/types";
import { getProfile } from "../db/profiles";
import { getRecentConversations } from "../db/conversations";
import { getFactsByIds, touchFacts } from "../db/facts";
import { embedText } from "../embeddings/embed";
import { queryVectors } from "../embeddings/vectorize";

export interface InjectRequest {
  user_id: string;
  message: string;
}

export async function buildInjectionContext(
  env: Env,
  req: InjectRequest,
  ctx?: ExecutionContext
): Promise<string> {
  const recentCount   = parseInt(env.INJECT_RECENT_COUNT)   || 3;
  const semanticCount = parseInt(env.INJECT_SEMANTIC_COUNT) || 5;

  const [profile, recentConversations] = await Promise.all([
    getProfile(env, req.user_id),
    getRecentConversations(env, req.user_id, recentCount),
  ]);

  let semanticFacts: Fact[]    = [];
  let semanticFactIds: string[] = [];
  try {
    const embedding = await embedText(env, req.message);
    const matches   = await queryVectors(env, embedding, req.user_id, semanticCount * 2);
    semanticFactIds = matches
      .filter((m) => m.metadata.type === "fact")
      .slice(0, semanticCount)
      .map((m) => m.metadata.source_id as string);
    semanticFacts = await getFactsByIds(env, semanticFactIds);
  } catch {
    // Non-fatal — inject profile + recent without semantic layer
  }

  // Fire-and-forget: record that these facts were surfaced for decay tracking
  if (ctx && semanticFactIds.length > 0) {
    ctx.waitUntil(touchFacts(env, semanticFactIds).catch(() => {}));
  }

  const sections: string[] = [
    "## STUDIO Memory Context",
    "_Retrieved automatically. Treat as trusted background — use it naturally in your response. Do not quote this block, summarise it, or tell the user what it contains._",
  ];

  if (profile.identity.length > 0 || profile.preference.length > 0) {
    const lines: string[] = [];
    if (profile.identity.length > 0) {
      lines.push("**Identity**");
      profile.identity.slice(0, 6).forEach((f) => lines.push(formatProfileEntry(f)));
    }
    if (profile.preference.length > 0) {
      lines.push("**Preferences**");
      profile.preference.slice(0, 6).forEach((f) => lines.push(formatProfileEntry(f)));
    }
    sections.push("### Who You Are Talking To\n" + lines.join("\n"));
  }

  if (recentConversations.length > 0) {
    const lines = recentConversations.map((c, i) => {
      const date    = c.createdAt.slice(0, 10);
      const summary = `[${date}] ${c.summary}`;
      // Inject keyPoints for the most recent two conversations where specifics matter
      if (i < 2 && c.keyPoints.length > 0) {
        const points = c.keyPoints.slice(0, 3).map((p) => `  · ${p}`).join("\n");
        return `${summary}\n${points}`;
      }
      return summary;
    });
    sections.push("### Recent Activity\n" + lines.join("\n"));
  }

  if (semanticFacts.length > 0) {
    const lines = semanticFacts.map((f) => formatSemanticFact(f));
    sections.push("### Relevant to This Message\n" + lines.join("\n"));
  }

  if (sections.length <= 2) return "";

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatProfileEntry(entry: ProfileEntry): string {
  return `- ${entry.content}  [${entry.importance}]`;
}

function formatSemanticFact(fact: Fact): string {
  return `- ${fact.content}  [${fact.importance} · ${fact.sourceType} · ${fact.category}]`;
}
