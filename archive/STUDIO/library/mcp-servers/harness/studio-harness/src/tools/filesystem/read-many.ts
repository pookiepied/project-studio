import { readFile } from "./read.js";

export async function readManyFiles(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const requests = args.requests as Record<string, unknown>[];
  if (!Array.isArray(requests) || requests.length === 0) return { error: "requests must be a non-empty array" };
  const maxFiles = Math.min((args.max_files as number) || 20, 100);
  const maxTotalBytes = Math.min((args.max_total_bytes as number) || 512 * 1024, 5 * 1024 * 1024);
  const selected = requests.slice(0, maxFiles);
  let remaining = maxTotalBytes;
  const results: Record<string, unknown>[] = [];
  for (const request of selected) {
    if (remaining <= 0) break;
    // Isolate each read: one missing/unreadable file must not discard the files
    // that read successfully (readFile throws on a bad path).
    try {
      const result = await readFile({ ...request, max_bytes: Math.min((request.max_bytes as number) || remaining, remaining) });
      remaining -= (result.bytes_returned as number) || 0;
      results.push({ path: request.path, ...result });
    } catch (e: any) {
      results.push({ path: request.path, error: e?.message ?? String(e) });
    }
  }
  return { results, files_requested: requests.length, files_returned: results.length, bytes_returned: maxTotalBytes - remaining, truncated: results.length < requests.length || remaining <= 0 };
}
