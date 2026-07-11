import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CaretRightIcon as CaretRight,
  FileIcon as File,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  ArrowClockwiseIcon as Refresh,
} from "@phosphor-icons/react";

interface DirectoryEntry {
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  size: number;
  modifiedMs?: number;
}

interface FilesPanelProps {
  rootPath?: string | null;
  selectedPath?: string | null;
  expandedPaths: string[];
  onStateChange: (state: { selectedPath?: string | null; expandedPaths?: string[] }) => void;
}

function sortEntries(entries: DirectoryEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function FileTreeNode({
  entry,
  depth,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggle,
}: {
  entry: DirectoryEntry;
  depth: number;
  selectedPath?: string | null;
  expandedPaths: string[];
  onSelect: (entry: DirectoryEntry) => void;
  onToggle: (path: string) => void;
}) {
  const [children, setChildren] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const expanded = expandedPaths.includes(entry.path);
  const selected = selectedPath === entry.path;

  useEffect(() => {
    if (!entry.isDir || !expanded) return;
    let cancelled = false;
    setLoading(true);
    invoke<DirectoryEntry[]>("list_directory_entries", { path: entry.path })
      .then((next) => { if (!cancelled) setChildren(sortEntries(next)); })
      .catch(() => { if (!cancelled) setChildren([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entry.isDir, entry.path, expanded]);

  return (
    <>
      <button
        type="button"
        onClick={() => entry.isDir ? onToggle(entry.path) : onSelect(entry)}
        onDoubleClick={() => onSelect(entry)}
        className={`group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs transition-colors ${
          selected ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary"
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {entry.isDir ? (
          <CaretRight size={11} weight="bold" className={`flex-shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
        ) : (
          <span className="w-[11px] flex-shrink-0" />
        )}
        {entry.isDir ? (
          expanded ? <FolderOpen size={14} weight="regular" className="flex-shrink-0 text-muted" /> : <Folder size={14} weight="regular" className="flex-shrink-0 text-muted" />
        ) : (
          <File size={14} weight="regular" className="flex-shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {loading && <span className="h-3 w-3 rounded-full border border-muted border-t-transparent animate-spin" />}
      </button>
      {entry.isDir && expanded && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
          {!loading && children.length === 0 && (
            <p className="px-2 py-1 text-2xs text-muted" style={{ paddingLeft: 28 + depth * 14 }}>
              Empty
            </p>
          )}
        </div>
      )}
    </>
  );
}

export function FilesPanel({
  rootPath,
  selectedPath,
  expandedPaths,
  onStateChange,
}: FilesPanelProps) {
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rootName = useMemo(() => {
    if (!rootPath) return "No project";
    return rootPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? rootPath;
  }, [rootPath]);

  const refresh = useCallback(() => {
    if (!rootPath) return;
    setLoading(true);
    setError(null);
    invoke<DirectoryEntry[]>("list_directory_entries", { path: rootPath })
      .then((next) => setEntries(sortEntries(next)))
      .catch((reason) => {
        setEntries([]);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setLoading(false));
  }, [rootPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = (path: string) => {
    onStateChange({
      expandedPaths: expandedPaths.includes(path)
        ? expandedPaths.filter((item) => item !== path)
        : [...expandedPaths, path],
    });
  };

  if (!rootPath) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div className="max-w-[260px]">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-base text-muted">
            <Folder size={18} />
          </div>
          <p className="text-sm font-semibold text-primary">No local project open</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Switch to Local and choose a project to browse files here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-page">
      <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-surface-divider px-3">
        <FolderOpen size={14} className="text-muted" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">{rootName}</span>
        <button
          type="button"
          onClick={refresh}
          title="Refresh files"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-primary"
        >
          <Refresh size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      {error && (
        <div className="border-b border-surface-divider px-3 py-2 text-xs text-muted">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {entries.map((entry) => (
          <FileTreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            selectedPath={selectedPath}
            expandedPaths={expandedPaths}
            onSelect={(next) => onStateChange({ selectedPath: next.path })}
            onToggle={toggle}
          />
        ))}
        {!loading && entries.length === 0 && !error && (
          <p className="px-2 py-6 text-center text-xs text-muted">No files found.</p>
        )}
      </div>
    </div>
  );
}
