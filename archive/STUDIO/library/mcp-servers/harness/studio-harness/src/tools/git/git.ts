import { execFile } from "child_process";
import { promisify } from "util";

import { TOOL_TIMEOUTS } from "../tool-contract.js";
import { resolveGit } from "../shared/vendor.js";

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
    // Vendored Git-for-Windows (bundled under vendor/git) → PATH `git`.
    const result = await execFileAsync(resolveGit(), gitArgs, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: timeoutMs,
      // GIT_TERMINAL_PROMPT=0: a missing credential fails fast instead of blocking
      // on a hidden prompt until the timeout. LC_ALL=C: force English messages so
      // the "not a git repository" substring checks work under any locale.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    return { stdout: result.stdout as string, stderr: result.stderr as string, exitCode: 0 };
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return { stdout: "", stderr: "git not found. STUDIO bundles git under vendor/git — reinstall/repair STUDIO, or run `npm run vendor:sync git` in a dev checkout.", exitCode: 127 };
    }
    if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return {
        stdout: String(e.stdout ?? ""),
        stderr:
          `git produced more than 20 MB of output. Narrow the command ` +
          `(add paths, --max-count, or -- <file>), or run it via the bash tool ` +
          `redirecting output to a file.`,
        exitCode: -1,
      };
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

// ---------------------------------------------------------------------------
// Shared result shaper for the simple mutating commands below.
// ---------------------------------------------------------------------------

