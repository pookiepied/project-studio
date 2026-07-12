import { glob } from "glob";

export async function globFiles(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const pattern = args.pattern as string;
  const searchPath = (args.path as string) || process.cwd();

  if (!pattern) return { error: "pattern is required" };

  let files: string[];
  try {
    files = await glob(pattern, {
      cwd: searchPath,
      absolute: true,
      dot: false,
    });
  } catch (e: any) {
    return {
      error: `Glob failed: ${e.message}. Check that the pattern is valid and the path exists.`,
    };
  }

  files.sort((a, b) => a.localeCompare(b));

  return { files, count: files.length };
}
