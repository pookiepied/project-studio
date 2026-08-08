import { promises as fs } from "fs";
import { dirname } from "path";
import { formatCaughtError } from "../tool-contract.js";
import { getFileRevision, staleResult } from "./revision.js";

export async function moveFile(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const source      = args.source as string;
  const destination = args.destination as string;
  if (!source)      return { error: "source is required" };
  if (!destination) return { error: "destination is required" };

  try {
    const stat = await fs.stat(source);
    if (stat.isFile()) {
      const stale = staleResult(args.expected_revision ?? args.expected_hash, await getFileRevision(source));
      if (stale) return stale;
    }
  } catch {
    return { error: `Source not found: ${source}` };
  }

  try {
    const destDir = dirname(destination);
    await fs.mkdir(destDir, { recursive: true });
    await fs.rename(source, destination);
    return { success: true, moved: { from: source, to: destination } };
  } catch (e: any) {
    // fs.rename fails across drives/filesystems — fall back to copy + delete
    if (e.code === "EXDEV") {
      try {
        const destDir = dirname(destination);
        await fs.mkdir(destDir, { recursive: true });
        // copyFile fails with EISDIR on directories — branch on type so a
        // cross-drive directory move works the same as a file move.
        if ((await fs.stat(source)).isDirectory()) {
          await fs.cp(source, destination, { recursive: true, force: true });
          await fs.rm(source, { recursive: true, force: true });
        } else {
          await fs.copyFile(source, destination);
          await fs.unlink(source);
        }
        return {
          success: true,
          moved: { from: source, to: destination },
          note: "Cross-drive move: copied then deleted source",
        };
      } catch (e2) {
        return formatCaughtError("move_file", e2);
      }
    }
    return formatCaughtError("move_file", e);
  }
}
