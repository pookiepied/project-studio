import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  Icon,
  FileIcon,
  Folder,
  FolderOpen,
  Document,
  Redo,
  Code,
  Eye,
  Spinner,
  Close,
  Collapse,
} from "@/ui/icons";
import MarkdownDocumentPreview from "./MarkdownDocumentPreview";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";

const MonacoSourceView = lazy(() => import("./MonacoSourceView"));

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

type FileViewMode = "preview" | "raw";

function sortEntries(entries: DirectoryEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function extensionOf(path: string) {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function fileTone(path: string) {
  const ext = extensionOf(path);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "text-secondary";
  return "text-muted";
}

function relativePath(rootPath: string, path: string) {
  const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  const next = path.replace(/\\/g, "/");
  return next.startsWith(`${root}/`) ? next.slice(root.length + 1) : next;
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
  const requestId = useRef(0);
  const expanded = expandedPaths.includes(entry.path);
  const selected = selectedPath === entry.path;
  const iconClass = entry.isDir ? "text-amber-500" : fileTone(entry.path);

  useEffect(() => {
    if (!entry.isDir || !expanded) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    invoke<DirectoryEntry[]>("list_directory_entries", { path: entry.path })
      .then((next) => { if (requestId.current === currentRequest) setChildren(sortEntries(next)); })
      .catch(() => { if (requestId.current === currentRequest) setChildren([]); })
      .finally(() => { if (requestId.current === currentRequest) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [entry.isDir, entry.path, expanded]);

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => entry.isDir ? onToggle(entry.path) : onSelect(entry)}
        onDoubleClick={() => onSelect(entry)}
        className={`group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left justify-start text-xs transition-colors ${
          selected ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary"
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {entry.isDir ? (
          <Collapse size="xs" className={`flex-shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
        ) : (
          <span className="w-[11px] flex-shrink-0" />
        )}
        {entry.isDir ? (
          expanded ? <FolderOpen size="sm" className={`flex-shrink-0 ${iconClass}`} /> : <Folder size="sm" className={`flex-shrink-0 ${iconClass}`} />
        ) : (
          <Icon icon={FileIcon} size="sm" className={`flex-shrink-0 ${iconClass}`} />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {loading && <span className="h-3 w-3 rounded-full border border-muted border-t-transparent animate-spin" />}
      </Button>
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
  const [fileContent, setFileContent] = useState("");
  const [viewMode, setViewMode] = useState<FileViewMode>("preview");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRequestId = useRef(0);
  const fileRequestId = useRef(0);

  const rootName = useMemo(() => {
    if (!rootPath) return "No project";
    return rootPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? rootPath;
  }, [rootPath]);
  const selectedExt = selectedPath ? extensionOf(selectedPath) : "";
  const selectedRelativePath = rootPath && selectedPath ? relativePath(rootPath, selectedPath) : selectedPath ?? "";
  const canPreviewMarkdown = ["md", "mdx", "markdown"].includes(selectedExt);
  const canPreviewImage = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(selectedExt);

  const refresh = useCallback(() => {
    if (!rootPath) return;
    const currentRequest = ++rootRequestId.current;
    setLoading(true);
    setError(null);
    invoke<DirectoryEntry[]>("list_directory_entries", { path: rootPath })
      .then((next) => { if (rootRequestId.current === currentRequest) setEntries(sortEntries(next)); })
      .catch((reason) => {
        if (rootRequestId.current !== currentRequest) return;
        setEntries([]);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (rootRequestId.current === currentRequest) setLoading(false); });
  }, [rootPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const currentRequest = ++fileRequestId.current;
    if (!selectedPath) {
      setFileContent("");
      setFileError(null);
      return;
    }
    if (canPreviewImage) {
      setFileContent("");
      setFileError(null);
      setFileLoading(false);
      return;
    }
    setFileLoading(true);
    setFileError(null);
    invoke<string>("read_text_file_preview", { path: selectedPath })
      .then((content) => { if (fileRequestId.current === currentRequest) setFileContent(content); })
      .catch((reason) => {
        if (fileRequestId.current !== currentRequest) return;
        setFileContent("");
        setFileError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (fileRequestId.current === currentRequest) setFileLoading(false); });
  }, [canPreviewImage, selectedPath]);

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
            <Folder size="lg" />
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
      <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-surface-divider px-3">
        <FolderOpen size="sm" className="text-amber-500" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">{rootName}</span>
        <IconButton
          size="sm"
          onClick={refresh}
          aria-label="Refresh files"
          title="Refresh files"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-primary"
        >
          <Redo size="sm" className={loading ? "animate-spin" : ""} />
        </IconButton>
      </div>
      {error && (
        <div className="border-b border-surface-divider px-3 py-2 text-xs text-muted">
          {error}
        </div>
      )}
      <div className={`grid min-h-0 flex-1 overflow-hidden ${selectedPath ? "grid-cols-[minmax(210px,0.32fr)_minmax(0,1fr)]" : "grid-cols-1"}`}>
        <div className={`min-h-0 overflow-y-auto overscroll-contain px-2 py-2 scrollbar-thin ${selectedPath ? "border-r border-surface-divider/70" : ""}`}>
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
          {!selectedPath && entries.length > 0 && (
            <div className="mx-auto mt-8 max-w-[420px] px-4 py-4 text-center">
              <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-surface-raised/70">
                <Document size="md" className="text-muted" />
              </div>
              <p className="text-sm font-medium text-primary">Choose a file to preview</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Markdown opens as a document preview; code and text open as readable source.
              </p>
            </div>
          )}
        </div>
        {selectedPath && <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-page">
          {selectedPath ? (
            <>
              <div className="flex min-h-[48px] flex-shrink-0 items-center gap-3 border-b border-surface-divider px-4">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-base">
                  <Document size="sm" className={fileTone(selectedPath)} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-primary" title={selectedPath}>{selectedRelativePath}</p>
                  <p className="truncate text-2xs text-muted">{selectedPath}</p>
                </div>
                <span className="rounded-md bg-surface-base px-1.5 py-0.5 text-2xs text-muted">{formatBytes(fileContent.length)}</span>
                <div className="flex h-8 items-center rounded-lg bg-surface-base p-0.5">
                  <IconButton
                    size="sm"
                    onClick={() => setViewMode("preview")}
                    disabled={!canPreviewMarkdown}
                    aria-label="Preview file"
                    title="Preview file"
                    className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                      viewMode === "preview" ? "bg-surface-selected text-primary" : "text-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-35"
                    }`}
                  >
                    <Eye size="sm" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    onClick={() => setViewMode("raw")}
                    aria-label="View source"
                    title="View source"
                    className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                      viewMode === "raw" ? "bg-surface-selected text-primary" : "text-muted hover:text-primary"
                    }`}
                  >
                    <Code size="sm" />
                  </IconButton>
                </div>
                <IconButton
                  size="sm"
                  onClick={() => onStateChange({ selectedPath: null })}
                  aria-label="Close file"
                  title="Close file"
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-primary"
                >
                  <Close size="sm" />
                </IconButton>
              </div>
              {fileLoading ? (
                <div className="flex flex-1 items-center justify-center text-xs text-muted">
                  <Spinner size="sm" className="mr-2 animate-spin" />
                  Opening file
                </div>
              ) : fileError ? (
                <div className="p-4 text-xs leading-relaxed text-muted">{fileError}</div>
              ) : canPreviewImage ? (
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-base/40 p-6 scrollbar-thin">
                  <img src={convertFileSrc(selectedPath)} alt={selectedRelativePath} className="max-h-full max-w-full object-contain" />
                </div>
              ) : canPreviewMarkdown && viewMode === "preview" ? (
                <div className="min-h-0 flex-1 overflow-hidden">
                  <MarkdownDocumentPreview content={fileContent} path={selectedPath} />
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-hidden">
                  <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted"><Spinner size="sm" className="mr-2 animate-spin" />Loading editor</div>}>
                    <MonacoSourceView content={fileContent} path={selectedPath} />
                  </Suspense>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div className="max-w-[240px]">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-base text-muted">
                  <Document size="md" />
                </div>
                <p className="text-sm font-medium text-primary">Select a file</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">Open project files here without leaving the chat workspace.</p>
              </div>
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}
