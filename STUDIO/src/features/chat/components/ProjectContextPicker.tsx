import React, { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpenIcon as FolderOpen,
  XIcon as X,
  PlusIcon as Plus,
  CaretDownIcon as CaretDown,
  EyeIcon as Eye,
  LightningIcon as Lightning,
} from "@phosphor-icons/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { mkdir } from "@tauri-apps/plugin-fs";
import { documentDir } from "@tauri-apps/api/path";
import { useOnClickOutside } from "@/lib/hooks/useOnClickOutside";
import { setWorkspaceTrust } from "@/core/permissions";
import { StudioMark } from "@/ui/brand";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";

type AccessMode = "review" | "autonomous";
type ProjectCtx  = { path: string; name: string; accessMode?: AccessMode };

interface Props {
  projectContext: ProjectCtx | null;
  setProjectContext: (ctx: ProjectCtx | null) => void;
  /** "bar" renders as a borderless, ghost-hover trigger meant to sit inline
   *  inside a shared pill (e.g. ComposerContextBar). Defaults to the
   *  original standalone bordered chip. */
  variant?: "standalone" | "bar";
}

export function ProjectContextPicker({ projectContext, setProjectContext, variant = "standalone" }: Props) {
  const [showMenu, setShowMenu] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [dropPos,  setDropPos]  = useState<{ bottom: number; left: number } | null>(null);

  // Modal step state. `hasTrustStep` distinguishes opening an existing folder
  // (trust must be asked) from creating a fresh one (owned, so trust is
  // implied and we jump straight to the working-style step).
  const [step,         setStep]         = useState<"trust" | "mode" | null>(null);
  const [hasTrustStep, setHasTrustStep] = useState(true);
  const [pendingPath,  setPendingPath]  = useState<string | null>(null);
  const [pendingName,  setPendingName]  = useState<string | null>(null);
  const [mode,         setMode]         = useState<AccessMode>("review");

  const menuRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(menuRef, () => setShowMenu(false), showMenu);

  const openMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setDropPos({ bottom: window.innerHeight - rect.top + 10, left: rect.left });
    setShowMenu(v => !v);
  }, []);

  const resetFlow = useCallback(() => {
    setStep(null);
    setPendingPath(null);
    setPendingName(null);
    setMode("review");
    setHasTrustStep(true);
  }, []);

  const handleSelectFolder = useCallback(async () => {
    setShowMenu(false);
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string" && selected) {
        const parts = selected.replace(/\\/g, "/").split("/");
        setPendingPath(selected);
        setPendingName(parts[parts.length - 1] || selected);
        setMode("review");
        setHasTrustStep(true);
        setStep("trust");
      }
    } catch { /* user cancelled */ }
  }, []);

  const handleCreate = useCallback(async () => {
    const safeName = formName.trim().replace(/[/\\:*?"<>|]/g, "-");
    if (!safeName) return;
    try {
      const docs     = (await documentDir()).replace(/\\/g, "/");
      const fullPath = `${docs}/Studio/${safeName}`;
      await mkdir(fullPath, { recursive: true });
      // A folder the user just created is theirs — trust is implied.
      setWorkspaceTrust(fullPath, "trusted");
      setPendingPath(fullPath);
      setPendingName(safeName);
      setShowForm(false);
      setFormName("");
      setMode("review");
      setHasTrustStep(false);
      setStep("mode");
    } catch (e) {
      alert(`Could not create project: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [formName]);

  const handleTrustConfirm = useCallback(() => {
    if (!pendingPath) return;
    // Record trust in the permission engine so mutating tools are unblocked.
    setWorkspaceTrust(pendingPath, "trusted");
    setStep("mode");
  }, [pendingPath]);

  const handleConfirmMode = useCallback(() => {
    if (!pendingPath || !pendingName) return;
    setProjectContext({ path: pendingPath, name: pendingName, accessMode: mode });
    resetFlow();
  }, [pendingPath, pendingName, mode, setProjectContext, resetFlow]);

  const isBar = variant === "bar";

  return (
    <>
      <div className={isBar ? "flex items-center gap-1" : "mt-2 flex items-center gap-1.5"}>
        {showForm ? (
          <>
            <input
              type="text"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter")  handleCreate();
                if (e.key === "Escape") { setShowForm(false); setFormName(""); }
              }}
              placeholder="Project name…"
              autoFocus
              className="px-2.5 py-1.5 rounded-lg border border-dashed border-gray-300 dark:border-surface-border bg-transparent text-xs text-gray-700 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-gray-400 dark:focus:border-surface-border transition-colors min-w-0 w-36"
            />
            <Button
              variant="ghost"
              onClick={handleCreate}
              disabled={!formName.trim()}
              className="px-2 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-selected disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Create
            </Button>
            <IconButton
              aria-label="Cancel"
              onClick={() => { setShowForm(false); setFormName(""); }}
              className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-border transition-colors"
            >
              <X size={12} weight="bold" />
            </IconButton>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={openMenu}
              className={
                isBar
                  ? `flex items-center gap-1.5 px-2 h-6 rounded-md text-xs font-medium transition-colors duration-150 ${
                      projectContext
                        ? "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-selected"
                        : "text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-selected"
                    }`
                  : `flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 border ${
                      projectContext
                        ? "border-gray-200 dark:border-surface-border bg-gray-50 dark:bg-surface-raised text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-selected"
                        : "border-dashed border-gray-200 dark:border-surface-border text-gray-400 dark:text-gray-600 hover:border-gray-300 dark:hover:border-surface-border hover:text-gray-600 dark:hover:text-gray-400"
                    }`
              }
            >
              <FolderOpen size={14} weight={projectContext ? "duotone" : "regular"} />
              <span>{projectContext ? projectContext.name : "Work in a project"}</span>
              <CaretDown size={12} weight="bold" className={`transition-transform duration-150 ${showMenu ? "rotate-180" : ""}`} />
            </Button>

            {projectContext && (
              <IconButton
                aria-label="Clear project"
                onClick={() => setProjectContext(null)}
                title="Clear project"
                className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-border transition-colors"
              >
                <X size={12} weight="bold" />
              </IconButton>
            )}
          </>
        )}
      </div>

      {createPortal(
        <>
          {/* ── Project dropdown ── */}
          <AnimatePresence>
            {showMenu && (
              <motion.div
                key="project-backdrop"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setShowMenu(false)}
                className="fixed inset-0 bg-black/10 backdrop-blur-[2px] z-toast"
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showMenu && dropPos && (
              <div
                key="project-dropdown"
                ref={menuRef}
                style={{ position: "fixed", bottom: dropPos.bottom, left: dropPos.left, zIndex: 9999 }}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 4 }}
                  transition={{ duration: 0.1 }}
                  className="w-48 bg-surface-base border border-surface-border rounded-xl shadow-lg overflow-hidden"
                >
                  <Button
                    variant="ghost"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => { setShowMenu(false); setShowForm(true); }}
                    className="flex items-center gap-2.5 h-auto w-full px-3 py-2.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-surface-selected transition-colors"
                  >
                    <Plus size={14} weight="bold" className="text-gray-500 dark:text-gray-400 flex-shrink-0" />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">Start from scratch</span>
                  </Button>
                  <div className="mx-3 h-px bg-gray-100 dark:bg-surface-border" />
                  <Button
                    variant="ghost"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={handleSelectFolder}
                    className="flex items-center gap-2.5 h-auto w-full px-3 py-2.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-surface-selected transition-colors"
                  >
                    <FolderOpen size={14} weight="duotone" className="text-gray-500 dark:text-gray-400 flex-shrink-0" />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">Use an existing folder</span>
                  </Button>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* ── Trust / working-style modal ──
              A single split-panel card carrying up to two logical layers behind
              slideshow dots: (1) trust the folder, (2) choose the working style.
              Sibling of GlobalAccessModal — same size, branding and imagery. */}
          <AnimatePresence>
            {step !== null && (
              <>
                <motion.div
                  key="modal-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.24 }}
                  className="fixed inset-0 bg-black/50 backdrop-blur-md z-context"
                  onClick={resetFlow}
                />

                <motion.div
                  key="modal-card"
                  initial={{ opacity: 0, scale: 0.97, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 14 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className="fixed inset-0 z-context flex items-center justify-center p-4 pointer-events-none"
                >
                  <div
                    className="pointer-events-auto flex w-full max-w-[820px] h-[480px] max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-surface-base shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Left — imagery */}
                    <div className="relative hidden sm:block w-[42%] flex-shrink-0 overflow-hidden">
                      <img
                        src="/moon.png"
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover object-[42%_40%]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/10" />

                      <div className="relative flex h-full flex-col justify-between p-7">
                        <div className="flex items-center gap-2.5 text-white">
                          <StudioMark size={20} className="text-white" />
                          <span className="text-xs font-medium uppercase tracking-[0.28em] text-white/85">
                            Studio
                          </span>
                        </div>
                        <div>
                          <p className="text-3xl leading-[1.15] font-semibold text-white drop-shadow-sm">
                            Your workspace,
                            <br />
                            your rules.
                          </p>
                          <p className="mt-2 text-sm leading-relaxed text-white/75 max-w-[220px]">
                            Decide how much the assistant can do inside this
                            folder — you're always in control.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Right — the decision */}
                    <div className="flex flex-1 flex-col p-8 sm:p-10 overflow-y-auto">
                      <div className="flex flex-1 flex-col justify-center min-h-0">
                      <AnimatePresence mode="wait" initial={false}>
                        {step === "trust" ? (
                          <motion.div
                            key="trust"
                            initial={{ opacity: 0, x: 16 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -16 }}
                            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                          >
                            <span className="text-xs font-medium uppercase tracking-[0.22em] text-gray-400 dark:text-gray-500">
                              Workspace trust
                            </span>
                            <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-gray-50">
                              Do you trust this folder?
                            </h2>
                            <div className="mt-3 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                              <FolderOpen size={16} weight="duotone" className="flex-shrink-0" />
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                                {pendingName}
                              </span>
                            </div>
                            <p className="mt-3 text-base leading-relaxed text-gray-500 dark:text-gray-400">
                              Trusting lets the assistant edit files, run commands,
                              and change git state inside this folder. Only trust
                              folders whose contents you know.
                            </p>
                            <p className="mt-4 text-sm leading-relaxed text-gray-400 dark:text-gray-500">
                              You can change this later in Settings → Permissions.
                            </p>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="mode"
                            initial={{ opacity: 0, x: 16 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -16 }}
                            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                          >
                            <span className="text-xs font-medium uppercase tracking-[0.22em] text-gray-400 dark:text-gray-500">
                              Working style
                            </span>
                            <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-gray-50">
                              How should the assistant work here?
                            </h2>
                            <p className="mt-3 text-base leading-relaxed text-gray-500 dark:text-gray-400">
                              Set the pace for this folder. You can switch anytime
                              from the chat controls.
                            </p>

                            <div className="mt-5 space-y-2.5">
                              <ModeOption
                                icon={<Eye size={18} weight="duotone" />}
                                title="Review"
                                description="Ask before each sensitive action — edits, commands, git."
                                selected={mode === "review"}
                                onClick={() => setMode("review")}
                              />
                              <ModeOption
                                icon={<Lightning size={18} weight="fill" />}
                                title="Autonomous"
                                description="Act without prompts, pausing only for high-risk actions."
                                selected={mode === "autonomous"}
                                onClick={() => setMode("autonomous")}
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      </div>

                      {/* Footer — slideshow dots + actions */}
                      <div className="mt-8 flex items-center gap-4">
                        {hasTrustStep && (
                          <div className="flex items-center gap-1.5">
                            <Dot active={step === "trust"} />
                            <Dot active={step === "mode"} />
                          </div>
                        )}

                        <div className="flex flex-1 gap-2.5">
                          {step === "trust" ? (
                            <>
                              <Button
                                variant="outline"
                                onClick={resetFlow}
                                className="h-auto flex-1 justify-center py-2.5 text-base font-medium text-gray-600 dark:text-gray-300 border-gray-200 dark:border-surface-border hover:bg-gray-100 dark:hover:bg-surface-selected hover:text-gray-900 dark:hover:text-gray-100 rounded-2xl"
                              >
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                onClick={handleTrustConfirm}
                                className="h-auto flex-1 justify-center py-2.5 text-base font-semibold text-white bg-gray-900 dark:bg-gray-100 dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white rounded-2xl"
                              >
                                I trust it
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => (hasTrustStep ? setStep("trust") : resetFlow())}
                                className="h-auto flex-1 justify-center py-2.5 text-base font-medium text-gray-600 dark:text-gray-300 border-gray-200 dark:border-surface-border hover:bg-gray-100 dark:hover:bg-surface-selected hover:text-gray-900 dark:hover:text-gray-100 rounded-2xl"
                              >
                                {hasTrustStep ? "Back" : "Cancel"}
                              </Button>
                              <Button
                                variant="primary"
                                onClick={handleConfirmMode}
                                className="h-auto flex-1 justify-center py-2.5 text-base font-semibold text-white bg-gray-900 dark:bg-gray-100 dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white rounded-2xl"
                              >
                                Continue
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>,
        document.body
      )}
    </>
  );
}

function Dot({ active }: { active: boolean }) {
  return (
    <span
      className={`h-1.5 rounded-full transition-all duration-300 ${
        active
          ? "w-5 bg-gray-900 dark:bg-gray-100"
          : "w-1.5 bg-gray-300 dark:bg-surface-border"
      }`}
    />
  );
}

interface ModeOptionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}

function ModeOption({ icon, title, description, selected, onClick }: ModeOptionProps) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`w-full h-auto justify-start text-left p-3.5 rounded-2xl border transition-colors duration-200 ${
        selected
          ? "border-gray-300/70 dark:border-white/15 bg-gray-50 dark:bg-white/[0.05]"
          : "border-gray-200 dark:border-white/10 hover:bg-gray-50/70 dark:hover:bg-white/[0.03]"
      }`}
    >
      <div className="w-full flex items-center gap-3">
        <span
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors duration-200 ${
            selected
              ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
              : "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
          }`}
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-gray-900 dark:text-gray-100">{title}</span>
          <p className="text-sm text-gray-500 dark:text-gray-500 leading-relaxed mt-0.5">{description}</p>
        </div>
        <span
          className={`grid h-4 w-4 flex-shrink-0 place-items-center rounded-full border-2 transition-colors duration-200 ${
            selected
              ? "border-gray-900 dark:border-gray-100"
              : "border-gray-300 dark:border-white/25"
          }`}
        >
          <motion.span
            initial={false}
            animate={{ scale: selected ? 1 : 0, opacity: selected ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 600, damping: 28 }}
            className="h-2 w-2 rounded-full bg-gray-900 dark:bg-gray-100"
          />
        </span>
      </div>
    </Button>
  );
}
