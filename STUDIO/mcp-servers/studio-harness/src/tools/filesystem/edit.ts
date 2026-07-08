import { promises as fs } from "fs";

export async function editFile(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const filePath = args.path as string;
  const oldString = args.old_string as string;
  const newString = args.new_string as string;

  if (!filePath) return { error: "path is required" };
  if (oldString === undefined) return { error: "old_string is required" };
  if (newString === undefined) return { error: "new_string is required" };

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return {
      error: `File not found: ${filePath}. Verify the path with ls or glob before editing.`,
    };
  }

  if (!content.includes(oldString)) {
    return {
      error:
        "old_string not found in file. It must match exactly including whitespace and newlines. " +
        "Use read_file with the relevant line range to copy the exact text, then retry.",
    };
  }

  const occurrences = content.split(oldString).length - 1;
  if (occurrences > 1) {
    return {
      error:
        `Found ${occurrences} occurrences of old_string — it must be unique. ` +
        `Add more surrounding context (extra lines before/after) to make it unambiguous.`,
    };
  }

  const updated = content.replace(oldString, newString);
  try {
    await fs.writeFile(filePath, updated, "utf-8");
  } catch (e: any) {
    return {
      error: `Failed to write file: ${e.message}. Check file permissions.`,
    };
  }

  return {
    success: true,
    path: filePath,
    note: "Edit applied. Use read_file to verify the result if needed.",
  };
}
