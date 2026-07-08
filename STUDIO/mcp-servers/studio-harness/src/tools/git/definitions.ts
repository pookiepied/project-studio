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
  {
    name: "git_init",
    description:
      "Initialize a new git repository in a directory. Use initial_branch to name the first branch " +
      "(e.g. 'main'). The directory must already exist. Safe to call on an existing repo (it re-inits harmlessly).",
    inputSchema: {
      type: "object",
      properties: {
        cwd:            { type: "string",  description: "Directory to initialize (optional, defaults to cwd)" },
        initial_branch: { type: "string",  description: "Name for the initial branch, e.g. 'main' (optional)" },
        bare:           { type: "boolean", description: "Create a bare repository (no working tree). Rarely needed. Default false." },
      },
      required: [],
    },
  },
  {
    name: "git_add",
    description:
      "Stage files for the next commit. Pass files for specific paths, or all: true to stage every change (git add -A). " +
      "Prefer git_commit with files/add_all for the common commit workflow; use git_add when you want to stage without committing yet.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:   { type: "string",  description: "Repository directory (optional)" },
        files: { type: "array", items: { type: "string" }, description: "Paths to stage" },
        all:   { type: "boolean", description: "Stage all changes (git add -A)" },
      },
      required: [],
    },
  },
  {
    name: "git_reset",
    description:
      "Unstage files or move HEAD. With files: unstages those paths (keeps working-tree changes). " +
      "Without files: resets HEAD to ref using mode — soft (keep index + working tree), mixed (default; keep working tree, clear index), " +
      "hard (DISCARD all uncommitted changes to tracked files — irreversible). Use with care.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:   { type: "string",  description: "Repository directory (optional)" },
        mode:  { type: "string",  enum: ["soft", "mixed", "hard", "keep", "merge"], description: "Reset mode (default: mixed). Ignored when 'files' is given." },
        ref:   { type: "string",  description: "Commit-ish to reset to, e.g. HEAD, HEAD~1, a hash (optional)" },
        files: { type: "array", items: { type: "string" }, description: "Specific paths to unstage (mode ignored in this form)" },
      },
      required: [],
    },
  },
  {
    name: "git_restore",
    description:
      "Discard working-tree changes or restore file contents. By default restores files from the index (discards unstaged edits). " +
      "Use staged: true to unstage (restore index from HEAD). Use source to restore from a specific commit (e.g. source='HEAD~1').",
    inputSchema: {
      type: "object",
      properties: {
        cwd:    { type: "string",  description: "Repository directory (optional)" },
        files:  { type: "array", items: { type: "string" }, description: "Paths to restore (required)" },
        staged: { type: "boolean", description: "Restore the index instead of the working tree (i.e. unstage). Default false." },
        source: { type: "string",  description: "Restore contents from this commit-ish instead of the index (optional)" },
      },
      required: ["files"],
    },
  },
  {
    name: "git_rm",
    description:
      "Remove tracked files from the repository. By default deletes them from disk and stages the removal. " +
      "Use cached: true to untrack a file while keeping it on disk. Use recursive: true for directories.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:       { type: "string",  description: "Repository directory (optional)" },
        files:     { type: "array", items: { type: "string" }, description: "Paths to remove (required)" },
        cached:    { type: "boolean", description: "Untrack but keep the file on disk (--cached). Default false." },
        recursive: { type: "boolean", description: "Allow recursive removal of directories (-r). Default false." },
      },
      required: ["files"],
    },
  },
  {
    name: "git_mv",
    description: "Move or rename a tracked file and stage the change in one step (git mv).",
    inputSchema: {
      type: "object",
      properties: {
        cwd:         { type: "string", description: "Repository directory (optional)" },
        source:      { type: "string", description: "Current path (required)" },
        destination: { type: "string", description: "New path (required)" },
      },
      required: ["source", "destination"],
    },
  },
  {
    name: "git_merge",
    description:
      "Merge a branch into the current branch (non-interactive; auto-generated merge message). " +
      "Use no_ff: true to always create a merge commit. On conflicts the merge stops — resolve, git_add, git_commit, " +
      "or call again with abort: true to bail out.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:     { type: "string",  description: "Repository directory (optional)" },
        branch:  { type: "string",  description: "Branch (or commit-ish) to merge into the current branch. Required unless abort is set." },
        no_ff:   { type: "boolean", description: "Always create a merge commit even if fast-forward is possible. Default false." },
        message: { type: "string",  description: "Custom merge commit message (optional)" },
        abort:   { type: "boolean", description: "Abort an in-progress merge and restore the pre-merge state." },
      },
      required: [],
    },
  },
  {
    name: "git_rebase",
    description:
      "Reapply the current branch's commits on top of another base (non-interactive only — interactive rebase is not supported). " +
      "Pass upstream to rebase onto it. On conflicts the rebase stops — resolve, git_add, then call again with action: 'continue' " +
      "(or 'abort' / 'skip').",
    inputSchema: {
      type: "object",
      properties: {
        cwd:      { type: "string", description: "Repository directory (optional)" },
        upstream: { type: "string", description: "Base to rebase onto, e.g. 'main' or a commit hash. Required unless action is set." },
        onto:     { type: "string", description: "Advanced: rebase onto this ref instead of upstream (--onto). Optional." },
        action:   { type: "string", enum: ["continue", "abort", "skip"], description: "Continue/abort/skip an in-progress rebase (use instead of upstream)." },
      },
      required: [],
    },
  },
  {
    name: "git_cherry_pick",
    description:
      "Apply the changes from one or more existing commits onto the current branch (non-interactive). " +
      "On conflicts it stops — resolve, git_add, then action: 'continue' (or 'abort' / 'skip').",
    inputSchema: {
      type: "object",
      properties: {
        cwd:     { type: "string", description: "Repository directory (optional)" },
        commits: { type: "array", items: { type: "string" }, description: "Commit-ishes to apply, in order. Required unless action is set." },
        action:  { type: "string", enum: ["continue", "abort", "skip"], description: "Continue/abort/skip an in-progress cherry-pick." },
      },
      required: [],
    },
  },
  {
    name: "git_revert",
    description:
      "Create new commits that undo the changes of existing commits (safe — history is preserved). " +
      "Use no_commit: true to stage the reversal without committing. On conflicts: resolve, git_add, then action: 'continue' (or 'abort').",
    inputSchema: {
      type: "object",
      properties: {
        cwd:       { type: "string",  description: "Repository directory (optional)" },
        commits:   { type: "array", items: { type: "string" }, description: "Commit-ishes to revert. Required unless action is set." },
        no_commit: { type: "boolean", description: "Stage the reversal but don't commit (--no-commit). Default false." },
        action:    { type: "string", enum: ["continue", "abort", "skip"], description: "Continue/abort/skip an in-progress revert." },
      },
      required: [],
    },
  },
  {
    name: "git_tag",
    description:
      "List, create, or delete tags. Default action 'list'. For create: pass name; add message for an annotated tag, " +
      "and ref to tag a specific commit (defaults to HEAD).",
    inputSchema: {
      type: "object",
      properties: {
        cwd:     { type: "string", description: "Repository directory (optional)" },
        action:  { type: "string", enum: ["list", "create", "delete"], description: "Action (default: list)" },
        name:    { type: "string", description: "Tag name — required for create and delete" },
        message: { type: "string", description: "Annotation message — makes an annotated tag (create only)" },
        ref:     { type: "string", description: "Commit-ish to tag (create only, defaults to HEAD)" },
      },
      required: [],
    },
  },
  {
    name: "git_remote",
    description:
      "Manage remotes. Actions: list (default, with URLs) | add | remove | set-url. " +
      "add and set-url require name and url; remove requires name.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:    { type: "string", description: "Repository directory (optional)" },
        action: { type: "string", enum: ["list", "add", "remove", "set-url"], description: "Action (default: list)" },
        name:   { type: "string", description: "Remote name, e.g. 'origin' — required for add/remove/set-url" },
        url:    { type: "string", description: "Remote URL — required for add/set-url" },
      },
      required: [],
    },
  },
  {
    name: "git_clone",
    description:
      "Clone a remote repository into a directory. Use depth for a shallow clone (faster) and branch to check out a specific branch. " +
      "Authenticated clones need a token in the HTTPS URL or a configured credential helper.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:       { type: "string", description: "Directory to clone into (the parent; optional, defaults to cwd)" },
        url:       { type: "string", description: "Repository URL to clone (required)" },
        directory: { type: "string", description: "Target directory name (optional; defaults to the repo name)" },
        depth:     { type: "number", description: "Shallow-clone depth, e.g. 1 for latest commit only (optional)" },
        branch:    { type: "string", description: "Branch to check out (optional)" },
        timeout:   { type: "number", description: "Timeout in milliseconds (default 60000). Increase for large repos or slow networks." },
      },
      required: ["url"],
    },
  },
  {
    name: "git_blame",
    description:
      "Show, for each line of a file, the commit and author that last modified it (read-only). " +
      "Use start_line and end_line to blame only a range — recommended for large files.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:        { type: "string", description: "Repository directory (optional)" },
        file:       { type: "string", description: "File to blame (required)" },
        start_line: { type: "number", description: "First line of the range (use with end_line)" },
        end_line:   { type: "number", description: "Last line of the range (use with start_line)" },
      },
      required: ["file"],
    },
  },
  {
    name: "git_clean",
    description:
      "Remove untracked files from the working tree. DEFAULTS TO DRY-RUN (preview only) for safety — it lists what " +
      "would be deleted. To actually delete, pass force: true. Use directories: true to also remove untracked directories.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:         { type: "string",  description: "Repository directory (optional)" },
        dry_run:     { type: "boolean", description: "Preview only, don't delete (default TRUE). Set false (with force) to actually delete." },
        force:       { type: "boolean", description: "Required to actually delete when dry_run is false." },
        directories: { type: "boolean", description: "Also remove untracked directories (-d). Default false." },
      },
      required: [],
    },
  },
  {
    name: "git_reflog",
    description:
      "Show the reference log — the history of where HEAD and branch tips have pointed. " +
      "The go-to tool for recovering seemingly-lost commits after a reset, rebase, or bad merge.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:   { type: "string", description: "Repository directory (optional)" },
        limit: { type: "number", description: "Number of entries to show (default 30)" },
      },
      required: [],
    },
  },
  {
    name: "git_config",
    description:
      "Get, set, list, or unset git configuration. Use scope 'global' to set machine-wide values (e.g. user.name / user.email — " +
      "needed before the first commit in a fresh repo), or 'local' (default) for repo-specific settings.",
    inputSchema: {
      type: "object",
      properties: {
        cwd:    { type: "string", description: "Repository directory (optional; required for scope 'local')" },
        action: { type: "string", enum: ["get", "set", "list", "unset"], description: "Action (default: get)" },
        key:    { type: "string", description: "Config key, e.g. 'user.email' — required for get/set/unset" },
        value:  { type: "string", description: "Value to set — required for set" },
        scope:  { type: "string", enum: ["local", "global"], description: "Config scope (default: local)" },
      },
      required: [],
    },
  },
] as const;
