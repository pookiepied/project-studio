import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { StorageError } from "../storage/errors.js";
import type { FlueJournalReader } from "../storage/flue-journal.js";
import type { ConversationRecord } from "../contracts/conversations.js";

import {
  countConversations,
  groupConversations,
  walkStream,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  type ExportCounts,
  type ExportEnvelope,
  type ExportedConversation,
  type ExportedStream,
  type OrphanPolicy,
} from "./export-walk.js";
import { renderMarkdown } from "./export-markdown.js";

/**
 * The export run: everything between the journal reader and files on disk.
 *
 * This module owns no connections - the entry point opens them and hands them
 * in - and no walking, which lives in `export-walk.ts` where it can be tested
 * without a filesystem. What it adds is the arithmetic of the policy: which
 * conversations a file carries, what its envelope counts must say, and the one
 * rule that outranks convenience - **the export never overwrites**. A person
 * runs this once, under time pressure, before an upgrade that destroys the
 * source; silently replacing yesterday's export with today's would bet both
 * copies on one pass of this code.
 */

export interface ExportRunOptions {
  readonly journal: FlueJournalReader;
  /** The Studio index, for provenance; empty makes every stream an orphan. */
  readonly conversations: readonly ConversationRecord[];
  readonly outputDirectory: string;
  readonly orphans: OrphanPolicy;
  readonly exportedAt: Date;
  readonly runtime: string;
}

export interface ExportOutputFile {
  readonly path: string;
  readonly bytes: number;
}

export interface ExportRunResult {
  readonly outputDirectory: string;
  readonly files: readonly ExportOutputFile[];
  readonly counts: ExportCounts;
  readonly durationMs: number;
}

const JSON_FILE_NAME = "conversations.json";
const MARKDOWN_FILE_NAME = "conversations.md";
const KNOWN_JSON_FILE_NAME = "conversations-known.json";
const KNOWN_MARKDOWN_FILE_NAME = "conversations-known.md";
const ORPHANED_JSON_FILE_NAME = "conversations-orphaned.json";
const ORPHANED_MARKDOWN_FILE_NAME = "conversations-orphaned.md";

const SOURCE_TABLES = [
  "flue_conversation_streams",
  "flue_conversation_stream_batches",
  "flue_agent_submissions",
] as const;

function assertWritableDirectory(outputDirectory: string): void {
  if (!existsSync(outputDirectory)) return;
  if (readdirSync(outputDirectory).length > 0) {
    throw new StorageError("conflict", {
      message:
        `The export directory ${outputDirectory} already holds files. ` +
        "An export never overwrites; choose an empty or new directory.",
    });
  }
}

function buildEnvelope(options: {
  readonly conversations: readonly ExportedConversation[];
  readonly journal: FlueJournalReader;
  readonly exportedAt: Date;
  readonly runtime: string;
  readonly orphans: OrphanPolicy;
  readonly notes: readonly string[];
}): ExportEnvelope {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: options.exportedAt.toISOString(),
    source: {
      database: options.journal.path,
      flueSchemaVersion: options.journal.schemaVersion,
      runtime: options.runtime,
      tables: SOURCE_TABLES,
    },
    orphans: options.orphans,
    counts: countConversations(options.conversations),
    notes: options.notes,
    conversations: options.conversations,
  };
}

function writePair(options: {
  readonly outputDirectory: string;
  readonly jsonFileName: string;
  readonly markdownFileName: string;
  readonly conversations: readonly ExportedConversation[];
  readonly journal: FlueJournalReader;
  readonly exportedAt: Date;
  readonly runtime: string;
  readonly orphans: OrphanPolicy;
  readonly notes: readonly string[];
}): ExportOutputFile[] {
  const envelope = buildEnvelope({
    conversations: options.conversations,
    journal: options.journal,
    exportedAt: options.exportedAt,
    runtime: options.runtime,
    orphans: options.orphans,
    notes: options.notes,
  });

  const jsonPath = join(options.outputDirectory, options.jsonFileName);
  const jsonBytes = Buffer.byteLength(
    JSON.stringify(envelope, null, 2) + "\n",
    "utf8",
  );
  writeFileSync(jsonPath, JSON.stringify(envelope, null, 2) + "\n", "utf8");

  const markdownPath = join(options.outputDirectory, options.markdownFileName);
  const markdown = renderMarkdown({
    conversations: options.conversations,
    exportedAt: options.exportedAt.toISOString(),
    databaseLabel: options.journal.path,
    flueSchemaVersion: options.journal.schemaVersion,
    runtime: options.runtime,
    orphans: options.orphans,
    jsonFileName: options.jsonFileName,
  });
  const markdownBytes = Buffer.byteLength(markdown, "utf8");
  writeFileSync(markdownPath, markdown, "utf8");

  return [
    { path: jsonPath, bytes: jsonBytes },
    { path: markdownPath, bytes: markdownBytes },
  ];
}

