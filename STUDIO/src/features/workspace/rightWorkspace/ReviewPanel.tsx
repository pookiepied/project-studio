import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowClockwiseIcon as Refresh,
  ArrowsSplitIcon as Split,
  CopyIcon as Copy,
  FileCodeIcon as FileCode,
  GitBranchIcon as GitBranch,
  GitCommitIcon as GitCommit,
  SidebarSimpleIcon as SidebarSimple,
  SpinnerGapIcon as SpinnerGap,
  TextAlignLeftIcon as WordWrap,
  FilePlusIcon as FilePlus,
  PencilSimpleIcon as Modified,
  CheckCircleIcon as Staged,
  ArrowsClockwiseIcon as Mixed,
  WarningCircleIcon as Warning,
  UploadSimpleIcon as StageIcon,
  DownloadSimpleIcon as UnstageIcon,
  ArrowRightIcon as ArrowRight,
} from "@phosphor-icons/react";
import { Select } from "@/ui/primitives/Select";
import { SegmentedControl } from "@/ui/primitives/SegmentedControl";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { createSplitRows, parseUnifiedDiff, type DiffLine } from "./unifiedDiff";

interface GitChangedFile {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

interface GitStatusSummary {
  branch: string;
  hasRepo: boolean;
  files: GitChangedFile[];
}

interface GitBranchInfo {
  name: string;
  current: boolean;
  worktreePath?: string | null;
}

interface GitCommitSummary {
  hash: string;
  subject: string;
}

interface ReviewPanelProps {
  rootPath?: string | null;
  selectedPath?: string | null;
  onStateChange: (state: { selectedPath?: string | null }) => void;
  onOpenFiles: () => void;
}

type ChangeFilter = "all" | "unstaged" | "staged" | "untracked";

function projectName(path?: string | null) {
  if (!path) return "No project";
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function classifyLine(line: DiffLine) {
  if (line.kind === "addition") return "bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300";
  if (line.kind === "deletion") return "bg-rose-500/[0.08] text-rose-700 dark:text-rose-300";
  if (line.kind === "hunk") return "bg-surface-raised text-secondary";
  if (line.text.startsWith("diff --git")) return "bg-surface-base text-primary";
  return "text-secondary";
}

function statusLabel(file: GitChangedFile) {
  if (file.untracked) return "Untracked";
  if (file.staged && file.unstaged) return "Mixed";
  if (file.staged) return "Staged";
  if (file.unstaged) return "Unstaged";
  return file.status.trim() || "Changed";
}

function statusBadge(file: GitChangedFile) {
  if (file.untracked) return { Icon: FilePlus, className: "text-amber-600 dark:text-amber-300" };
  if (file.staged && file.unstaged) return { Icon: Mixed, className: "text-amber-600 dark:text-amber-300" };
  if (file.staged) return { Icon: Staged, className: "text-emerald-600 dark:text-emerald-300" };
  return { Icon: Modified, className: "text-sky-600 dark:text-sky-300" };
}

function ControlButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <IconButton
      aria-label={title}
      title={title}
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={`rounded-lg transition-colors ${
        active ? "bg-surface-selected text-primary hover:bg-surface-selected" : "text-muted"
      }`}
    >
      {children}
    </IconButton>
  );
}

function LineNumber({ value }: { value: number | null }) {
  return <span className="w-10 flex-none select-none pr-2 text-right text-muted">{value ?? ""}</span>;
}

