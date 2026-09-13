import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { StorageError } from "../storage/errors.js";
import { normalizeScopePath } from "./scope.js";

/**
 * The PC's directories, listed for a picker.
 *
 * A folder is chosen on the machine it lives on. The desktop app opens the
 * operating system's own dialog for that; a browser tab paired over the
 * network has no such dialog, because the file system being chosen is the
 * PC's, not the phone's. So the harness lists directories itself, and the
 * picker on any surface walks this listing (ADR 0050, step 6). The desktop
 * app keeps its native dialog; this is also the honest answer for its own
 * future needs, which is why it lives in the sandbox module rather than in a
 * transport-only helper.
 *
 * ---- Why browsing is wider than choosing -----------------------------------
 *
 * This listing deliberately does NOT apply `systemScopeRefusal`. A volume root
 * and the system directory must be reachable positions, or there is no way to
 * navigate past them to the folder actually wanted - the native picker walks
 * through `C:\\` too. The rules that guard a *choice* stay where the choice is
 * made: `validateFolderPath` refuses roots and system directories when a
 * folder row is written, and the surface carrying the choice shows that
 * refusal's sentence verbatim. One mark one rule - the wall is the write, not
 * the walk.
 */

interface BrowsedDirectory {
  /** The directory's own last segment, as the file system spells it. */
  readonly name: string;
  /** The absolute path to open when the person walks into it. */
  readonly path: string;
}

export interface FolderListing {
  /** The directory listed, normalized absolute. */
  readonly path: string;
  /**
   * The parent to offer as the way back out, or null where there is no wider
   * directory. Null, not the path again: a volume root's parent is itself,
   * and an "up" that lands where you are is a control that does nothing.
   */
  readonly parent: string | null;
  /** The child directories, names first. Files are not a position to walk to. */
  readonly directories: readonly BrowsedDirectory[];
}

function stat(path: string): { isDirectory(): boolean } | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/**
 * The child directories of one directory on this machine.
 *
 * With no path the listing opens at the person's home directory, the same
 * place a native picker usually starts; the caller never has to know where
 * home is to open the browser. A path that is not absolute, not there, or not
 * a directory is refused with a sentence - the same vocabulary the folder
 * write uses, because the person reading it just walked somewhere and the
 * answer should say where the walk stopped.
 */
export function browseFolders(
  requested: string | undefined,
  home: string = homedir(),
): FolderListing {
  const raw = requested === undefined || requested.trim() === "" ? home : requested;
  if (!isAbsolute(raw)) {
    throw new StorageError("invalid", {
      message: `That path is not absolute (${raw}). A folder browser names an absolute directory.`,
    });
  }
  const absolute = normalizeScopePath(raw);
  const found = stat(absolute);
  if (found === undefined) {
    throw new StorageError("invalid", {
      message: `That path does not exist (${absolute}). A folder browser names a directory that is there.`,
    });
  }
  if (!found.isDirectory()) {
    throw new StorageError("invalid", {
      message: `That path is not a directory (${absolute}). A folder browser lists a directory.`,
    });
  }

  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    throw new StorageError("invalid", {
      message: `That directory could not be read (${absolute}).`,
    });
  }

  // Directories only, names sorted the way a person scans them - case for the
  // letter, not for the sort. Entries the file system marks `$…` are the
  // volume's own bookkeeping ($Recycle.Bin and its kin), never a project, and
  // only clutter a picker.
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("$"))
    .map((entry) => ({ name: entry.name, path: join(absolute, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const parent = dirname(absolute);
  return {
    path: absolute,
    parent: parent === absolute ? null : parent,
    directories,
  };
}