/**
 * Walks the whole journal and writes the export under the orphan policy.
 *
 * Returns the file list with sizes and the wall-clock duration, because the
 * person running this is doing so once, on a deadline, and will want to have
 * written down what happened.
 */
export function runExport(options: ExportRunOptions): ExportRunResult {
  const started = process.hrtime.bigint();

  assertWritableDirectory(options.outputDirectory);

  const submissionRows = options.journal.listSubmissions();
  const streams: ExportedStream[] = options.journal
    .listStreams()
    .map((stream) =>
      walkStream({
        stream,
        batches: options.journal.readBatches(stream.path),
        submissions: submissionRows,
      }),
    );

  const known = new Map<string, ConversationRecord>(
    options.conversations.map((record) => [record.id, record]),
  );
  const all = groupConversations(streams, known);
  const knownConversations = all.filter(
    (conversation) => conversation.knownToStudio,
  );
  const orphanedConversations = all.filter(
    (conversation) => !conversation.knownToStudio,
  );

  mkdirSync(options.outputDirectory, { recursive: true });

  const files: ExportOutputFile[] = [];
  let counted: ExportedConversation[];

  if (options.orphans === "include") {
    counted = all;
    files.push(
      ...writePair({
        outputDirectory: options.outputDirectory,
        jsonFileName: JSON_FILE_NAME,
        markdownFileName: MARKDOWN_FILE_NAME,
        conversations: all,
        journal: options.journal,
        exportedAt: options.exportedAt,
        runtime: options.runtime,
        orphans: options.orphans,
        notes: [],
      }),
    );
  } else if (options.orphans === "exclude") {
    counted = knownConversations;
    const excludedRecords = all
      .filter((conversation) => !conversation.knownToStudio)
      .reduce((sum, conversation) => sum + conversation.streams.reduce(
        (streamSum, stream) => streamSum + stream.recordCount, 0), 0);
    files.push(
      ...writePair({
        outputDirectory: options.outputDirectory,
        jsonFileName: JSON_FILE_NAME,
        markdownFileName: MARKDOWN_FILE_NAME,
        conversations: knownConversations,
        journal: options.journal,
        exportedAt: options.exportedAt,
        runtime: options.runtime,
        orphans: options.orphans,
        notes: [
          `Excluded by policy: ${orphanedConversations.length} conversations ` +
            `(${excludedRecords} records) the Studio index no longer knows. ` +
            "They were measured; they are not in this file.",
        ],
      }),
    );
  } else {
    counted = all;
    files.push(
      ...writePair({
        outputDirectory: options.outputDirectory,
        jsonFileName: KNOWN_JSON_FILE_NAME,
        markdownFileName: KNOWN_MARKDOWN_FILE_NAME,
        conversations: knownConversations,
        journal: options.journal,
        exportedAt: options.exportedAt,
        runtime: options.runtime,
        orphans: options.orphans,
        notes: [
          `The sibling file ${ORPHANED_JSON_FILE_NAME} carries the ` +
            `${orphanedConversations.length} conversations the Studio index no longer knows.`,
        ],
      }),
      ...writePair({
        outputDirectory: options.outputDirectory,
        jsonFileName: ORPHANED_JSON_FILE_NAME,
        markdownFileName: ORPHANED_MARKDOWN_FILE_NAME,
        conversations: orphanedConversations,
        journal: options.journal,
        exportedAt: options.exportedAt,
        runtime: options.runtime,
        orphans: options.orphans,
        notes: [
          `The sibling file ${KNOWN_JSON_FILE_NAME} carries the ` +
            `${knownConversations.length} conversations the Studio index knows.`,
        ],
      }),
    );
  }

  const finished = process.hrtime.bigint();
  return {
    outputDirectory: options.outputDirectory,
    files,
    counts: countConversations(counted),
    durationMs: Number(finished - started) / 1_000_000,
  };
}
