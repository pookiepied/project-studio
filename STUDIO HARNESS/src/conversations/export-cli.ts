import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { installationRoot } from "../platform/paths.js";
import {
  openReadOnlyDatabase,
  resolveDatabasePath,
} from "../storage/database.js";
import { StorageError } from "../storage/errors.js";
import {
  openFlueJournal,
  resolveFlueJournalPath,
} from "../storage/flue-journal.js";
import { runExport } from "./export-run.js";
import type { OrphanPolicy } from "./export-walk.js";
import { ConversationStore } from "./store.js";

/**
 * The conversation export command.
 *
 *   pnpm export [directory] [--flue-db <path>] [--studio-db <path>] [--orphans <mode>]
 *
 * Reads Flue's journal and the Studio index read-only, and writes a
 * self-describing export of every conversation they hold. It exists because
 * the Flue 2.0 runtime rejects any journal older than schema 8 before
 * application code runs, with no in-place migration: whatever this command
 * does not read out first is destroyed by the upgrade.
 *
 * Nothing under the Studio home is written, moved, or deleted by this
 * command; both databases are opened with SQLite's read-only flag, and the
 * output goes where the caller says - by default a new, timestamped directory
 * in the user's home, never inside `~/.studio`.
 *
 * `--flue-db` exists so the run can be pointed at a copy of the journal,
 * which is the recommended way to use it: an export taken against a copy
 * cannot be the thing that disturbs the original.
 */

const USAGE = `Usage: pnpm export [directory] [options]

Reads Flue's journal and the Studio index, and writes every conversation to
a self-describing export (one JSON file a future importer reads, one Markdown
file a person reads).

  directory          Where to write the export. Default: a new timestamped
                     directory in your home folder. It must not already hold
                     files; an export never overwrites.
  --flue-db <path>   The Flue journal to read. Default: this install's
                     journal (PROJECT_STUDIO_DB_PATH is honoured). Prefer a
                     copy: point this at the copy.
  --studio-db <path> The Studio index database. Default: this install's.
  --orphans <mode>   What to do with conversations the Studio index no
                     longer knows (the delete defect): include (default),
                     exclude, or split into separate files.
  -h, --help         This text.`;

function parseArgs(argv: readonly string[]): {
  outputDirectory: string | null;
  flueDb: string | null;
  studioDb: string | null;
  orphans: OrphanPolicy;
} {
  const parsed: {
    outputDirectory: string | null;
    flueDb: string | null;
    studioDb: string | null;
    orphans: OrphanPolicy;
  } = {
    outputDirectory: null,
    flueDb: null,
    studioDb: null,
    orphans: "include",
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) continue;
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new StorageError("invalid", {
          message: `The ${argument} flag needs a value.`,
        });
      }
      index += 1;
      return value;
    };

    if (argument === "--flue-db") parsed.flueDb = next();
    else if (argument === "--studio-db") parsed.studioDb = next();
    else if (argument === "--orphans") {
      const mode = next();
      if (mode !== "include" && mode !== "exclude" && mode !== "split") {
        throw new StorageError("invalid", {
          message:
            `Unknown --orphans mode "${mode}". Expected include, exclude, or split.`,
        });
      }
      parsed.orphans = mode;
    } else if (argument.startsWith("--")) {
      throw new StorageError("invalid", {
        message: `Unknown flag "${argument}".`,
      });
    } else {
      if (parsed.outputDirectory !== null) {
        throw new StorageError("invalid", {
          message: `More than one output directory was named ("${parsed.outputDirectory}" and "${argument}").`,
        });
      }
      parsed.outputDirectory = argument;
    }
  }

  return parsed;
}

function isRecordWith(
  value: unknown,
  key: string,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

/** The runtime's published version, for the envelope; failure-tolerant. */
function runtimeVersion(): string {
  try {
    const raw = readFileSync(join(installationRoot(), "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isRecordWith(parsed, "dependencies")) {
      const dependencies = parsed["dependencies"];
      if (isRecordWith(dependencies, "@flue/runtime")) {
        const version = dependencies["@flue/runtime"];
        if (typeof version === "string") return version;
      }
    }
  } catch {
    // The envelope says "unknown" rather than guessing.
  }
  return "unknown";
}

function defaultOutputDirectory(exportedAt: Date): string {
  const stamp = exportedAt
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+$/, "");
  return join(homedir(), `studio-conversation-export-${stamp}`);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const parsed = parseArgs(argv);
  const exportedAt = new Date();
  const outputDirectory = parsed.outputDirectory ?? defaultOutputDirectory(exportedAt);

  const journal = openFlueJournal(parsed.flueDb ?? resolveFlueJournalPath());
  try {
    const studioDb = openReadOnlyDatabase({
      path: parsed.studioDb ?? resolveDatabasePath(),
    });
    try {
      const conversations = new ConversationStore(studioDb).list();

      const result = runExport({
        journal,
        conversations,
        outputDirectory,
        orphans: parsed.orphans,
        exportedAt,
        runtime: runtimeVersion(),
      });

      process.stdout.write(
        `Exported ${result.counts.conversations} conversations ` +
          `(${result.counts.streams} agent streams, ` +
          `${result.counts.userMessages} user messages, ` +
          `${result.counts.assistantMessages} assistant replies, ` +
          `${result.counts.toolCalls} tool calls) in ${result.durationMs.toFixed(0)} ms.\n`,
      );      process.stdout.write(
        `Known to Studio: ${result.counts.knownConversations}; ` +
          `orphaned (deleted in the app): ${result.counts.orphanedConversations}.\n`,
      );
      for (const file of result.files) {
        process.stdout.write(`  ${file.path} (${formatBytes(file.bytes)})\n`);
      }
      process.stdout.write(
        "Both databases were opened read-only; nothing under the Studio home was changed.\n",
      );
      return 0;
    } finally {
      studioDb.close();
    }
  } finally {
    journal.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message =
      error instanceof StorageError
        ? error.message
        : error instanceof Error
          ? error.message
          : "The conversation export failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
