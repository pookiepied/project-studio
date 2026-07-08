import { promises as fs } from "fs";
import { join } from "path";

interface Entry {
  name: string;
  type: "file" | "directory";
  size?: number;
  children?: Entry[];
}

async function listDir(dirPath: string, recursive: boolean): Promise<Entry[]> {
  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  const result: Entry[] = [];

  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue;
    const fullPath = join(dirPath, dirent.name);

    if (dirent.isDirectory()) {
      const entry: Entry = { name: dirent.name, type: "directory" };
      if (recursive) {
        entry.children = await listDir(fullPath, true);
      }
      result.push(entry);
    } else if (dirent.isFile()) {
      const stat = await fs.stat(fullPath);
      result.push({ name: dirent.name, type: "file", size: stat.size });
    }
  }

  return result;
}

export async function listDirectory(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const dirPath = (args.path as string) || process.cwd();
  const recursive = (args.recursive as boolean) || false;

  let entries: Entry[];
  try {
    entries = await listDir(dirPath, recursive);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return { error: `Directory not found: ${dirPath}. Verify the path exists.` };
    }
    if (e.code === "ENOTDIR") {
      return { error: `${dirPath} is a file, not a directory. Use read_file to read its contents.` };
    }
    return { error: `Failed to list directory: ${e.message}` };
  }

  return { path: dirPath, entries, count: entries.length };
}
