import { execFile } from "child_process";
import { promisify } from "util";
import { resolveGit } from "../../shared/vendor.js";
import { relative, resolve } from "path";
import { promises as fs } from "fs";
const exec = promisify(execFile);
export type SearchScope = "workspace" | "working_tree" | "staged" | "branch_diff";
export async function scopedPaths(root: string, scope: SearchScope, baseRef = "HEAD"): Promise<string[] | undefined> {
  if (scope === "workspace") return undefined;
  const args = scope === "working_tree" ? ["status", "--porcelain=v1", "--untracked-files=all"] : scope === "staged" ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"] : ["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}...HEAD`];
  const [{ stdout }, top] = await Promise.all([exec(resolveGit(), args, { cwd: root, timeout: 20_000, maxBuffer: 5 * 1024 * 1024 }), exec(resolveGit(), ["rev-parse", "--show-toplevel"], { cwd: root, timeout: 20_000 })]);
  const repoRoot = String(top.stdout).trim(); const results:string[]=[];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const gitPath = scope === "working_tree" ? line.slice(3).trim().replace(/^.* -> /, "") : line.trim();
    const absolute = resolve(repoRoot, gitPath), local = relative(root, absolute).replace(/\\/g, "/");
    if (local.startsWith("../") || local === "..") continue;
    try { if ((await fs.stat(absolute)).isFile()) results.push(local); } catch { /* deleted paths are not searchable */ }
  }
  return results;
}
