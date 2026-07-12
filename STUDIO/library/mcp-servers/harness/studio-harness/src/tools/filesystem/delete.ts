import { promises as fs } from "fs";
import { formatCaughtError } from "../tool-contract.js";
import { getFileRevision, staleResult } from "./revision.js";

export async function deleteFile(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const filePath = args.path as string;
  if (!filePath) return { error: "path is required" };

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { error: `Not found: ${filePath}` };
  }

  if (stat.isDirectory()) {
    const recursive = (args.recursive as boolean) ?? false;
    if (!recursive) {
      return {
        error:
          `'${filePath}' is a directory. Pass recursive: true to delete it and all its contents. ` +
          `This is irreversible — confirm with the user before proceeding.`,
      };
    }
    try {
      await fs.rm(filePath, { recursive: true, force: true });
      return { success: true, deleted: filePath, type: "directory" };
    } catch (e) {
      return formatCaughtError("delete_file", e);
    }
  }

  const stale = staleResult(args.expected_revision ?? args.expected_hash, await getFileRevision(filePath));
  if (stale) return stale;

  try {
    await fs.unlink(filePath);
    return { success: true, deleted: filePath, type: "file" };
  } catch (e) {
    return formatCaughtError("delete_file", e);
  }
}
