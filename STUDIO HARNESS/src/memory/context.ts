import type { MemoryItem, MemoryProfile } from "./store.js";

/**
 * The remembered context a new conversation starts with.
 *
 * ---- Where it goes, and why not the system prompt -------------------------
 *
 * The static prompt is byte-identical for every conversation so it and the
 * tool array stay one cached prefix. A profile edit or a new memory would move
 * that prefix for everyone, so this block rides a `memory_context` signal
 * appended once, before the first user message is answered - a system entry
 * in the transcript that the window never draws as anyone's words.
 *
 * ---- What goes in, in this order -------------------------------------------
 *
 * 1. The profile the person wrote in Personalization.
 * 2. Long-term memories: priority 3 ("high"), whatever their age.
 * 3. Recent memories: everything else touched in the last `RECENT_DAYS`,
 *    newest first.
 *
 * Project memories appear only in that project's conversations, under their
 * own heading. The whole block is capped at `MAX_BLOCK_CHARS`; what does not
 * fit is counted, never silently dropped, so the model knows to search.
 */

export const RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** About 1,500 tokens: enough for a profile and a few dozen one-line memories. */
export const MAX_BLOCK_CHARS = 6_000;
const MAX_RECENT = 20;

export interface MemoryContextInput {
  readonly profile: MemoryProfile;
  readonly items: readonly MemoryItem[];
  /** The project this conversation is filed under, when it is. */
  readonly project?: { readonly id: string; readonly name: string } | undefined;
  readonly now: number;
}

export interface MemoryContextBlock {
  readonly body: string;
  /** Operational counts for observation; never the text. */
  readonly counts: {
    readonly longTerm: number;
    readonly recent: number;
    readonly project: number;
    readonly omitted: number;
    readonly profileFields: number;
  };
}

function day(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10);
}

function line(item: MemoryItem): string {
  return `- [${item.kind}] ${item.content} (id ${item.id}, ${day(item.updatedAt)})`;
}

function profileLines(profile: MemoryProfile): readonly string[] {
  const lines: string[] = [];
  if (profile.name !== "") lines.push(`Name: ${profile.name}`);
  if (profile.preferredName !== "") lines.push(`Call them: ${profile.preferredName}`);
  if (profile.about !== "") lines.push(`About them: ${profile.about}`);
  if (profile.replyStyle !== "") lines.push(`How they want replies written: ${profile.replyStyle}`);
  return lines;
}

/**
 * The block's text and counts, or `undefined` when there is nothing to say.
 *
 * An empty profile and no memories produce no signal at all: a block that
 * says only "nothing remembered" costs tokens on every new conversation of
 * a person who never uses the feature.
 */
export function memoryContextBlock(input: MemoryContextInput): MemoryContextBlock | undefined {
  const profile = profileLines(input.profile);
  const recentFloor = input.now - RECENT_DAYS * DAY_MS;
  const personal = input.items.filter((item) => item.scope === "personal");
  const project = input.project === undefined
    ? []
    : input.items.filter((item) => item.scope === "project" && item.projectId === input.project?.id);
  const longTerm = personal.filter((item) => item.priority === 3);
  const recent = personal
    .filter((item) => item.priority !== 3 && item.updatedAt >= recentFloor)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_RECENT);
  const projectShown = project
    .filter((item) => item.priority === 3 || item.updatedAt >= recentFloor)
    .sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt);

  if (profile.length === 0 && personal.length === 0 && project.length === 0) return undefined;

  const header = [
    "Remembered context from Studio's memory, saved in earlier conversations or written by the user in Settings.",
    "It can be out of date: what the user says in this conversation wins. Use it where it helps; do not recite it or mention memories that are not relevant.",
  ];
  const sections: { readonly title: string; readonly lines: readonly string[] }[] = [];
  if (profile.length > 0) sections.push({ title: "Profile", lines: profile });
  if (longTerm.length > 0) sections.push({ title: "Long-term (important)", lines: longTerm.map(line) });
  if (recent.length > 0) sections.push({ title: `Recent (last ${String(RECENT_DAYS)} days)`, lines: recent.map(line) });
  if (input.project !== undefined && projectShown.length > 0) {
    sections.push({ title: `Project: ${input.project.name}`, lines: projectShown.map(line) });
  }

  // Lines are added until the budget runs out; profile lines come first and
  // are short, so they are effectively always kept.
  const out: string[] = [...header];
  let used = header.join("\n").length;
  let kept = 0;
  const memoryLines = new Set([...longTerm, ...recent, ...projectShown].map(line));
  for (const section of sections) {
    const title = `\n## ${section.title}`;
    if (used + title.length + 1 > MAX_BLOCK_CHARS) break;
    out.push(title);
    used += title.length + 1;
    for (const entry of section.lines) {
      if (used + entry.length + 1 > MAX_BLOCK_CHARS) break;
      out.push(entry);
      used += entry.length + 1;
      if (memoryLines.has(entry)) kept += 1;
    }
  }

  const visible = personal.length + project.length;
  const omitted = visible - kept;
  out.push(
    "",
    omitted > 0
      ? `${String(omitted)} more saved memories are not shown here. Search them with studio_memory_search (discover mcp:studio-memory) when earlier context would matter.`
      : "Search, save, update or forget memories with the studio-memory tools (discover mcp:studio-memory).",
  );

  return {
    body: out.join("\n"),
    counts: {
      longTerm: longTerm.length,
      recent: recent.length,
      project: projectShown.length,
      omitted,
      profileFields: profile.length,
    },
  };
}