function SplitCell({ line, side, wordWrap }: { line: DiffLine | null; side: "old" | "new"; wordWrap: boolean }) {
  const number = line ? (side === "old" ? line.oldLine : line.newLine) : null;
  return (
    <div className={`flex h-full min-w-0 ${line ? classifyLine(line) : "bg-surface-base"}`}>
      <LineNumber value={number} />
      <span className={`min-w-0 flex-1 px-2 ${wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>
        {line?.text || " "}
      </span>
    </div>
  );
}

export function ReviewPanel({
  rootPath,
  selectedPath,
  onStateChange,
  onOpenFiles,
}: ReviewPanelProps) {
  const [summary, setSummary] = useState<GitStatusSummary | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [commits, setCommits] = useState<GitCommitSummary[]>([]);
  const [diff, setDiff] = useState("");
  const [filter, setFilter] = useState<ChangeFilter>("all");
  const [stagedDiff, setStagedDiff] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [richPreview] = useState(true);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [splitDiff, setSplitDiff] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [commitMessage, setCommitMessage] = useState("");
  const [actionBusy, setActionBusy] = useState<"stage" | "unstage" | "commit" | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const diffRequest = useRef(0);

  const load = useCallback(() => {
    if (!rootPath) return;
    setLoading(true);
    setError(null);
    Promise.all([
      invoke<GitStatusSummary>("git_status_summary", { path: rootPath }),
      invoke<GitBranchInfo[]>("git_list_branches", { path: rootPath }).catch(() => []),
      invoke<GitCommitSummary[]>("git_recent_commits", { path: rootPath }).catch(() => []),
    ])
      .then(([nextSummary, nextBranches, nextCommits]) => {
        setSummary(nextSummary);
        setBranches(nextBranches);
        setCommits(nextCommits);
        if (!selectedPath && nextSummary.files[0]) {
          onStateChange({ selectedPath: nextSummary.files[0].path });
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [onStateChange, rootPath, selectedPath]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const request = ++diffRequest.current;
    if (!rootPath || !summary?.hasRepo) {
      setDiff("");
      setDiffLoading(false);
      return;
    }
    setDiffLoading(true);
    invoke<string>("git_diff", {
      path: rootPath,
      filePath: selectedPath ?? null,
      staged: stagedDiff,
      ignoreWhitespace,
    })
      .then((nextDiff) => { if (request === diffRequest.current) setDiff(nextDiff); })
      .catch((reason) => { if (request === diffRequest.current) setDiff(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (request === diffRequest.current) setDiffLoading(false); });
  }, [ignoreWhitespace, rootPath, selectedPath, stagedDiff, summary?.hasRepo]);

  const files = useMemo(() => {
    const all = summary?.files ?? [];
    if (filter === "staged") return all.filter((file) => file.staged);
    if (filter === "unstaged") return all.filter((file) => file.unstaged);
    if (filter === "untracked") return all.filter((file) => file.untracked);
    return all;
  }, [filter, summary?.files]);

  const diffLines = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const splitRows = useMemo(() => createSplitRows(diffLines), [diffLines]);
  const currentBranch = branches.find((branch) => branch.current)?.name ?? summary?.branch ?? "branch";
  const branchOptions = useMemo(
    () => branches.length > 0
      ? branches.map((branch) => ({ value: branch.name, label: branch.name }))
      : [{ value: currentBranch, label: currentBranch }],
    [branches, currentBranch],
  );
  const stagedCount = summary?.files.filter((file) => file.staged).length ?? 0;
  const changedCount = summary?.files.length ?? 0;

  const checkoutBranch = (branch: string) => {
    if (!rootPath || branch === currentBranch) return;
    setLoading(true);
    setError(null);
    setPendingBranch(null);
    invoke("git_checkout_branch", { path: rootPath, branch })
      .then(load)
      .catch((reason) => {
        setPendingBranch(branch);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setLoading(false));
  };

  const stashAndCheckout = () => {
    if (!rootPath || !pendingBranch) return;
    setLoading(true);
    invoke("git_stash_and_checkout", { path: rootPath, branch: pendingBranch })
      .then(() => {
        setError(null);
        setPendingBranch(null);
        load();
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  };

  const runGitAction = (action: "stage" | "unstage" | "commit", scope?: "file" | "all") => {
    if (!rootPath) return;
    setActionBusy(action);
    setError(null);
    const command = action === "stage"
      ? invoke("git_stage", { path: rootPath, filePath: scope === "file" ? selectedPath : null })
      : action === "unstage"
      ? invoke("git_unstage", { path: rootPath, filePath: scope === "file" ? selectedPath : null })
      : invoke("git_commit", { path: rootPath, message: commitMessage });
    command
      .then(() => {
        if (action === "commit") setCommitMessage("");
        load();
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setActionBusy(null));
  };

  if (!rootPath) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div className="max-w-[280px]">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-surface-border bg-surface-base text-muted">
            <GitBranch size={18} />
          </div>
          <p className="text-sm font-semibold text-primary">No local project selected</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">Choose a local project to review changes, branches, and diffs here.</p>
        </div>
      </div>
    );
  }

  if (summary && !summary.hasRepo) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div className="max-w-[300px]">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-surface-border bg-surface-base text-muted">
            <FileCode size={18} />
          </div>
          <p className="text-sm font-semibold text-primary">Files are primary here</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {projectName(rootPath)} is not a Git repository, so the workspace opens best as a file reader.
          </p>
          <Button
            variant="primary"
            onClick={onOpenFiles}
            className="mt-4 px-3 py-1.5 h-auto text-xs font-medium text-inverse hover:bg-primary hover:opacity-90"
          >
            Open files
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-page">
      <div className="flex min-h-[52px] flex-shrink-0 items-center gap-3 bg-surface-page px-3">
        <GitBranch size={14} className="text-muted" />
        <Select
          value={currentBranch}
          onChange={checkoutBranch}
          options={branchOptions}
          className="h-8 w-[190px] px-2.5 py-0 text-xs"
          title="Switch branch"
        />
        <span className="hidden min-w-0 flex-1 truncate text-2xs text-muted md:block">{projectName(rootPath)} - {changedCount} changed</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-0.5 rounded-lg bg-surface-base p-0.5 md:flex">
            <ControlButton title="Enable word wrap" active={wordWrap} onClick={() => setWordWrap((value) => !value)}><WordWrap size={14} /></ControlButton>
            <ControlButton title="Switch to split diff" active={splitDiff} onClick={() => setSplitDiff((value) => !value)}><Split size={14} /></ControlButton>
            <ControlButton title="Ignore whitespace" active={ignoreWhitespace} onClick={() => setIgnoreWhitespace((value) => !value)}><span className="text-2xs font-semibold">WS</span></ControlButton>
          </div>
          <ControlButton title="Show files" active={showFiles} onClick={() => setShowFiles((value) => !value)}><SidebarSimple size={14} /></ControlButton>
          <ControlButton title="Refresh changes" onClick={load}><Refresh size={14} className={loading ? "animate-spin" : ""} /></ControlButton>
          <ControlButton title="Copy git apply command" onClick={() => navigator.clipboard?.writeText(`git -C "${rootPath}" apply`)}><Copy size={14} /></ControlButton>
        </div>
      </div>

      {error && (
        <div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-rose-500/[0.08] px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          <Warning size={15} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{pendingBranch ? `Branch switch blocked: ${pendingBranch}` : "Git action failed"}</p>
            {pendingBranch && <p className="mt-0.5 text-2xs opacity-90">Your working changes were left untouched. Stash them only if you want to retry the switch.</p>}
            <p className="mt-0.5 max-h-20 overflow-auto whitespace-pre-wrap break-words text-2xs opacity-80 scrollbar-thin">{error}</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {pendingBranch && <Button variant="outline" onClick={stashAndCheckout} disabled={loading} className="rounded-md border-rose-500/20 bg-surface-page px-2 py-1 h-auto text-2xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">Stash and retry</Button>}
            <Button variant="ghost" onClick={() => { setError(null); setPendingBranch(null); }} className="rounded px-1.5 py-1 h-auto text-2xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-500/10">Dismiss</Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 border-t border-surface-divider">
        {showFiles && (
          <aside id="review-file-list" className="flex w-[280px] flex-shrink-0 flex-col border-r border-surface-divider bg-surface-base/35">
            <div className="flex flex-shrink-0 items-center border-b border-surface-divider p-2">
              <SegmentedControl<ChangeFilter>
                aria-label="Change filter"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "unstaged", label: "Work" },
                  { value: "staged", label: "Staged" },
                  { value: "untracked", label: "New" },
                ]}
                className="w-full justify-center"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {files.map((file) => (
                (() => {
                  const badge = statusBadge(file);
                  const StatusIcon = badge.Icon;
                  return (
                    <Button
                      key={`${file.status}-${file.path}`}
                      variant="ghost"
                      onClick={() => onStateChange({ selectedPath: file.path })}
                      className={`mb-1 w-full items-center justify-start gap-2 rounded-lg px-2 py-2 h-auto text-left transition-colors ${
                        selectedPath === file.path ? "bg-surface-selected" : "hover:bg-surface-hover"
                      }`}
                    >
                      <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-surface-raised ${badge.className}`} title={statusLabel(file)}>
                        <StatusIcon size={14} weight="duotone" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-primary">{file.path}</span>
                        <span className="block text-2xs text-muted">{statusLabel(file)}</span>
                      </span>
                    </Button>
                  );
                })()
              ))}
              {!loading && files.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted">No matching changes.</p>}
            </div>
            <div className="max-h-32 flex-shrink-0 overflow-y-auto border-t border-surface-divider p-2">
              <div className="mb-1 flex items-center gap-1.5 px-1 text-2xs font-medium uppercase tracking-extra-wide text-muted">
                <GitCommit size={12} />
                Commits
              </div>
              {commits.map((commit) => (
                <div key={commit.hash} className="px-1 py-1">
                  <p className="truncate text-2xs font-mono text-secondary">{commit.hash}</p>
                  <p className="truncate text-2xs text-muted">{commit.subject}</p>
                </div>
              ))}
            </div>
          </aside>
        )}

        <main className="min-w-0 flex-1 overflow-hidden">
          <div className="flex h-9 items-center gap-2 border-b border-surface-divider px-3">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">{selectedPath ?? "All changes"}</span>
            <SegmentedControl
              aria-label="Diff source"
              value={stagedDiff ? "staged" : "working"}
              onChange={(value) => setStagedDiff(value === "staged")}
              options={[
                { value: "working", label: "Working" },
                { value: "staged", label: "Staged" },
              ]}
            />
          </div>
          {diffLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted">
              <SpinnerGap size={15} className="mr-2 animate-spin" />
              Loading diff
            </div>
          ) : splitDiff ? (
            <div className="h-full overflow-auto font-mono text-xs leading-relaxed">
              <div className={wordWrap ? "min-w-0" : "min-w-max"}>
                {splitRows.map((row, index) => (
                  <div key={index} className="grid grid-cols-2 items-stretch">
                    <div className="min-w-0 border-r border-surface-divider"><SplitCell line={row.left} side="old" wordWrap={wordWrap} /></div>
                    <div className="min-w-0"><SplitCell line={row.right} side="new" wordWrap={wordWrap} /></div>
                  </div>
                ))}
              </div>
              {!diff && <p className="px-4 py-6 text-xs text-muted">No diff for this selection.</p>}
            </div>
          ) : (
            <div className="h-full overflow-auto font-mono text-xs leading-relaxed">
              <div className={wordWrap ? "min-w-0" : "min-w-max"}>
                {diffLines.map((line, index) => (
                  <div key={index} className={`flex min-w-0 ${richPreview ? classifyLine(line) : "text-secondary"}`}>
                    <LineNumber value={line.oldLine} />
                    <LineNumber value={line.newLine} />
                    <span className={`min-w-0 flex-1 px-2 ${wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>{line.text || " "}</span>
                  </div>
                ))}
              </div>
              {!diff && <p className="px-4 py-6 text-xs text-muted">No diff for this selection.</p>}
            </div>
          )}
        </main>
      </div>
      <div className="flex flex-shrink-0 items-end gap-2 border-t border-surface-divider/70 bg-surface-base/35 p-2">
        <div className="min-w-[180px] flex-1">
        <div className="mb-1 flex min-w-0 items-center gap-2">
          <GitCommit size={15} className="flex-shrink-0 text-muted" />
          <span className="text-xs font-medium text-primary">Commit changes</span>
          <span className="truncate text-2xs text-muted">{stagedCount} staged {stagedCount === 1 ? "file" : "files"}</span>
        </div>
        <textarea
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Commit message"
          rows={1}
          className="h-8 w-full resize-none rounded-md border border-surface-border/80 bg-surface-page px-2.5 py-1.5 text-xs leading-4 text-primary outline-none transition focus:border-focus focus:ring-1 focus:ring-focus/20 placeholder:text-muted"
        />
        </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <Button
              variant="outline"
              onClick={() => runGitAction("stage", "file")}
              disabled={actionBusy !== null || !selectedPath}
              className="h-8 gap-1 rounded-md bg-surface-page px-2 text-2xs font-medium hover:bg-surface-hover disabled:opacity-40"
            >
              <StageIcon size={13} />
              Stage file
            </Button>
            <Button
              variant="ghost"
              onClick={() => runGitAction("stage", "all")}
              disabled={actionBusy !== null}
              className="h-8 rounded-md px-2 text-2xs font-medium hover:bg-surface-hover disabled:opacity-40"
            >
              Stage all
            </Button>
            <Button variant="outline" onClick={() => runGitAction("unstage", "file")} disabled={actionBusy !== null || !selectedPath} className="h-8 gap-1 rounded-md bg-surface-page px-2 text-2xs font-medium hover:bg-surface-hover disabled:opacity-40"><UnstageIcon size={13} />Unstage file</Button>
            <Button variant="ghost" onClick={() => runGitAction("unstage", "all")} disabled={actionBusy !== null} className="h-8 rounded-md px-2 text-2xs font-medium hover:bg-surface-hover disabled:opacity-40">Unstage all</Button>
          </div>
          <Button
            variant="outline"
            onClick={() => runGitAction("commit")}
            disabled={actionBusy !== null || !commitMessage.trim() || stagedCount === 0}
            className="h-8 flex-shrink-0 gap-1.5 rounded-md bg-surface-page px-3 text-xs font-semibold text-primary transition hover:bg-surface-hover disabled:opacity-40"
          >
            {actionBusy === "commit" ? "Committing..." : "Commit"}
            {actionBusy !== "commit" && <ArrowRight size={13} weight="bold" />}
          </Button>
      </div>
    </div>
  );
}
