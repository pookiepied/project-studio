import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Expand,
  Check,
  Icon,
  GitBranchIcon,
  Add,
  TreeStructureIcon,
} from "@/ui/icons";
import { gitService, type GitBranch as Branch } from "@/core/git/gitService";
import { useOnClickOutside } from "@/lib/hooks/useOnClickOutside";
import { useDisclosure } from "@/lib/hooks/useDisclosure";
import { Button } from "@/ui/primitives/Button";
import { Input, SearchInput } from "@/ui/primitives";

type ProjectCtx = { path: string; name: string; accessMode?: "review" | "autonomous" };

interface Props {
  projectContext: ProjectCtx;
  setProjectContext: (ctx: ProjectCtx) => void;
  /** "up" anchors the menu above the trigger (composer); "down" below it (header). */
  placement?: "up" | "down";
}

export function BranchSelector({ projectContext, setProjectContext, placement = "up" }: Props) {
  const { open, onOpen, onClose } = useDisclosure();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ bottom?: number; top?: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(menuRef, onClose, open);

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
    onOpen();
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
      onClose();
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
      onClose();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Button
        variant="ghost"
        onClick={openMenu}
        title={inWorktree ? `${current} — checked out in worktree ${currentBranch?.worktreePath}` : current}
        className="h-6 gap-1.5 rounded-md px-2 text-xs text-secondary"
      >
        <Icon icon={GitBranchIcon} size="sm" />
        <span className="max-w-28 truncate">{current}</span>
        {inWorktree && (
          <span className="flex items-center gap-1 rounded border border-surface-border px-1 text-2xs font-medium text-muted">
            <Icon icon={TreeStructureIcon} size="xs" />
            worktree
          </span>
        )}
        <Expand size="xs" className={`opacity-50 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>

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
                  <SearchInput
                    autoFocus
                    value={query}
                    onValueChange={setQuery}
                    aria-label="Search branches"
                    placeholder="Search branches"
                    size="sm"
                    className="border-transparent bg-transparent text-xs"
                  />
                  <div className="my-1 h-px bg-surface-divider" />
                  <div className="max-h-52 overflow-y-auto">
                    {filtered.map(branch => (
                      <Button
                        key={branch.name}
                        variant="ghost"
                        disabled={busy}
                        onClick={() => checkout(branch)}
                        className="w-full justify-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-primary hover:bg-surface-hover disabled:opacity-50"
                      >
                        <Icon icon={GitBranchIcon} size="sm" className="text-secondary" />
                        <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                        {branch.worktreePath && !branch.current && <span className="text-2xs text-muted">Worktree</span>}
                        {branch.current && <Check size="xs" />}
                      </Button>
                    ))}
                    {!filtered.length && !error && <p className="px-2.5 py-3 text-xs text-muted">No branches found</p>}
                  </div>
                  <div className="my-1 h-px bg-surface-divider" />
                  <Button
                    variant="ghost"
                    onClick={() => { setCreating(true); setError(null); }}
                    className="w-full justify-start gap-2 rounded-lg px-2.5 py-2 text-xs text-primary hover:bg-surface-hover"
                  >
                    <Add size="sm" /> Create and check out new branch
                  </Button>
                </>
              ) : (
                <div className="p-1">
                  <p className="px-1 pb-2 text-xs font-medium text-primary">Create and check out branch</p>
                  <div className="flex gap-1.5">
                    <Input autoFocus size="sm" value={branchName} onChange={event => setBranchName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void createBranch(); if (event.key === "Escape") setCreating(false); }} placeholder="Branch name" className="min-w-0 flex-1 bg-surface-page text-xs" />
                    <Button
                      variant="primary"
                      disabled={!branchName.trim() || busy}
                      onClick={createBranch}
                      className="h-auto rounded-lg px-2.5 text-xs text-on-emphasis disabled:opacity-40"
                    >
                      Create
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setCreating(false)}
                    className="mt-2 h-auto px-1 text-xs text-muted hover:text-primary"
                  >
                    Back
                  </Button>
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
