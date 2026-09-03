import type {
  ExportedConversation,
  ExportMessage,
  OrphanPolicy,
} from "./export-walk.js";
import { EXPORT_FORMAT_VERSION } from "./export-walk.js";

/**
 * The human-readable half of the export.
 *
 * `conversations.json` is the artifact a future importer re-seeds from; this
 * rendering is the hedge the brief asks for: if the re-seed is never written,
 * a person can still open one file, find a conversation, and read it - no
 * Studio, no Flue, none of this code. The rendering walks the same timeline
 * the JSON carries, so the two cannot quietly disagree.
 */

const FENCE = "```";

/**
 * Message text, rendered so it cannot pose as this document's own structure.
 *
 * The export's headings are what a person navigates by: one `##` per
 * conversation, `###` per message. Message bodies are prose that regularly
 * contains Markdown of its own - a pasted report, a numbered outline, an
 * answer written in sections - and emitted verbatim its headings sit at the
 * same level as ours. Measured on this machine's real history: 40
 * conversations produced 89 `##` lines, so a reader scanning the file finds
 * conversations that do not exist and cannot trust the outline.
 *
 * Escaped rather than demoted, because demotion has no answer for content
 * that is already at the deepest level, and because `\#` renders as the `#`
 * the person actually typed. The text reads the same; only its authority over
 * the document changes. Fenced blocks are left alone - a fence already denies
 * its contents any structural meaning.
 */
