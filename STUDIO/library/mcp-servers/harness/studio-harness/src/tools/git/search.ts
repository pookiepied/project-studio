import { execFile } from "child_process";
import { promisify } from "util";
import { resolveGit } from "../shared/vendor.js";
const exec = promisify(execFile);
export async function searchGitHistory(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const query = args.query as string; if (!query) return { error: "query is required" };
  const cwd = (args.cwd as string) || process.cwd(), mode = (args.mode as string) || "commit_message";
  if (mode === "historical_content") {
    const file = args.file as string; if (!file) return { error: "file is required for historical_content" };
    const limit = Math.min((args.max_commits as number) || 50, 1000), maxBytes = Math.min((args.max_output_bytes as number) || 500_000, 5_000_000);
    try {
      const revisions = await exec(resolveGit(), ["rev-list", `--max-count=${limit}`, args.all_refs ? "--all" : "HEAD", "--", file], { cwd, timeout: 30_000, maxBuffer: 1_000_000 });
      const matches: Record<string, unknown>[] = []; let bytes = 0, truncated = false;
      for (const commit of String(revisions.stdout).split(/\r?\n/).filter(Boolean)) {
        try { const found = await exec(resolveGit(), ["grep", "-n", "-F", query, commit, "--", file], { cwd, timeout: 10_000, maxBuffer: 1_000_000 }); for (const line of String(found.stdout).split(/\r?\n/).filter(Boolean)) { const item = { commit, match: line }; const size = Buffer.byteLength(JSON.stringify(item)); if (bytes + size > maxBytes) { truncated = true; break; } matches.push(item); bytes += size; } } catch { /* git grep exits 1 when absent */ }
        if (truncated) break;
      }
      return { mode, query, file, matches, commits_searched: Math.min(limit, String(revisions.stdout).split(/\r?\n/).filter(Boolean).length), truncated };
    } catch (e: any) { return { error: e.stderr || e.message }; }
  }
  const gitArgs: string[] = ["log", `--max-count=${Math.min((args.max_commits as number) || 50, 1000)}`, "--format=commit:%H%x09%an%x09%aI%x09%s"];
  if (mode === "commit_message") gitArgs.push("--regexp-ignore-case", `--grep=${query}`);
  else if (mode === "changed_string") gitArgs.push(`-S${query}`, "--pickaxe-all", "-p");
  else if (mode === "diff_regex") gitArgs.push(`-G${query}`, "--pickaxe-all", "-p");
  else return { error: "mode must be commit_message, changed_string, diff_regex, or historical_content" };
  if (args.all_refs) gitArgs.push("--all"); if (args.since) gitArgs.push(`--since=${args.since}`); if (args.until) gitArgs.push(`--until=${args.until}`); if (args.author) gitArgs.push(`--author=${args.author}`); if (args.file) gitArgs.push("--", args.file as string);
  try { const { stdout, stderr } = await exec(resolveGit(), gitArgs, { cwd, timeout: 30_000, maxBuffer: 5_000_000 }); const text = String(stdout), max = Math.min((args.max_output_bytes as number) || 500_000, 5_000_000); return { mode, query, output: text.slice(0, max), truncated: text.length > max, stderr: String(stderr || "") || undefined }; }
  catch (e: any) { return { error: e.stderr || e.message }; }
}
