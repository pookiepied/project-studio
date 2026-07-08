/** Tool schema definitions for git version control tools. */
export const GIT_DEFINITIONS = [
  {
    name: "git_status",
    description:
      "Show the working tree status of a git repository. Returns current branch, " +
      "staged changes, unstaged changes, untracked files, and ahead/behind tracking info. " +
      "Run this before any commit workflow to understand the current state.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Repository directory (optional, defaults to process cwd)" },
      },
      required: [],
    },
  },
  {
    name: "git_diff",
    description:
      "Show changes between the working tree and the index (unstaged changes), or " +
      "between the index and HEAD (staged changes). Returns the diff as text. " +
      "Use stat: true for a file-level summary instead of the full patch.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:    { type: "string",  description: "Repository directory (optional)" },
        staged: { type: "boolean", description: "Show staged changes (default false = unstaged)" },
        file:   { type: "string",  description: "Limit diff to a specific file path (optional)" },
        stat:   { type: "boolean", description: "Show --stat summary instead of full patch (default false)" },
      },
      required: [],
    },
  },
  {
    name: "git_log",
    description:
      "Show the commit history. Returns commit hash, message, author, and relative date. " +
      "Limit to a file path to see its change history. Use format: 'full' for complete commit details.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:    { type: "string",  description: "Repository directory (optional)" },
        limit:  { type: "number",  description: "Number of commits to show (default 20)" },
        file:   { type: "string",  description: "Show history for a specific file path (optional)" },
        format: {
          type: "string",
          enum: ["short", "full"],
          description: "Output format: 'short' (hash + summary, default) or 'full' (all commit details)",
        },
      },
      required: [],
    },
  },
  {
    name: "git_commit",
    description:
      "Stage files and create a commit. If files is provided, only those files are staged. " +
      "If add_all is true, all changes are staged (git add -A). " +
      "If neither is set, only already-staged changes are committed.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string",                          description: "Commit message (required)" },
        cwd:     { type: "string",                          description: "Repository directory (optional)" },
        files:   { type: "array", items: { type: "string" }, description: "Specific files to stage before committing" },
        add_all: { type: "boolean",                         description: "Stage all changes (git add -A) before committing" },
        timeout: { type: "number",                          description: "Timeout in milliseconds (default 30000). Increase to 120000 or more if pre-commit hooks run tests or linting." },
      },
      required: ["message"],
    },
  },
  {
    name: "git_branch",
    description:
      "List, create, switch, or delete git branches. " +
      "Default action is 'list' which shows all local and remote branches.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "switch", "delete"],
          description: "Action to perform (default: list)",
        },
        name: { type: "string",  description: "Branch name — required for create, switch, delete" },
        cwd:  { type: "string",  description: "Repository directory (optional)" },
      },
      required: [],
    },
  },
  {
    name: "git_push",
    description:
      "Push local commits to a remote repository. Uses --no-progress for clean output and " +
      "--force-with-lease (not --force) for safety when force-pushing. " +
      "Requires a configured remote and credentials (SSH key or credential helper).",
    inputSchema: {
      type: "object",
      properties: {
        cwd:          { type: "string",  description: "Repository directory (optional, defaults to cwd)" },
        remote:       { type: "string",  description: "Remote name (default: origin)" },
        branch:       { type: "string",  description: "Branch name to push (optional, defaults to current branch)" },
        force:        { type: "boolean", description: "Force push using --force-with-lease (safe force — fails if remote has unseen commits)" },
        set_upstream: { type: "boolean", description: "Set remote tracking branch (-u / --set-upstream). Use for new branches." },
        timeout:      { type: "number",  description: "Timeout in milliseconds (default 60000). Increase for slow connections or large repos." },
      },
      required: [],
    },
  },
  {
    name: "git_pull",
    description:
      "Fetch and integrate remote changes into the current branch. " +
      "Use rebase: true to rebase instead of merge (keeps history linear).",
    inputSchema: {
      type: "object",
      properties: {
        cwd:     { type: "string",  description: "Repository directory (optional)" },
        remote:  { type: "string",  description: "Remote name (default: origin)" },
        branch:  { type: "string",  description: "Remote branch to pull (optional, defaults to tracking branch)" },
        rebase:  { type: "boolean", description: "Rebase instead of merge (default: false)" },
        timeout: { type: "number",  description: "Timeout in milliseconds (default 60000)" },
      },
      required: [],
    },
  },
  {
    name: "git_fetch",
    description:
      "Download remote refs without merging. Updates remote-tracking branches. " +
      "Use all: true to fetch all remotes. Use prune: true to remove deleted remote branches.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:     { type: "string",  description: "Repository directory (optional)" },
        remote:  { type: "string",  description: "Remote name (default: origin)" },
        all:     { type: "boolean", description: "Fetch all remotes (--all)" },
        prune:   { type: "boolean", description: "Remove remote-tracking refs that no longer exist on the remote (--prune)" },
        timeout: { type: "number",  description: "Timeout in milliseconds (default 60000)" },
      },
      required: [],
    },
  },
  {
    name: "git_show",
    description:
      "Inspect a commit or read a file at a specific revision (read-only). " +
      "Without file: shows the commit message, author, and full patch for ref. " +
      "With file: prints that file's contents as of ref (e.g. ref='HEAD~2', file='src/app.ts'). " +
      "Use stat: true for a file-level summary of a commit instead of the full patch.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:  { type: "string",  description: "Repository directory (optional)" },
        ref:  { type: "string",  description: "Commit-ish: hash, branch, tag, or HEAD~N (default: HEAD)" },
        file: { type: "string",  description: "Show this file's contents at ref instead of the commit patch (optional)" },
        stat: { type: "boolean", description: "Show --stat summary instead of the full patch (default false)" },
      },
      required: [],
    },
  },
  {
    name: "git_stash",
    description:
      "Save, restore, or manage stashed working-tree changes. " +
      "Actions: list (default) | save (stash current changes) | apply (restore, keep stash) | " +
      "pop (restore + delete stash) | drop (delete a stash) | show (view a stash's diff). " +
      "For save, include_untracked: true also stashes untracked files.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:               { type: "string",  description: "Repository directory (optional)" },
        action:            { type: "string",  enum: ["list","save","apply","pop","drop","show"], description: "Action to perform (default: list)" },
        message:           { type: "string",  description: "Description for the stash (save only)" },
        include_untracked: { type: "boolean", description: "Also stash untracked files (save only)" },
        ref:               { type: "string",  description: "Target stash for apply/pop/drop/show, e.g. 'stash@{1}' (optional — defaults to latest)" },
      },
      required: [],
    },
  },
  {
    name: "git_worktree",
    description:
      "Manage linked working trees — separate checkouts of the same repo sharing one .git, " +
      "ideal for working on multiple branches in parallel without stashing or cloning. " +
      "Actions: list (default) | add (create a worktree at path) | remove (delete one) | prune (clean stale entries). " +
      "For add, pass branch to create a new branch there, or omit it to check out an existing branch/commit.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:    { type: "string",  description: "Repository directory (optional)" },
        action: { type: "string",  enum: ["list","add","remove","prune"], description: "Action to perform (default: list)" },
        path:   { type: "string",  description: "Worktree directory path — required for add and remove" },
        branch: { type: "string",  description: "For add: create and check out this new branch in the worktree (omit to check out an existing branch/commit)" },
        force:  { type: "boolean", description: "For remove: force removal even with uncommitted changes (default false)" },
      },
      required: [],
    },
  },
] as const;