function asProse(text: string): string {
  let fenced = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s{0,3}(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(/^(\s{0,3})(#{1,6})(\s|$)/, "$1\\$2$3");
    })
    .join("\n");
}

function formatTimestamp(timestamp: string | null): string {
  return timestamp ?? "time unknown";
}

function modelLabel(message: ExportMessage): string {
  if (message.role !== "assistant" || message.model === null) return "";
  const parts = [message.model.provider, message.model.model].filter(
    (part) => part !== null && part !== "",
  );
  return parts.length === 0 ? "" : ` (${parts.join(" / ")})`;
}

function renderMessage(message: ExportMessage): string[] {
  const lines: string[] = [];

  if (message.role === "user") {
    const label =
      message.via === "dispatch"
        ? "Dispatch input (titler)"
        : message.via === "signal"
          ? `System signal${message.signalType === null ? "" : ` (${message.signalType})`}`
          : "User";
    lines.push(`### ${label} - ${formatTimestamp(message.timestamp)}`, "");
    if (message.recoveredFrom !== null) {
      lines.push(
        "*(This message never reached the conversation stream; it was " +
          "recovered from the submission journal.)*",
        "",
      );
    }
    lines.push(
      ...(message.text === "" ? ["(no text)"] : [asProse(message.text)]),
      "",
    );
    return lines;
  }

  const flags: string[] = [];
  if (message.stopReason !== null) flags.push(`stop reason: ${message.stopReason}`);
  if (message.error !== null) flags.push(`error: ${message.error}`);
  const flagText = flags.length === 0 ? "" : ` - ${flags.join("; ")}`;
  lines.push(
    `### Assistant - ${formatTimestamp(message.timestamp)}${modelLabel(message)}${flagText}`,
    "",
  );

  for (const block of message.blocks) {
    if (block.type === "reasoning") {
      if (block.text !== "") {
        lines.push("**Reasoning**", "");
        for (const paragraph of block.text.split("\n")) {
          lines.push(`> ${paragraph}`);
        }
        lines.push("");
      }
      continue;
    }
    if (block.type === "text") {
      if (block.text !== "") {
        lines.push(asProse(block.text), "");
      }
      continue;
    }
    lines.push(
      `**Tool call: ${block.name}** (call id ${block.toolCallId})`,
      "",
      "Arguments:",
      "",
      `${FENCE}json`,
      JSON.stringify(block.arguments, null, 2),
      FENCE,
      "",
    );
    if (block.result === null) {
      lines.push("*No result was recorded for this call.*", "");
      continue;
    }
    const resultLabel = block.result.isError
      ? "Result (error)"
      : block.result.committed
        ? "Result"
        : "Result (recorded but never committed)";
    lines.push(`${resultLabel}:`, "", FENCE, "");
    if (block.result.content.length === 0) {
      lines.push("(empty result)");
    } else {
      for (const part of block.result.content) {
        lines.push(part.text);
      }
    }
    lines.push(FENCE, "");
  }

  return lines;
}

function provenanceLines(conversation: ExportedConversation): string[] {
  if (conversation.studio === null) {
    return [
      "- Known to Studio: **no**. This conversation was deleted in the app; " +
        "the index row and its folder are gone, and only this transcript " +
        "survived in Flue's journal.",
    ];
  }
  const record = conversation.studio;
  const marks: string[] = [];
  if (record.archived) marks.push("archived");
  if (record.pinned) marks.push("pinned");
  const markText = marks.length === 0 ? "" : ` (${marks.join(", ")})`;
  return [
    `- Known to Studio: **yes**${markText}.`,
    `- Title: ${record.title ?? "(untitled)"}.`,
    `- Created: ${new Date(record.createdAt).toISOString()}; last turn: ${new Date(record.lastTurnAt).toISOString()}.`,
  ];
}

function renderConversation(conversation: ExportedConversation): string[] {
  const lines: string[] = [];
  const title = conversation.studio?.title ?? null;
  lines.push(
    `## ${title ?? conversation.conversationId} (${conversation.conversationId})`,
    "",
  );
  lines.push(...provenanceLines(conversation), "");

  for (const stream of conversation.streams) {
    lines.push(
      `### Stream \`${stream.path}\``,
      "",
      `- Agent: ${stream.agent}`,
      `- Flue conversation: ${stream.flueConversationId ?? "unknown"}`,
      `- Created: ${formatTimestamp(stream.createdAt)}; ${stream.recordCount} records over ${stream.batchCount} batches.`,
      "",
    );

    for (const entry of stream.entries) {
      if (entry.kind === "message") {
        lines.push(...renderMessage(entry.message));
        continue;
      }
      lines.push(
        `> **${entry.event.kind}** - ${formatTimestamp(entry.event.timestamp)}: ${entry.event.summary}`,
        "",
      );
    }

    if (stream.losses.length > 0) {
      lines.push("**Notes on what could not survive**", "");
      for (const loss of stream.losses) {
        lines.push(`- ${loss}`);
      }
      lines.push("");
    }
  }

  return lines;
}

/**
 * Renders the conversations under one orphan policy into a Markdown document.
 * `fileName` names the JSON sibling so a reader knows where the structured
 * copy lives.
 */
export function renderMarkdown(options: {
  readonly conversations: readonly ExportedConversation[];
  readonly exportedAt: string;
  readonly databaseLabel: string;
  readonly flueSchemaVersion: string | null;
  readonly runtime: string;
  readonly orphans: OrphanPolicy;
  readonly jsonFileName: string;
}): string {
  const lines: string[] = [
    "# Project Studio conversation export",
    "",
    `- Exported: ${options.exportedAt}`,
    `- Source: ${options.databaseLabel} (Flue journal version ${options.flueSchemaVersion ?? "unknown"})`,
    `- Runtime: ${options.runtime}`,
    `- Export format: project-studio.conversation-export, version ${EXPORT_FORMAT_VERSION}`,
    `- Orphan policy: ${options.orphans}`,
    `- Structured copy: ${options.jsonFileName}`,
    "",
    "Each conversation below carries its provenance: whether the Studio",
    "index still knows it, and its title when it does. Conversations marked",
    "as deleted survived only because Flue's journal was never told about",
    "the delete.",
    "",
  ];

  for (const conversation of options.conversations) {
    lines.push(...renderConversation(conversation));
  }

  return lines.join("\n") + "\n";
}
