import { execFile } from "child_process";
import { promisify } from "util";

import { TOOL_TIMEOUTS } from "../tool-contract.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_CHARS = 50_000;
const GIT_TIMEOUT_MS = TOOL_TIMEOUTS.LOCAL_PROCESS;
// Network operations (push/pull/fetch) get more time — they depend on remote
// latency and pack-transfer speeds which can be slow on large repos.
const GIT_NETWORK_TIMEOUT_MS = TOOL_TIMEOUTS.NETWORK;

async function runGit(
  gitArgs: string[],
  cwd: string,
  timeoutMs: number = GIT_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", gitArgs, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return { stdout: result.stdout as string, stderr: result.stderr as string, exitCode: 0 };
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return { stdout: "", stderr: "git not found — is git installed and in PATH?", exitCode: 127 };
    }
    if (e.killed || e.signal) {
      return {
        stdout: String(e.stdout ?? ""),
        stderr:
          `git command timed out after ${timeoutMs / 1000}s and was killed. ` +
          `Likely cause: waiting for a credential prompt or a very large repo operation. ` +
          `For network operations (push, pull, clone, fetch) use the bash tool with timeout: 120000 or higher.`,
        exitCode: -1,
      };
    }
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? e.message),
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

function maybeTruncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
  return {
    text:
      text.slice(0, MAX_OUTPUT_CHARS) +
      `\n\n[Output truncated — ${text.length.toLocaleString()} chars total, first ${MAX_OUTPUT_CHARS.toLocaleString()} shown]`,
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// git_status
// ---------------------------------------------------------------------------

export async function gitStatus(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd = (args.cwd as string) || process.cwd();

  const [statusResult, branchResult] = await Promise.all([
    runGit(["status", "--porcelain=v1"], cwd),
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
  ]);

  if (statusResult.stderr.toLowerCase().includes("not a git repository")) {
    return { error: "Not a git repository", exit_code: 128 };
  }

  const branch = branchResult.stdout.trim() || "unknown";
  const lines = statusResult.stdout.split("\n").filter(Boolean);

  const changes = lines.map((line) => ({
    status: line.slice(0, 2).trim(),
    path: line.slice(3),
  }));

  const staged   = changes.filter((c) => c.status[0] && c.status[0] !== " " && c.status[0] !== "?");
  const unstaged = changes.filter((c) => c.status[1] && c.status[1] !== " " && c.status[0] !== "?");
  const untracked = changes.filter((c) => c.status.startsWith("?"));

  // Best-effort tracking info (fails gracefully if no upstream)
  const trackingResult = await runGit(
    ["rev-list", "--count", "--left-right", "@{upstream}...HEAD"],
    cwd
  );
  let tracking: { behind: number; ahead: number } | undefined;
  if (trackingResult.exitCode === 0) {
    const parts = trackingResult.stdout.trim().split("\t");
    if (parts.length === 2) {
      tracking = { behind: parseInt(parts[0], 10), ahead: parseInt(parts[1], 10) };
    }
  }

  return {
    branch,
    ...(tracking && { tracking }),
    clean: changes.length === 0,
    staged,
    unstaged,
    untracked,
    all_changes: changes,
    exit_code: statusResult.exitCode,
  };
}

// ---------------------------------------------------------------------------
// git_diff
// ---------------------------------------------------------------------------

export async function gitDiff(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd    = (args.cwd as string) || process.cwd();
  const staged = (args.staged as boolean) ?? false;
  const file   = args.file as string | undefined;
  const stat   = (args.stat as boolean) ?? false;

  const gitArgs = ["diff"];
  if (staged) gitArgs.push("--staged");
  if (stat)   gitArgs.push("--stat");
  if (file)   gitArgs.push("--", file);

  const result = await runGit(gitArgs, cwd);
  const out = maybeTruncate(result.stdout);

  return {
    diff: out.text,
    ...(out.truncated && { truncated: true }),
    staged,
    exit_code: result.exitCode,
    ...(result.stderr && { stderr: result.stderr }),
  };
}

// ---------------------------------------------------------------------------
// git_log
// ---------------------------------------------------------------------------

export async function gitLog(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd    = (args.cwd as string) || process.cwd();
  const limit  = (args.limit as number) ?? 20;
  const file   = args.file as string | undefined;
  const format = (args.format as string) ?? "short";

  const formatFlag =
    format === "full"
      ? "--format=%H%nAuthor: %an <%ae>%nDate:   %ad%n%n    %s%n%b%n"
      : "--format=%h %s (%an, %ar)";

  const gitArgs = ["log", `-${limit}`, formatFlag];
  if (file) gitArgs.push("--", file);

  const result = await runGit(gitArgs, cwd);
  const out = maybeTruncate(result.stdout);

  return {
    log: out.text,
    ...(out.truncated && { truncated: true }),
    exit_code: result.exitCode,
    ...(result.stderr && { stderr: result.stderr }),
  };
}

// ---------------------------------------------------------------------------
// git_commit
// ---------------------------------------------------------------------------

export async function gitCommit(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd        = (args.cwd as string) || process.cwd();
  const message    = args.message as string;
  const files      = args.files as string[] | undefined;
  const addAll     = (args.add_all as boolean) ?? false;
  const commitTimeout = (args.timeout as number) ?? GIT_TIMEOUT_MS;

  if (!message?.trim()) {
    return { success: false, error: "Commit message is required", exit_code: 1 };
  }

  if (addAll) {
    const r = await runGit(["add", "-A"], cwd);
    if (r.exitCode !== 0) {
      return { success: false, error: `git add -A failed: ${r.stderr}`, exit_code: r.exitCode };
    }
  } else if (files && files.length > 0) {
    const r = await runGit(["add", "--", ...files], cwd);
    if (r.exitCode !== 0) {
      return { success: false, error: `git add failed: ${r.stderr}`, exit_code: r.exitCode };
    }
  }

  const result = await runGit(["commit", "-m", message], cwd, commitTimeout);

  return {
    success: result.exitCode === 0,
    output: result.stdout.trim(),
    ...(result.stderr && { stderr: result.stderr }),
    exit_code: result.exitCode,
  };
}

// ---------------------------------------------------------------------------
// git_branch
// ---------------------------------------------------------------------------

export async function gitBranch(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd    = (args.cwd as string) || process.cwd();
  const action = (args.action as string) ?? "list";
  const name   = args.name as string | undefined;

  let gitArgs: string[];
  switch (action) {
    case "list":
      gitArgs = ["branch", "-a", "--format=%(HEAD) %(refname:short)"];
      break;
    case "create":
      if (!name) return { error: "'name' is required for create", exit_code: 1 };
      gitArgs = ["checkout", "-b", name];
      break;
    case "switch":
      if (!name) return { error: "'name' is required for switch", exit_code: 1 };
      gitArgs = ["checkout", name];
      break;
    case "delete":
      if (!name) return { error: "'name' is required for delete", exit_code: 1 };
      gitArgs = ["branch", "-d", name];
      break;
    default:
      return { error: `Unknown action '${action}'. Use: list | create | switch | delete`, exit_code: 1 };
  }

  const result = await runGit(gitArgs, cwd);

  return {
    success: result.exitCode === 0,
    output: result.stdout.trim(),
    ...(result.stderr && { stderr: result.stderr }),
    exit_code: result.exitCode,
  };
}

// ---------------------------------------------------------------------------
// git_push
// ---------------------------------------------------------------------------

export async function gitPush(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd          = (args.cwd as string)     || process.cwd();
  const remote       = (args.remote as string)  ?? "origin";
  const branch       = args.branch as string | undefined;
  const force        = (args.force as boolean)  ?? false;
  const setUpstream  = (args.set_upstream as boolean) ?? false;
  const timeout      = (args.timeout as number) ?? GIT_NETWORK_TIMEOUT_MS;

  const gitArgs = ["push", "--no-progress", remote];
  if (branch)      gitArgs.push(branch);
  if (force)       gitArgs.push("--force-with-lease"); // safer than --force
  if (setUpstream) gitArgs.push("--set-upstream");

  const result = await runGit(gitArgs, cwd, timeout);
  // git push writes progress to stderr even on success — treat stderr as info
  const output = (result.stdout.trim() || result.stderr.trim());
  const out = maybeTruncate(output);

  return {
    success: result.exitCode === 0,
    output: out.text,
    ...(out.truncated && { truncated: true }),
    exit_code: result.exitCode,
    ...(result.exitCode !== 0 && { hint: "Push failed. Common causes: (1) remote has commits your local branch doesn't have — run git_pull first; (2) no upstream branch — set set_upstream: true; (3) credentials missing — use the bash tool with a credential-carrying remote URL." }),
  };
}

// ---------------------------------------------------------------------------
// git_pull
// ---------------------------------------------------------------------------

export async function gitPull(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd     = (args.cwd as string)    || process.cwd();
  const remote  = (args.remote as string) ?? "origin";
  const branch  = args.branch as string | undefined;
  const rebase  = (args.rebase as boolean) ?? false;
  const timeout = (args.timeout as number) ?? GIT_NETWORK_TIMEOUT_MS;

  const gitArgs = ["pull", "--no-progress", remote];
  if (branch) gitArgs.push(branch);
  if (rebase) gitArgs.push("--rebase");

  const result = await runGit(gitArgs, cwd, timeout);
  const out = maybeTruncate(result.stdout.trim() || result.stderr.trim());

  return {
    success: result.exitCode === 0,
    output: out.text,
    ...(out.truncated && { truncated: true }),
    exit_code: result.exitCode,
    ...(result.exitCode !== 0 && { hint: "Pull failed. Check for merge conflicts (git_status) or use rebase: true to rebase instead of merge." }),
  };
}

// ---------------------------------------------------------------------------
// git_fetch
// ---------------------------------------------------------------------------

export async function gitFetch(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd     = (args.cwd as string)    || process.cwd();
  const remote  = (args.remote as string) ?? "origin";
  const all     = (args.all as boolean)   ?? false;
  const prune   = (args.prune as boolean) ?? false;
  const timeout = (args.timeout as number) ?? GIT_NETWORK_TIMEOUT_MS;

  const gitArgs = ["fetch", "--no-progress"];
  if (prune) gitArgs.push("--prune");
  if (all)   gitArgs.push("--all");
  else       gitArgs.push(remote);

  const result = await runGit(gitArgs, cwd, timeout);
  const out = maybeTruncate(result.stdout.trim() || result.stderr.trim());

  return {
    success: result.exitCode === 0,
    output: out.text,
    ...(out.truncated && { truncated: true }),
    exit_code: result.exitCode,
  };
}

// ---------------------------------------------------------------------------
// git_show — inspect a commit or a file at a revision (read-only)
// ---------------------------------------------------------------------------

export async function gitShow(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd  = (args.cwd as string) || process.cwd();
  const ref  = (args.ref as string) ?? "HEAD";
  const file = args.file as string | undefined;
  const stat = (args.stat as boolean) ?? false;

  // `git show <ref>` prints the commit; `git show <ref>:<file>` prints the file
  // contents at that revision. --stat swaps the patch for a file-level summary.
  const gitArgs = ["show"];
  if (stat) gitArgs.push("--stat");
  gitArgs.push(file ? `${ref}:${file}` : ref);

  const result = await runGit(gitArgs, cwd);
  if (result.stderr.toLowerCase().includes("not a git repository")) {
    return { error: "Not a git repository", exit_code: 128 };
  }
  const out = maybeTruncate(result.stdout);

  return {
    success: result.exitCode === 0,
    ref,
    ...(file && { file }),
    output: out.text,
    ...(out.truncated && { truncated: true }),
    exit_code: result.exitCode,
    ...(result.exitCode !== 0 && result.stderr && { stderr: result.stderr }),
  };
}

// ---------------------------------------------------------------------------
// git_stash — save/list/apply/pop/drop working-tree changes
// ---------------------------------------------------------------------------

export async function gitStash(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd            = (args.cwd as string) || process.cwd();
  const action         = (args.action as string) ?? "list";
  const message        = args.message as string | undefined;
  const includeUntracked = (args.include_untracked as boolean) ?? false;
  const ref            = (args.ref as string) ?? undefined; // e.g. stash@{1}

  let gitArgs: string[];
  switch (action) {
    case "list":
      gitArgs = ["stash", "list"];
      break;
    case "save":
    case "push":
      gitArgs = ["stash", "push"];
      if (includeUntracked) gitArgs.push("--include-untracked");
      if (message) gitArgs.push("-m", message);
      break;
    case "apply":
      gitArgs = ["stash", "apply", ...(ref ? [ref] : [])];
      break;
    case "pop":
      gitArgs = ["stash", "pop", ...(ref ? [ref] : [])];
      break;
    case "drop":
      gitArgs = ["stash", "drop", ...(ref ? [ref] : [])];
      break;
    case "show":
      gitArgs = ["stash", "show", "-p", ...(ref ? [ref] : [])];
      break;
    default:
      return { error: `Unknown action '${action}'. Use: list | save | apply | pop | drop | show`, exit_code: 1 };
  }

  const result = await runGit(gitArgs, cwd);
  if (result.stderr.toLowerCase().includes("not a git repository")) {
    return { error: "Not a git repository", exit_code: 128 };
  }
  const out = maybeTruncate(result.stdout.trim() || result.stderr.trim());

  return {
    success: result.exitCode === 0,
    action,
    output: out.text,
    ...(out.truncated && { truncated: true }),
    exit_code: result.exitCode,
  };
}

// ---------------------------------------------------------------------------
// git_worktree — manage linked working trees (parallel checkouts)
// ---------------------------------------------------------------------------

export async function gitWorktree(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd    = (args.cwd as string) || process.cwd();
  const action = (args.action as string) ?? "list";
  const wtPath = args.path as string | undefined;
  const branch = args.branch as string | undefined;
  const force  = (args.force as boolean) ?? false;

  let gitArgs: string[];
  switch (action) {
    case "list":
      gitArgs = ["worktree", "list", "--porcelain"];
      break;
    case "add":
      if (!wtPath) return { error: "'path' is required for add", exit_code: 1 };
      // `-b <branch>` creates a new branch at the worktree; without it, an
      // existing branch (or the given commit-ish) is checked out.
      gitArgs = ["worktree", "add"];
      if (branch) gitArgs.push("-b", branch);
      gitArgs.push(wtPath);
      break;
    case "remove":
      if (!wtPath) return { error: "'path' is required for remove", exit_code: 1 };
      gitArgs = ["worktree", "remove", ...(force ? ["--force"] : []), wtPath];
      break;
    case "prune":
      gitArgs = ["worktree", "prune"];
      break;
    default:
      return { error: `Unknown action '${action}'. Use: list | add | remove | prune`, exit_code: 1 };
  }

  const result = await runGit(gitArgs, cwd);
  if (result.stderr.toLowerCase().includes("not a git repository")) {
    return { error: "Not a git repository", exit_code: 128 };
  }
  const out = maybeTruncate(result.stdout.trim() || result.stderr.trim());

  return {
    success: result.exitCode === 0,
    action,
    output: out.text,
    ...(out.truncated && { truncated: true }),
    exit_code: result.exitCode,
    ...(result.exitCode !== 0 && action === "add" && {
      hint: "worktree add failed. Common causes: (1) path already exists; (2) branch already checked out in another worktree; (3) branch name already exists — omit 'branch' to check it out instead of creating it.",
    }),
  };
}
