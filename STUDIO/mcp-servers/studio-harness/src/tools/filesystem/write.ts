import { promises as fs } from "fs";
import { dirname } from "path";

export async function writeFile(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const filePath = args.path as string;
  const content = args.content as string;

  if (!filePath) return { error: "path is required" };
  if (content === undefined) return { error: "content is required" };

  try {
    await fs.mkdir(dirname(filePath), { recursive: true });
  } catch (e: any) {
    return {
      error: `Failed to create directory for ${filePath}: ${e.message}. Check path and permissions.`,
    };
  }

  try {
    await fs.writeFile(filePath, content, "utf-8");
  } catch (e: any) {
    return {
      error: `Failed to write file ${filePath}: ${e.message}. Check file permissions.`,
    };
  }

  return {
    success: true,
    path: filePath,
    bytes_written: Buffer.byteLength(content, "utf-8"),
  };
}
