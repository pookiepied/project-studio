import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
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
 *
 * A flat home does not survive contact with a real product — `~/.codex` has
 * over forty entries at its top level, and nothing about it says which of them
 * matter. The rule here: a new directory must belong to one of these six. If it
 * genuinely fits none of them, the category set is wrong and should be changed
 * deliberately, rather than a seventh sibling appearing at the top level.
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
 * The installation directory — where shipped assets live.
 *
 * Resolved from this module's own location, so it is correct whether running
 * from `src/`, from a build output, or from inside a packaged application.
 */
export function installationRoot(): string {
  return resolve(fileURLToPath(new URL("../../", import.meta.url)));
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

/** User-authored settings. Backed up, synced, and safe to hand-edit. */
export function configDirectory(): string {
  return studioPath("config");
}

export function settingsPath(): string {
  return join(configDirectory(), "settings.json");
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

/** Per-project state the application owns, keyed by project id. */
export function projectsDirectory(): string {
  return studioPath("data", "projects");
}

export function sessionsDirectory(): string {
  return studioPath("data", "sessions");
}

/**
 * Everything that must survive, for a backup or export to enumerate.
 *
 * Derived from the same accessors the rest of the application uses, so a new
 * durable directory cannot be added and then forgotten by the backup.
 */
export function durableDirectories(): readonly string[] {
  return [configDirectory(), studioPath("data")];
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
