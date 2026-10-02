import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StorageError } from "../storage/errors.js";

/**
 * Where things live on this machine.
 *
 * Three locations, and confusing them is the source of a whole family of bugs:
 *
 * 1. **The installation** — packaged and read-only. Application code and the
 *    binaries we ship. Nothing may be written here; in a packaged desktop build
 *    it is inside an app bundle the user cannot modify, and on Windows it is
 *    often under `Program Files`.
 * 2. **The user's Studio home** (`~/.studio`) — everything that persists and is
 *    ours: the database, downloaded programs, logs, snapshots, caches.
 * 3. **The project** — the user's own files. We write *their* content there and
 *    nothing of our own.
 *
 * The rule: never resolve any of these against the working directory. The
 * harness runs with the user's project as its working directory, so a
 * cwd-relative path either drops our files into their repository or reads
 * theirs as if it were ours. Both have already happened once here — the vendor
 * lookup and the database path — which is why this module exists rather than
 * each subsystem deciding for itself.
 *
 * Inside the Studio home, directories are grouped by **what happens if you
 * delete them**. That is the one question every other property follows from:
 * what to back up, what to sync, what a "clear caches" button may remove, and
 * what support may safely ask a user to throw away.
 *
 *   config/   user-authored settings        losing it loses their preferences
 *   data/     durable state                 losing it loses work
 *   tools/    programs we downloaded        re-downloadable
 *   logs/     diagnostics                   disposable, but findable
 *   cache/    derived data                  disposable
 *   tmp/      scratch                       cleared between runs
 *   skills/   skill folders the user put here   losing it loses their skills
 *
 * A flat home does not survive contact with a real product — `~/.codex` has
 * over forty entries at its top level, and nothing about it says which of them
 * matter. The rule here: a new directory must belong to one of these seven. If
 * it genuinely fits none of them, the category set is wrong and should be
 * changed deliberately, rather than an eighth sibling appearing at the top
 * level.
 *
 * `skills/` is the one deliberate change so far, and it is a category of one.
 * By the first six it belongs under `config/`, and it was placed at the top
 * level anyway, on purpose: a skill folder is the thing a person copies in by
 * hand, following instructions written for `~/.claude/skills`, and the path
 * they expect is the one that works. A folder that has to be explained is a
 * folder that gets put in the wrong place.
 */

const HOME_DIRECTORY_NAME = ".studio";

/**
 * The user's Studio home.
 *
 * `PROJECT_STUDIO_HOME` overrides it, which is what tests use and what lets a
 * user relocate state to another drive.
 */
export function studioHome(): string {
  const configured = process.env.PROJECT_STUDIO_HOME;
  if (configured !== undefined && configured.trim() !== "") return resolve(configured);

  return join(homedir(), HOME_DIRECTORY_NAME);
}

/** A path inside the Studio home. Segments are joined, never interpolated. */
export function studioPath(...segments: string[]): string {
  return join(studioHome(), ...segments);
}

/**
 * The installation directory - where shipped assets live.
 *
 * Resolved from this module's own location, so it is correct whether running
 * from `src/`, from a build output, or from inside a packaged application.
 *
 * "This module's own location" is a walk upward to the nearest `package.json`,
 * not a fixed number of levels. The source tree sits two levels below the
 * installation root (`src/platform/`), and the 2.0 build bundles the same code
 * one level below it (`dist/`), so a hard-coded `../../` resolves the vendor
 * directory differently per layout - measured under the Flue 2.0 build, where
 * the bundled artifact walked out of the installation entirely and the sandbox
 * launcher was "not installed" on a machine it ships with. The nearest
 * `package.json` is the one thing every layout has at the root and no layout
 * has in its intermediate directories. Cached: the answer cannot change while
 * the process runs.
 */
let cachedInstallationRoot: string | undefined;

export function installationRoot(): string {
  cachedInstallationRoot ??= ((): string => {
    let current = dirname(fileURLToPath(import.meta.url));
    for (;;) {
      if (existsSync(join(current, "package.json"))) return current;
      const parent = dirname(current);
      if (parent === current) {
        // The filesystem root: nowhere to walk. The old two-level answer is
        // the best guess left, and the consumers' own refusals take over.
        return resolve(fileURLToPath(new URL("../../", import.meta.url)));
      }
      current = parent;
    }
  })();
  return cachedInstallationRoot;
}

/** Binaries shipped with the application. Read-only. */
export function shippedBinaryDirectory(): string {
  return join(installationRoot(), "vendor");
}