function gitResult(
  result: { stdout: string; stderr: string; exitCode: number },
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const out = maybeTruncate(result.stdout.trim() || result.stderr.trim());
  return {
    success: result.exitCode === 0,
    output: out.text,
    ...(out.truncated && { truncated: true }),
    exit_code: result.exitCode,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// git_init — initialize a new repository
// ---------------------------------------------------------------------------

export async function gitInit(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd           = (args.cwd as string) || process.cwd();
  const initialBranch = args.initial_branch as string | undefined;
  const bare          = (args.bare as boolean) ?? false;

  const gitArgs = ["init"];
  if (initialBranch) gitArgs.push("-b", initialBranch);
  if (bare)          gitArgs.push("--bare");

  return gitResult(await runGit(gitArgs, cwd));
}

// ---------------------------------------------------------------------------
// git_add — stage files
// ---------------------------------------------------------------------------

export async function gitAdd(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd   = (args.cwd as string) || process.cwd();
  const files = args.files as string[] | undefined;
  const all   = (args.all as boolean) ?? false;

  if (!all && (!files || files.length === 0)) {
    return { success: false, error: "Provide 'files' or set all: true", exit_code: 1 };
  }
  const gitArgs = all ? ["add", "-A"] : ["add", "--", ...files!];
  return gitResult(await runGit(gitArgs, cwd));
}

// ---------------------------------------------------------------------------
// git_reset — unstage files or move HEAD (soft/mixed/hard)
// ---------------------------------------------------------------------------

export async function gitReset(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd   = (args.cwd as string) || process.cwd();
  const mode  = (args.mode as string) ?? "mixed";
  const ref   = args.ref as string | undefined;
  const files = args.files as string[] | undefined;

  let gitArgs: string[];
  if (files && files.length > 0) {
    // Unstage specific paths — mode is ignored in this form.
    gitArgs = ["reset", ...(ref ? [ref] : []), "--", ...files];
  } else {
    const flag =
      ({ soft: "--soft", mixed: "--mixed", hard: "--hard", keep: "--keep", merge: "--merge" } as Record<string, string>)[mode];
    if (!flag) return { error: `Unknown mode '${mode}'. Use: soft | mixed | hard | keep | merge`, exit_code: 1 };
    gitArgs = ["reset", flag, ...(ref ? [ref] : [])];
  }
  return gitResult(await runGit(gitArgs, cwd), {
    ...(mode === "hard" && { warning: "--hard discards all uncommitted changes to tracked files irreversibly." }),
  });
}

// ---------------------------------------------------------------------------
// git_restore — discard working-tree changes or restore from a source
// ---------------------------------------------------------------------------

export async function gitRestore(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd    = (args.cwd as string) || process.cwd();
  const files  = args.files as string[] | undefined;
  const staged = (args.staged as boolean) ?? false;
  const source = args.source as string | undefined;

  if (!files || files.length === 0) return { error: "'files' is required", exit_code: 1 };

  const gitArgs = ["restore"];
  if (staged)  gitArgs.push("--staged");
  if (source)  gitArgs.push("--source", source);
  gitArgs.push("--", ...files);

  return gitResult(await runGit(gitArgs, cwd));
}

// ---------------------------------------------------------------------------
// git_rm — remove tracked files
// ---------------------------------------------------------------------------

export async function gitRm(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd       = (args.cwd as string) || process.cwd();
  const files     = args.files as string[] | undefined;
  const cached    = (args.cached as boolean) ?? false;
  const recursive = (args.recursive as boolean) ?? false;

  if (!files || files.length === 0) return { error: "'files' is required", exit_code: 1 };

  const gitArgs = ["rm"];
  if (cached)    gitArgs.push("--cached");     // untrack but keep on disk
  if (recursive) gitArgs.push("-r");
  gitArgs.push("--", ...files);

  return gitResult(await runGit(gitArgs, cwd));
}

// ---------------------------------------------------------------------------
// git_mv — move/rename a tracked file
// ---------------------------------------------------------------------------

export async function gitMv(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd         = (args.cwd as string) || process.cwd();
  const source      = args.source as string | undefined;
  const destination = args.destination as string | undefined;

  if (!source || !destination) return { error: "'source' and 'destination' are required", exit_code: 1 };
  return gitResult(await runGit(["mv", "--", source, destination], cwd));
}

// ---------------------------------------------------------------------------
// git_merge — merge a branch into the current branch (non-interactive)
// ---------------------------------------------------------------------------

export async function gitMerge(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd     = (args.cwd as string) || process.cwd();
  const branch  = args.branch as string | undefined;
  const noFf    = (args.no_ff as boolean) ?? false;
  const abort   = (args.abort as boolean) ?? false;
  const message = args.message as string | undefined;

  let gitArgs: string[];
  if (abort) {
    gitArgs = ["merge", "--abort"];
  } else {
    if (!branch) return { error: "'branch' is required (or set abort: true)", exit_code: 1 };
    gitArgs = ["merge", "--no-edit"];
    if (noFf)    gitArgs.push("--no-ff");
    if (message) gitArgs.push("-m", message);
    gitArgs.push(branch);
  }

  const result = await runGit(gitArgs, cwd);
  return gitResult(result, {
    ...(result.exitCode !== 0 && !abort && {
      hint: "Merge failed — likely conflicts. Inspect with git_status/git_diff, resolve and git_add the files, then git_commit; or call again with abort: true to bail out.",
    }),
  });
}

// ---------------------------------------------------------------------------
// git_rebase — rebase the current branch (non-interactive)
// ---------------------------------------------------------------------------

export async function gitRebase(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd      = (args.cwd as string) || process.cwd();
  const upstream = args.upstream as string | undefined;
  const onto     = args.onto as string | undefined;
  const action   = args.action as string | undefined; // continue | abort | skip

  // Force a no-op editor so an in-progress rebase never blocks on a prompt.
  const noEditor = ["-c", "core.editor=true", "-c", "sequence.editor=true"];

  let gitArgs: string[];
  if (action) {
    if (!["continue", "abort", "skip"].includes(action))
      return { error: "action must be one of: continue | abort | skip", exit_code: 1 };
    gitArgs = [...noEditor, "rebase", `--${action}`];
  } else {
    if (!upstream) return { error: "'upstream' is required (or action: continue | abort | skip)", exit_code: 1 };
    gitArgs = [...noEditor, "rebase"];
    if (onto) gitArgs.push("--onto", onto);
    gitArgs.push(upstream);
  }

  const result = await runGit(gitArgs, cwd);
  return gitResult(result, {
    ...(result.exitCode !== 0 && action !== "abort" && {
      hint: "Rebase stopped — likely conflicts. Resolve and git_add the files, then call again with action: continue; or action: abort to bail out.",
    }),
  });
}

// ---------------------------------------------------------------------------
// git_cherry_pick — apply existing commits onto the current branch
// ---------------------------------------------------------------------------

export async function gitCherryPick(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd     = (args.cwd as string) || process.cwd();
  const commits = args.commits as string[] | undefined;
  const action  = args.action as string | undefined; // continue | abort | skip

  let gitArgs: string[];
  if (action) {
    if (!["continue", "abort", "skip"].includes(action))
      return { error: "action must be one of: continue | abort | skip", exit_code: 1 };
    gitArgs = ["-c", "core.editor=true", "cherry-pick", `--${action}`];
  } else {
    if (!commits || commits.length === 0)
      return { error: "'commits' is required (or action: continue | abort | skip)", exit_code: 1 };
    gitArgs = ["cherry-pick", "--no-edit", ...commits];
  }

  const result = await runGit(gitArgs, cwd);
  return gitResult(result, {
    ...(result.exitCode !== 0 && action !== "abort" && {
      hint: "Cherry-pick stopped — likely conflicts. Resolve and git_add, then action: continue; or action: abort.",
    }),
  });
}

// ---------------------------------------------------------------------------
// git_revert — create commits that undo existing commits
// ---------------------------------------------------------------------------

export async function gitRevert(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd      = (args.cwd as string) || process.cwd();
  const commits  = args.commits as string[] | undefined;
  const action   = args.action as string | undefined; // continue | abort | skip
  const noCommit = (args.no_commit as boolean) ?? false;

  let gitArgs: string[];
  if (action) {
    if (!["continue", "abort", "skip"].includes(action))
      return { error: "action must be one of: continue | abort | skip", exit_code: 1 };
    gitArgs = ["-c", "core.editor=true", "revert", `--${action}`];
  } else {
    if (!commits || commits.length === 0)
      return { error: "'commits' is required (or action: continue | abort | skip)", exit_code: 1 };
    gitArgs = ["revert", "--no-edit"];
    if (noCommit) gitArgs.push("--no-commit");
    gitArgs.push(...commits);
  }

  return gitResult(await runGit(gitArgs, cwd));
}

// ---------------------------------------------------------------------------
// git_tag — list / create / delete tags
// ---------------------------------------------------------------------------

export async function gitTag(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd     = (args.cwd as string) || process.cwd();
  const action  = (args.action as string) ?? "list";
  const name    = args.name as string | undefined;
  const message = args.message as string | undefined;
  const ref     = args.ref as string | undefined;

  let gitArgs: string[];
  switch (action) {
    case "list":
      gitArgs = ["tag", "--list"];
      break;
    case "create":
      if (!name) return { error: "'name' is required for create", exit_code: 1 };
      gitArgs = ["tag"];
      if (message) gitArgs.push("-a", name, "-m", message); // annotated
      else         gitArgs.push(name);                       // lightweight
      if (ref) gitArgs.push(ref);
      break;
    case "delete":
      if (!name) return { error: "'name' is required for delete", exit_code: 1 };
      gitArgs = ["tag", "-d", name];
      break;
    default:
      return { error: `Unknown action '${action}'. Use: list | create | delete`, exit_code: 1 };
  }
  return gitResult(await runGit(gitArgs, cwd), { action });
}

// ---------------------------------------------------------------------------
// git_remote — list / add / remove / set-url remotes
// ---------------------------------------------------------------------------

export async function gitRemote(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd    = (args.cwd as string) || process.cwd();
  const action = (args.action as string) ?? "list";
  const name   = args.name as string | undefined;
  const url    = args.url as string | undefined;

  let gitArgs: string[];
  switch (action) {
    case "list":
      gitArgs = ["remote", "-v"];
      break;
    case "add":
      if (!name || !url) return { error: "'name' and 'url' are required for add", exit_code: 1 };
      gitArgs = ["remote", "add", name, url];
      break;
    case "remove":
      if (!name) return { error: "'name' is required for remove", exit_code: 1 };
      gitArgs = ["remote", "remove", name];
      break;
    case "set-url":
      if (!name || !url) return { error: "'name' and 'url' are required for set-url", exit_code: 1 };
      gitArgs = ["remote", "set-url", name, url];
      break;
    default:
      return { error: `Unknown action '${action}'. Use: list | add | remove | set-url`, exit_code: 1 };
  }
  return gitResult(await runGit(gitArgs, cwd), { action });
}

// ---------------------------------------------------------------------------
// git_clone — clone a remote repository
// ---------------------------------------------------------------------------

export async function gitClone(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd       = (args.cwd as string) || process.cwd();
  const url       = args.url as string | undefined;
  const directory = args.directory as string | undefined;
  const depth     = args.depth as number | undefined;
  const branch    = args.branch as string | undefined;
  const timeout   = (args.timeout as number) ?? GIT_NETWORK_TIMEOUT_MS;

  if (!url) return { error: "'url' is required", exit_code: 1 };

  const gitArgs = ["clone", "--no-progress"];
  if (depth)  gitArgs.push("--depth", String(depth));
  if (branch) gitArgs.push("--branch", branch);
  gitArgs.push(url);
  if (directory) gitArgs.push(directory);

  const result = await runGit(gitArgs, cwd, timeout);
  return gitResult(result, {
    ...(result.exitCode !== 0 && {
      hint: "Clone failed. Common causes: (1) auth required — clone over HTTPS with a token in the URL or a configured credential helper; (2) destination directory already exists and is non-empty.",
    }),
  });
}

// ---------------------------------------------------------------------------
// git_blame — show last-modifying commit per line (read-only)
// ---------------------------------------------------------------------------

export async function gitBlame(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd   = (args.cwd as string) || process.cwd();
  const file  = args.file as string | undefined;
  const start = args.start_line as number | undefined;
  const end   = args.end_line as number | undefined;

  if (!file) return { error: "'file' is required", exit_code: 1 };

  const gitArgs = ["blame"];
  if (start && end) gitArgs.push("-L", `${start},${end}`);
  gitArgs.push("--", file);

  const result = await runGit(gitArgs, cwd);
  const out = maybeTruncate(result.stdout);
  return {
    success: result.exitCode === 0,
    file,
    output: out.text,
    ...(out.truncated && { truncated: true }),
    exit_code: result.exitCode,
    ...(result.exitCode !== 0 && result.stderr && { stderr: result.stderr }),
  };
}

// ---------------------------------------------------------------------------
// git_clean — remove untracked files (dry-run by default for safety)
// ---------------------------------------------------------------------------

export async function gitClean(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd         = (args.cwd as string) || process.cwd();
  const directories = (args.directories as boolean) ?? false;
  const dryRun      = (args.dry_run as boolean) ?? true;  // SAFE default: preview only
  const force       = (args.force as boolean) ?? false;

  const gitArgs = ["clean"];
  if (dryRun) {
    gitArgs.push("-n");
  } else {
    if (!force)
      return {
        error:
          "Refusing to delete: git clean permanently removes untracked files. " +
          "Preview with dry_run: true first, then pass force: true to actually delete.",
        exit_code: 1,
      };
    gitArgs.push("-f");
  }
  if (directories) gitArgs.push("-d");

  return gitResult(await runGit(gitArgs, cwd), { dry_run: dryRun });
}

// ---------------------------------------------------------------------------
// git_reflog — show the reference log (recover lost commits)
// ---------------------------------------------------------------------------

export async function gitReflog(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd   = (args.cwd as string) || process.cwd();
  const limit = (args.limit as number) ?? 30;

  const result = await runGit(["reflog", `-${limit}`], cwd);
  const out = maybeTruncate(result.stdout);
  return {
    success: result.exitCode === 0,
    output: out.text,
    ...(out.truncated && { truncated: true }),
    exit_code: result.exitCode,
    ...(result.exitCode !== 0 && result.stderr && { stderr: result.stderr }),
  };
}

// ---------------------------------------------------------------------------
// git_config — get / set / list / unset configuration
// ---------------------------------------------------------------------------

export async function gitConfig(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cwd    = (args.cwd as string) || process.cwd();
  const action = (args.action as string) ?? "get";
  const key    = args.key as string | undefined;
  const value  = args.value as string | undefined;
  const scope  = (args.scope as string) ?? "local"; // local | global
  const scopeFlag = scope === "global" ? "--global" : "--local";

  let gitArgs: string[];
  switch (action) {
    case "get":
      if (!key) return { error: "'key' is required for get", exit_code: 1 };
      gitArgs = ["config", scopeFlag, "--get", key];
      break;
    case "set":
      if (!key || value === undefined) return { error: "'key' and 'value' are required for set", exit_code: 1 };
      gitArgs = ["config", scopeFlag, key, String(value)];
      break;
    case "list":
      gitArgs = ["config", scopeFlag, "--list"];
      break;
    case "unset":
      if (!key) return { error: "'key' is required for unset", exit_code: 1 };
      gitArgs = ["config", scopeFlag, "--unset", key];
      break;
    default:
      return { error: `Unknown action '${action}'. Use: get | set | list | unset`, exit_code: 1 };
  }
  return gitResult(await runGit(gitArgs, cwd), { action, scope });
}
