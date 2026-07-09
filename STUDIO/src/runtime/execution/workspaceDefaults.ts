/**
 * Workspace-default path injection for Studio Harness tools.
 *
 * Extracted from the former features/chat/context/toolExecutor.ts. When a
 * Studio Harness tool is called without an explicit path/cwd, default it to
 * the open workspace root so the agent operates inside the user's project.
 */

/** Apply workspace-root defaults to pathless Studio Harness tool args. */
export function applyWorkspaceDefaults(
  server: string,
  toolName: string,
  args: Record<string, unknown>,
  workspaceRoot: string | null
): Record<string, unknown> {
  if (server !== "studio-harness" || !workspaceRoot) return args;

  const next = { ...args };
  const setIfMissing = (key: string) => {
    if (typeof next[key] !== "string" || (next[key] as string).trim().length === 0) {
      next[key] = workspaceRoot;
    }
  };

  switch (toolName) {
    case "bash":
    case "powershell":
    case "git_status":
    case "git_diff":
    case "git_log":
    case "git_commit":
    case "git_push":
    case "git_pull":
    case "git_fetch":
    case "git_show":
    case "git_branch":
    case "git_stash":
    case "git_worktree":
      setIfMissing("cwd");
      break;
    case "ls":
    case "grep":
    case "glob":
      setIfMissing("path");
      break;
    case "index_codebase":
    case "explore_codebase":
    case "search_symbol":
      setIfMissing("root_dir");
      break;
    case "outline_file":
      setIfMissing("workspace_root");
      break;
  }

  return next;
}