/**
 * Binaries the application downloaded for this user.
 *
 * Separate from the shipped ones because they have different lifetimes and
 * different trust: one was reviewed and committed, the other arrived over the
 * network at runtime. Keeping them apart means "what did we ship" stays an
 * answerable question.
 */
export function managedBinaryDirectory(): string {
  return studioPath("tools", "bin");
}

/** The application database. One file, in the user's home, never in a project. */
export function databasePath(): string {
  return studioPath("data", "studio.db");
}

/**
 * Flue's own database — the durable execution journal.
 *
 * Separate file from `databasePath()` on purpose. That one is ours and its
 * schema is ours to migrate; this one belongs to Flue and its shape is Flue's
 * business. Sharing a file would make a Flue upgrade a migration problem for
 * our tables.
 *
 * Both live in `data/`, because losing either loses work.
 */
export function flueDatabasePath(): string {
  return studioPath("data", "flue.db");
}

/**
 * Per-project shadow git repositories — the undo history.
 *
 * Deliberately outside the project. A snapshot store inside the repository
 * would show up in the user's own `git status`, and would be destroyed by the
 * very `rm -rf` it exists to recover from.
 */
export function snapshotsDirectory(): string {
  return studioPath("data", "snapshots");
}

export function logsDirectory(): string {
  return studioPath("logs");
}

export function cacheDirectory(): string {
  return studioPath("cache");
}

/** Scratch space. Anything here may be deleted between runs. */
export function temporaryDirectory(): string {
  return studioPath("tmp");
}

/**
 * The skills the person installed by hand: `<name>/SKILL.md` per folder.
 *
 * Top level rather than under `config/`, beside `commands/` — both hold files
 * the person authored, and losing either loses work the person wrote, which
 * is not what a settings directory is for.
 */
export function userSkillsDirectory(): string {
  return studioPath("skills");
}

/** The person's own slash commands, one Markdown file each. */
export function userCommandsDirectory(): string {
  return studioPath("commands");
}

/**
 * The library: files the person chose to keep beyond one conversation.
 *
 * Under `data/` beside `conversations/`, with the rest of what the person
 * owns. Flat, one file per record id: a
 * re-tagged item never moves, two uploads called `photo.png` never collide,
 * and a new kind of file needs no new folder rule. Read by every
 * conversation's sandbox, written only by the harness - the same doctrine
 * as a conversation's `attachments/`.
 */
export function libraryDirectory(): string {
  return studioPath("data", "library");
}

/** Per-project state the application owns, keyed by project id. */
export function projectsDirectory(): string {
  return studioPath("data", "projects");
}

export function sessionsDirectory(): string {
  return studioPath("data", "sessions");
}

/**
 * The per-conversation tree: what a conversation owns when it owns nothing
 * else.
 *
 * A conversation with no project still needs somewhere to stand. Its own
 * directory under `data/` is that place, and the three children answer three
 * different questions with different lifetimes:
 *
 * - `workspace/` — the sandbox root for a conversation without a project.
 *   Empty at first; a file the model writes here stays with the conversation.
 *   Granted by default, because nothing else is inside it.
 * - `attachments/` and `artifacts/` are **siblings**, not children of
 *   `workspace/`: an attachment is something the user contributed, an artifact
 *   is something the app produced, and either nested inside the sandbox root
 *   would put them within the model's reach by construction.
 *
 * Under `data/` rather than `tmp/` on purpose — these files are the user's,
 * and losing them because they were filed as scratch would be a bug. Created
 * by callers when a conversation is created (`paths.ts`'s own rule), never at
 * startup for conversations that merely exist in the index.
 */
export function conversationsDirectory(): string {
  return studioPath("data", "conversations");
}

/**
 * A conversation id as a path segment.
 *
 * Ids are caller-chosen (ADR 0045) and arrive here from a route parameter, so
 * this refuses to guess: an id carrying a separator or a traversal is not a
 * conversation directory anybody meant, and joining it unchecked would let one
 * escape `data/conversations`. Legitimate ids are simple segments — `cnv_*` in
 * practice — and anything else has no business reaching this tree.
 */
function conversationSegment(conversationId: string): string {
  // Alphanumeric start, so nothing begins with a dot, and plain segment
  // characters after: no separator of either platform's kind can appear, which
  // is what makes traversal unrepresentable. `a..b` passes and is harmless —
  // dots only traverse when they are the whole segment, and a whole segment of
  // dots cannot start with a letter or a digit.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(conversationId)) {
    // Classified rather than a raw error, like every configured location that
    // cannot be used: a name this module cannot turn into a directory of its
    // own is a storage problem whatever the caller intended to keep there.
    throw new StorageError("invalid", {
      message:
        `"${conversationId}" is not a conversation id this install can address. ` +
        "A conversation directory must come from a plain identifier.",
    });
  }
  return conversationId;
}

