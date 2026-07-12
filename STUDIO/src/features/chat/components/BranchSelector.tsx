import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CaretDownIcon as CaretDown,
  CheckIcon as Check,
  GitBranchIcon as GitBranch,
  MagnifyingGlassIcon as Search,
  PlusIcon as Plus,
  TreeStructureIcon as TreeStructure,
  XIcon as X,
} from "@phosphor-icons/react";
import { gitService, type GitBranch as Branch } from "@/core/git/gitService";
import { useOnClickOutside } from "@/lib/hooks/useOnClickOutside";

type ProjectCtx = { path: string; name: string; accessMode?: "review" | "autonomous" };

interface Props {
  projectContext: ProjectCtx;
  setProjectContext: (ctx: ProjectCtx) => void;
  /** "up" anchors the menu above the trigger (composer); "down" below it (header). */
  placement?: "up" | "down";
}

export function BranchSelector({ projectContext, setProjectContext, placement = "up" }: Props) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ bottom?: number; top?: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(menuRef, () => setOpen(false), open);

  const currentBranch = branches.find(branch => branch.current);
  const current = currentBranch?.name ?? "Branch";
  // A branch checked out in a linked worktree isn't in the main working tree —
  // worth showing, since edits land somewhere other than the project root.
  const inWorktree = !!currentBranch?.worktreePath;
  const filtered = useMemo(
    () => branches.filter(branch => branch.name.toLowerCase().includes(query.toLowerCase())),
    [branches, query],
  );

  const refresh = useCallback(async () => {
    const next = await gitService.listBranches(projectContext.path);
    setBranches(next);
    return next;
  }, [projectContext.path]);

  useEffect(() => {
    refresh().catch(() => setBranches([]));
  }, [refresh]);

  const openMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 280);
    setPosition(
      placement === "down"
        ? { top: rect.bottom + 8, left }
        : { bottom: window.innerHeight - rect.top + 8, left },
    );
    setOpen(true);
    setError(null);
    try { await refresh(); }
    catch (reason) { setError(String(reason)); }
  };

  const checkout = async (branch: Branch) => {
    if (branch.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gitService.checkoutBranch(projectContext.path, branch.name);
      setProjectContext({ ...projectContext, path: result.path });
      setOpen(false);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  const createBranch = async () => {
    if (!branchName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gitService.createBranch(projectContext.path, branchName);
      setProjectContext({ ...projectContext, path: result.path });
      setBranchName("");
      setOpen(false);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        title={inWorktree ? `${current} — checked out in worktree ${currentBranch?.worktreePath}` : current}
        className="flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-secondary transition-colors hover:bg-surface-hover"
      >
        <GitBranch size={14} />
        <span className="max-w-28 truncate">{current}</span>
        {inWorktree && (
          <span className="flex items-center gap-1 rounded border border-surface-border px-1 text-2xs font-medium text-muted">
            <TreeStructure size={12} weight="bold" />
            worktree
          </span>
        )}
        <CaretDown size={12} weight="bold" className={`opacity-50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && position && (
            <motion.div
              ref={menuRef}
              style={{ position: "fixed", bottom: position.bottom, top: position.top, left: position.left, zIndex: 9999 }}
              initial={{ opacity: 0, scale: 0.96, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 4 }}
              className="w-64 overflow-hidden rounded-xl border border-surface-border bg-surface-base p-1.5 shadow-xl"
            >
              {!creating ? (
                <>
                  <div className="flex items-center gap-2 px-2 py-1.5 text-muted">
                    <Search size={14} />
                    <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search branches" className="min-w-0 flex-1 bg-transparent text-xs text-primary outline-none placeholder:text-muted" />
                    {query && <button type="button" onClick={() => setQuery("")}><X size={12} /></button>}
                  </div>
                  <div className="my-1 h-px bg-surface-divider" />
                  <div className="max-h-52 overflow-y-auto">
                    {filtered.map(branch => (
                      <button key={branch.name} type="button" disabled={busy} onClick={() => checkout(branch)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-primary hover:bg-surface-hover disabled:opacity-50">
                        <GitBranch size={14} className="text-secondary" />
                        <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                        {branch.worktreePath && !branch.current && <span className="text-2xs text-muted">Worktree</span>}
                        {branch.current && <Check size={12} weight="bold" />}
                      </button>
                    ))}
                    {!filtered.length && !error && <p className="px-2.5 py-3 text-xs text-muted">No branches found</p>}
                  </div>
                  <div className="my-1 h-px bg-surface-divider" />
                  <button type="button" onClick={() => { setCreating(true); setError(null); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-primary hover:bg-surface-hover">
                    <Plus size={14} weight="bold" /> Create and check out new branch
                  </button>
                </>
              ) : (
                <div className="p-1">
                  <p className="px-1 pb-2 text-xs font-medium text-primary">Create and check out branch</p>
                  <div className="flex gap-1.5">
                    <input autoFocus value={branchName} onChange={event => setBranchName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void createBranch(); if (event.key === "Escape") setCreating(false); }} placeholder="Branch name" className="min-w-0 flex-1 rounded-lg border border-surface-border bg-surface-page px-2 py-1.5 text-xs text-primary outline-none focus:ring-1 focus:ring-focus" />
                    <button type="button" disabled={!branchName.trim() || busy} onClick={createBranch} className="rounded-lg bg-primary px-2.5 text-xs font-medium text-on-emphasis disabled:opacity-40">Create</button>
                  </div>
                  <button type="button" onClick={() => setCreating(false)} className="mt-2 px-1 text-xs text-muted hover:text-primary">Back</button>
                </div>
              )}
              {error && <p className="mx-2 mb-1 mt-2 text-2xs text-secondary">{error}</p>}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
