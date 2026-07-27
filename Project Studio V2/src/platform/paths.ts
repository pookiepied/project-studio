import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
 * The layout follows what comparable tools converged on (`~/.claude`,
 * `~/.codex`): one dotted directory per product, subdirectories by concern,
 * versioned filenames for anything downloaded.
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
  return studioPath("bin");
}

/** The application database. One file, in the user's home, never in a project. */
export function databasePath(): string {
  return studioPath("studio.db");
}

/**
 * Per-project shadow git repositories — the undo history.
 *
 * Deliberately outside the project. A snapshot store inside the repository
 * would show up in the user's own `git status`, and would be destroyed by the
 * very `rm -rf` it exists to recover from.
 */
export function snapshotsDirectory(): string {
  return studioPath("snapshots");
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
  return studioPath("projects");
}

export function sessionsDirectory(): string {
  return studioPath("sessions");
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
 */
export function resolveConfigured(value: string): string {
  return isAbsolute(value) ? value : studioPath(value);
}