/** One conversation's directory. */
export function conversationDirectory(conversationId: string): string {
  return join(conversationsDirectory(), conversationSegment(conversationId));
}

/** The sandbox root of a conversation without a project. */
export function conversationWorkspaceDirectory(conversationId: string): string {
  return join(conversationDirectory(conversationId), "workspace");
}

/**
 * The model's own private directory, in every mode.
 *
 * A sibling of `workspace/` rather than a place inside it, because the two
 * answer different questions and the answer must not change with the mode. A
 * project conversation stands in the person's repository and this is the only
 * directory it owns; a plain conversation stands in `workspace/` and this is
 * still the place its throwaway files go. So the rule the model is given
 * reads the same either way - what you were asked for goes in the workspace,
 * everything else goes here - and `workspace/` never has to mean "the work"
 * in one mode and "the junk" in the other.
 *
 * It is writable in both modes, which is the half that used to be missing: a
 * project conversation was told it had a private directory and the sandbox's
 * write roots did not include it, so the promise was refused at the first
 * write.
 */
export function conversationScratchDirectory(conversationId: string): string {
  return join(conversationDirectory(conversationId), "scratch");
}

/** Where files the user contributes to a conversation land. */
export function conversationAttachmentsDirectory(conversationId: string): string {
  return join(conversationDirectory(conversationId), "attachments");
}

/** Where artifacts this app produced for a conversation land. */
export function conversationArtifactsDirectory(conversationId: string): string {
  return join(conversationDirectory(conversationId), "artifacts");
}

/**
 * Where a delete sets a file aside when the snapshot history cannot cover it.
 *
 * The shadow repository's work tree is the workspace root, so a path the user
 * granted outside it - a second folder on the project, their Downloads - has
 * no restore point when deleted. The delete tool moves such a path here
 * instead of destroying it, so "delete" is recoverable everywhere it can
 * reach, by one of two mechanisms that never overlap: inside the workspace
 * root the snapshot history is the recovery; outside it, this trash is.
 *
 * A sibling of `workspace/` rather than a child of it, and granted to no
 * sandbox root: trashed files are recovery state, not something the model
 * works with - the same reasoning that keeps `attachments/` and `artifacts/`
 * out of its reach. The delete tool's result names the entry it created, so
 * the model can tell the person where the file went without being able to
 * touch it again.
 *
 * Retention needs no second mechanism: the tree is inside the conversation's
 * own directory, so a purge of the conversation destroys it, and until then
 * nothing sweeps - the same doctrine `conversations/purge.ts` states for the
 * rest of the tree. Nothing else needs to know this directory exists.
 */
export function conversationTrashDirectory(conversationId: string): string {
  return join(conversationDirectory(conversationId), "trash");
}

/**
 * Creates a directory inside the Studio home, and returns it.
 *
 * Callers create what they need when they need it. Creating the whole tree at
 * startup would leave a new user with a dozen empty directories describing
 * features they have not used.
 */
export function ensureDirectory(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

/**
 * Resolves a user-configured path.
 *
 * A relative value is taken as relative to the Studio home rather than the
 * working directory, so configuration means the same thing regardless of where
 * the process was started.
 *
 * **`..` is refused, not normalised away.** `join` resolves `..` silently, so
 * `../../elsewhere/studio.db` used to land outside the Studio home while still
 * looking like a relative setting. That is not an attack — nobody is defending
 * against the user, who can write an absolute path and is entitled to. It is
 * that "relative to the Studio home" and "somewhere else entirely" must not be
 * the same expression. Anyone who means outside the home says so with an
 * absolute path, and then it is visible in the setting rather than hidden in
 * its resolution.
 */
export function resolveConfigured(value: string): string {
  if (isAbsolute(value)) return value;

  const home = studioHome();
  const resolved = resolve(home, value);
  if (!isInsideHome(home, resolved)) {
    // Classified rather than a raw `Error`: every throw in `src` belongs to a
    // domain, and a configured location that cannot be used is a storage
    // problem whatever the caller intended to keep there.
    throw new StorageError("invalid", {
      message:
        `The configured path "${value}" resolves outside the Studio home. ` +
        "Use an absolute path if that is what you meant.",
    });
  }

  return resolved;
}

/** Path-segment containment, not a string prefix: `~/.studio-old` is outside. */
function isInsideHome(home: string, candidate: string): boolean {
  const difference = relative(home, candidate);
  return (
    difference !== "" &&
    !difference.startsWith("..") &&
    !isAbsolute(difference)
  );
}
