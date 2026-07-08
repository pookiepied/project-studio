import { promises as fs } from "fs";

interface MultiEditItem {
  path: string;
  old_string: string;
  new_string: string;
}

function countOccurrences(content: string, needle: string): number {
  if (needle === "") return 0;
  return content.split(needle).length - 1;
}

function parseEdit(value: unknown, index: number): MultiEditItem | { error: string } {
  if (!value || typeof value !== "object") {
    return { error: `edits[${index}] must be an object` };
  }

  const item = value as Record<string, unknown>;
  const filePath = item.path;
  const oldString = item.old_string;
  const newString = item.new_string;

  if (typeof filePath !== "string" || filePath.length === 0) {
    return { error: `edits[${index}].path is required` };
  }
  if (typeof oldString !== "string") {
    return { error: `edits[${index}].old_string is required` };
  }
  if (oldString.length === 0) {
    return { error: `edits[${index}].old_string must not be empty` };
  }
  if (typeof newString !== "string") {
    return { error: `edits[${index}].new_string is required` };
  }

  return { path: filePath, old_string: oldString, new_string: newString };
}

export async function multiEditFile(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const rawEdits = args.edits;

  if (!Array.isArray(rawEdits)) return { error: "edits must be an array" };
  if (rawEdits.length === 0) return { error: "edits must contain at least one edit" };

  const edits: MultiEditItem[] = [];
  for (let i = 0; i < rawEdits.length; i += 1) {
    const parsed = parseEdit(rawEdits[i], i);
    if ("error" in parsed) return parsed;
    edits.push(parsed);
  }

  const originals = new Map<string, string>();
  const staged = new Map<string, string>();

  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];

    let content = staged.get(edit.path);
    if (content === undefined) {
      try {
        content = await fs.readFile(edit.path, "utf-8");
      } catch {
        return {
          error: `edits[${i}]: file not found: ${edit.path}. Verify the path with ls or glob before editing.`,
        };
      }
      originals.set(edit.path, content);
    }

    const occurrences = countOccurrences(content, edit.old_string);
    if (occurrences === 0) {
      return {
        error:
          `edits[${i}]: old_string not found in ${edit.path}. ` +
          "Each old_string must match exactly at the point it is applied.",
      };
    }
    if (occurrences > 1) {
      return {
        error:
          `edits[${i}]: found ${occurrences} occurrences of old_string in ${edit.path}. ` +
          "Add surrounding context to make the replacement unique.",
      };
    }

    staged.set(edit.path, content.replace(edit.old_string, edit.new_string));
  }

  const changedFiles = Array.from(staged.keys());
  const writtenFiles: string[] = [];
  for (const filePath of changedFiles) {
    try {
      await fs.writeFile(filePath, staged.get(filePath) as string, "utf-8");
      writtenFiles.push(filePath);
    } catch (e: any) {
      for (const writtenPath of writtenFiles.reverse()) {
        const original = originals.get(writtenPath);
        if (original !== undefined) {
          try {
            await fs.writeFile(writtenPath, original, "utf-8");
          } catch {
            // Best-effort rollback; preserve the original write failure below.
          }
        }
      }
      return {
        error: `Failed to write ${filePath}: ${e.message}. Rolled back previously written files where possible.`,
      };
    }
  }

  return {
    success: true,
    edits_applied: edits.length,
    files_changed: changedFiles,
  };
}
