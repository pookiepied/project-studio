/**
 * TerminalPanel — real PTY-backed terminal using xterm.js.
 *
 * Every tab is a genuine shell (PowerShell on Windows / bash elsewhere)
 * running inside an OS pseudo-terminal, so interactive programs like
 * `claude`, `python`, `vim`, `git log --graph` all work exactly as they
 * do in Windows Terminal.
 *
 * The prompt, colours, cursor, resize — everything is handled by xterm.js
 * rendering the raw VT sequences that PowerShell emits. We never parse or
 * reconstruct shell output ourselves.
 *
 * Tauri commands used:
 *   pty_create(sessionId, cols, rows, cwd?)
 *   pty_write(sessionId, data)
 *   pty_close(sessionId)
 *
 * Tauri events consumed:
 *   pty-data  { sessionId, data }
 *   pty-exit  { sessionId }
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TerminalIcon as Terminal, XIcon as X, PlusIcon as Plus } from "@phosphor-icons/react";
import { Terminal as XTerm, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ResizeHandle } from "@/features/workspace/rightWorkspace/ResizeHandle";
import { FONT_MONO } from "@/design/fonts";

// ─── Xterm themes (matched to tailwind.config.js palette) ────────────────────
// xterm ITHEME ANSI palette — data-viz carve-out: terminal ANSI 16-color palette
// cannot be expressed via Tailwind tokens (the ITheme contract requires raw hex)
/* eslint-disable no-restricted-syntax */
const DARK_THEME: ITheme = {
  background:          "#121212",  // surface-page
  foreground:          "#D4D4D4",
  cursor:              "#A3A3A3",  // text-muted
  cursorAccent:        "#121212",
  selectionBackground: "#2E2E2E",  // surface-border
  selectionForeground: "#E5E5E5",
  black:               "#121212",
  brightBlack:         "#404040",  // gray-600
  red:                 "#F87171",
  brightRed:           "#FCA5A5",
  green:               "#6DB33F",
  brightGreen:         "#86EFAC",
  yellow:              "#FCD34D",
  brightYellow:        "#FDE68A",
  blue:                "#60A5FA",
  brightBlue:          "#93C5FD",
  magenta:             "#C084FC",
  brightMagenta:       "#D8B4FE",
  cyan:                "#22D3EE",
  brightCyan:          "#67E8F9",
  white:               "#A3A3A3",  // text-muted
  brightWhite:         "#E5E5E5",  // text-primary
};

const LIGHT_THEME: ITheme = {
  background:          "#FFFFFF",
  foreground:          "#262626",  // gray-800
  cursor:              "#404040",  // gray-700
  cursorAccent:        "#FFFFFF",
  selectionBackground: "#E5E5E5",  // gray-200
  selectionForeground: "#171717",
  black:               "#171717",  // gray-900
  brightBlack:         "#737373",  // gray-500
  red:                 "#EF4444",
  brightRed:           "#F87171",
  green:               "#22C55E",
  brightGreen:         "#6DB33F",
  yellow:              "#D97706",
  brightYellow:        "#F59E0B",
  blue:                "#2563EB",
  brightBlue:          "#3B82F6",
  magenta:             "#9333EA",
  brightMagenta:       "#A855F7",
  cyan:                "#0891B2",
  brightCyan:          "#06B6D4",
  white:               "#737373",  // gray-500
  brightWhite:         "#171717",  // gray-900
};
/* eslint-enable no-restricted-syntax */

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TabInfo {
  id:      string;
  label:   string;
  running: boolean;   // shell process is alive
  exited:  boolean;   // shell exited (show restart hint)
}

/** Per-tab xterm state (stored in a ref — not React state). */
interface XtermEntry {
  terminal:  XTerm;
  fitAddon:  FitAddon;
  sessionId: string;
  unlistens: Array<() => void>;
}

export interface TerminalPanelProps {
  width:              number;
  onWidthChange:      (w: number) => void;
  onClose:            () => void;
  projectCwd?:        string | null;
  showChrome?:        boolean;
  showResizeHandle?:  boolean;
}

// ─── Counters ─────────────────────────────────────────────────────────────────

let _tabSeq = 0;
let _sesSeq = 0;
const nextTabId = () => `tab-${++_tabSeq}`;
const nextSesId = () => `pty-${++_sesSeq}-${Date.now()}`;

function makeTabInfo(num: number): TabInfo {
  return {
    id:      nextTabId(),
    label:   num === 1 ? "powershell" : `powershell ${num}`,
    running: false,
    exited:  false,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TerminalPanel({
  width, onWidthChange, onClose, projectCwd, showChrome = true, showResizeHandle = true,
}: TerminalPanelProps) {
  const [tabs,          setTabs]          = useState<TabInfo[]>(() => [makeTabInfo(1)]);
  const [activeId,      setActiveId]      = useState<string>(() => tabs[0].id);

  // xterm.js instances — held in refs, not state
  const xtermMap  = useRef<Map<string, XtermEntry>>(new Map());

  // DOM container refs — one div per tab
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Resize drag
  const drag = useRef<{ sx: number; sw: number } | null>(null);

  // Current font size — adjusted by Ctrl+scroll
  const fontSizeRef = useRef(12);

  // Floating window ref for Ctrl+scroll listener
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Create xterm + PTY for a new tab ─────────────────────────────────────

  const spawnTerminal = useCallback(async (tabId: string) => {
    const container = containerRefs.current.get(tabId);
    if (!container) return;

    const dark = isDarkMode();

    const xterm = new XTerm({
      fontFamily:    FONT_MONO,
      fontSize:      fontSizeRef.current,
      lineHeight:    1.4,
      letterSpacing: 0,
      cursorBlink:   true,
      cursorStyle:   "bar",
      cursorWidth:   1.5,
      scrollback:    5000,
      theme:         dark ? DARK_THEME : LIGHT_THEME,
      allowTransparency: false,
      convertEol:    false,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(container);

    // Give the DOM one frame to lay out before fitting
    await new Promise(r => requestAnimationFrame(r));
    fitAddon.fit();

    const sessionId = nextSesId();
    const { cols, rows } = xterm;

    // Forward key presses + paste to PTY stdin
    xterm.onData(data => {
      invoke("pty_write", { sessionId, data }).catch(() => {});
    });

    // PTY output → xterm
    const ulData = await listen<{ sessionId: string; data: string }>(
      "pty-data",
      ({ payload }) => {
        if (payload.sessionId !== sessionId) return;
        xterm.write(payload.data);
      }
    );

    // Shell exited
    const ulExit = await listen<{ sessionId: string }>(
      "pty-exit",
      ({ payload }) => {
        if (payload.sessionId !== sessionId) return;
        xterm.writeln("\r\n\x1b[2m[Process exited — press Enter for a new shell]\x1b[0m");
        setTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, running: false, exited: true } : t
        ));
      }
    );

    xtermMap.current.set(tabId, {
      terminal: xterm,
      fitAddon,
      sessionId,
      unlistens: [ulData, ulExit],
    });

    // Mark running
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, running: true, exited: false } : t
    ));

    // Spawn the actual PTY
    try {
      await invoke("pty_create", {
        sessionId,
        cols,
        rows,
        cwd: projectCwd ?? null,
      });
    } catch (err) {
      xterm.writeln(`\r\n\x1b[31mpty_create failed: ${err}\x1b[0m\r\n`);
      setTabs(prev => prev.map(t =>
        t.id === tabId ? { ...t, running: false, exited: true } : t
      ));
    }
  }, [projectCwd]);

  // ── Tear down a tab's xterm + PTY ────────────────────────────────────────

  const destroyTerminal = useCallback((tabId: string) => {
    const entry = xtermMap.current.get(tabId);
    if (!entry) return;
    entry.unlistens.forEach(fn => fn());
    invoke("pty_close", { sessionId: entry.sessionId }).catch(() => {});
    entry.terminal.dispose();
    xtermMap.current.delete(tabId);
  }, []);

  // ── Mount: spawn terminal for the first tab ────────────────────────────────

  useEffect(() => {
    const firstId = tabs[0].id;
    // Small delay so the container div is in the DOM
    const t = setTimeout(() => spawnTerminal(firstId), 50);
    return () => {
      clearTimeout(t);
      // Cleanup all tabs on unmount
      tabs.forEach(t => destroyTerminal(t.id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Focus active xterm when switching tabs ─────────────────────────────────

  useEffect(() => {
    const entry = xtermMap.current.get(activeId);
    if (!entry) return;
    // Small delay so the container is visible before focus
    const t = setTimeout(() => {
      entry.fitAddon.fit();
      entry.terminal.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [activeId]);

  // ── Refit all terminals when panel width changes (resize drag) ────────────

  useEffect(() => {
    const entry = xtermMap.current.get(activeId);
    if (!entry) return;
    requestAnimationFrame(() => entry.fitAddon.fit());
  }, [width, activeId]);

  // ── Ctrl+scroll to zoom font size ─────────────────────────────────────────

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const next = Math.max(8, Math.min(24, fontSizeRef.current + (e.deltaY < 0 ? 1 : -1)));
      fontSizeRef.current = next;
      xtermMap.current.forEach(({ terminal, fitAddon }) => {
        terminal.options.fontSize = next;
        requestAnimationFrame(() => fitAddon.fit());
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Update xterm theme when app colour mode changes ───────────────────────

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = isDarkMode() ? DARK_THEME : LIGHT_THEME;
      xtermMap.current.forEach(({ terminal }) => terminal.options.theme = theme);
    });
    observer.observe(document.documentElement, {
      attributes: true, attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // ── Tab management ─────────────────────────────────────────────────────────

  const addTab = async () => {
    const newTab = makeTabInfo(tabs.length + 1);
    setTabs(prev => [...prev, newTab]);
    setActiveId(newTab.id);
    // Wait for React to render the new container div
    await new Promise(r => setTimeout(r, 60));
    spawnTerminal(newTab.id);
  };

  const closeTab = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    destroyTerminal(id);
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) { onClose(); return prev; }
      if (activeId === id) {
        const idx = prev.findIndex(t => t.id === id);
        setActiveId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
  };

  // ── Restart exited shell ──────────────────────────────────────────────────

  const restartTab = (tabId: string) => {
    destroyTerminal(tabId);
    xtermMap.current.delete(tabId);
    setTimeout(() => spawnTerminal(tabId), 30);
  };

  // ── Resize drag ───────────────────────────────────────────────────────────

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { sx: e.clientX, sw: width };
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      // Cap at half the window so the chat side always keeps >=50% (rail + text
      // get crushed otherwise); never exceed 1000 or drop below 400.
      const maxW = Math.max(400, Math.min(1000, Math.round(window.innerWidth * 0.5)));
      onWidthChange(Math.max(400, Math.min(maxW,
        drag.current.sw + (drag.current.sx - ev.clientX)
      )));
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  const activeTab = tabs.find(t => t.id === activeId);

  return (
    <div
      className="flex h-full transition-colors duration-300"
      style={{ width, minWidth: width }}
    >
      {/* ── Resize handle — invisible, cursor only, shadow does the separation ── */}
      {showResizeHandle && <ResizeHandle onMouseDown={onResizeDown} />}

      {/* ── Docked window ── */}
      <div ref={panelRef} className="flex-1 flex flex-col overflow-hidden min-w-0
                      bg-surface-page
                      transition-colors duration-300">

        {/* ── Window title bar ── */}
        {showChrome && (
        <div className="flex items-center gap-2.5 px-3 h-10 flex-shrink-0
                        bg-surface-page
                        border-b border-gray-100 dark:border-white/[0.06]
                        transition-colors duration-300">

          <button
            type="button"
            onClick={onClose}
            title="Close terminal"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-300"
          >
            <X size={14} weight="bold" />
          </button>

          {/* Icon + active tab name + status dot */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Terminal size={12} weight="regular" className="text-gray-400 dark:text-gray-600 flex-shrink-0" />
            <span className="text-xs text-gray-500 dark:text-gray-500 truncate">
              {activeTab?.label ?? "terminal"}
            </span>
            <AnimatePresence mode="wait">
              {activeTab?.running && (
                <motion.span key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-surface-raised dark:bg-surface-raised" />
              )}
              {activeTab?.exited && (
                <motion.span key="exited" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-gray-300 dark:bg-gray-600" />
              )}
            </AnimatePresence>
          </div>

          {/* Tab switcher — only when >1 tab */}
          {tabs.length > 1 && (
            <div className="flex items-center gap-0.5 flex-shrink min-w-0 overflow-hidden">
              {tabs.map(tab => {
                const active = tab.id === activeId;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveId(tab.id)}
                    onDoubleClick={() => tab.exited && restartTab(tab.id)}
                    className={`group/tab flex items-center gap-1 px-2 h-6 rounded text-2xs flex-shrink-0
                      transition-colors duration-100
                      ${active
                        ? "bg-white dark:bg-surface-raised text-gray-600 dark:text-gray-300 shadow-sm"
                        : "text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400"
                      }`}
                  >
                    {tab.label}
                    <span
                      role="button"
                      onClick={ev => closeTab(tab.id, ev)}
                      className="w-3 h-3 flex items-center justify-center rounded
                                 opacity-0 group-hover/tab:opacity-100 transition-opacity duration-100
                                 hover:bg-gray-200 dark:hover:bg-surface-border
                                 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      <X size={12} weight="bold" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* New tab */}
          <button
            type="button"
            onClick={addTab}
            title="New terminal tab"
            className="w-6 h-6 flex items-center justify-center rounded flex-shrink-0
                       text-gray-400 dark:text-gray-600
                       hover:bg-gray-200 dark:hover:bg-surface-selected
                       hover:text-gray-600 dark:hover:text-gray-400
                       transition-colors duration-100"
          >
            <Plus size={12} weight="regular" />
          </button>
        </div>
        )}

        {/* ── xterm.js containers (one per tab, hidden when not active) ── */}
        <div className="flex-1 relative overflow-hidden">
          {tabs.map(tab => (
            <div
              key={tab.id}
              ref={el => {
                if (el) containerRefs.current.set(tab.id, el);
                else    containerRefs.current.delete(tab.id);
              }}
              className="bg-white dark:bg-surface-page"
              style={{
                position:  "absolute",
                inset:     0,
                padding:   "8px 12px",
                display:   tab.id === activeId ? "flex" : "none",
                flexDirection: "column",
              }}
            />
          ))}
        </div>

      </div>
    </div>
  );
}
