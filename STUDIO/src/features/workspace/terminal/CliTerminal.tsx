/**
 * CliTerminal — a real PTY-backed xterm.js terminal that launches a given
 * program directly (e.g. `claude`, `codex`, `opencode`) instead of a shell.
 *
 * Mirrors TerminalPanel's PTY wiring but is single-session, chrome-less, and
 * program-driven: pty_create is called with `program`/`args` so the CLI owns
 * the terminal from the first frame (no shell prompt, no echoed command).
 *
 * The instance stays mounted across tab switches so a backgrounded CLI keeps
 * running; `active` drives refit + focus when the tab is shown again.
 */

import { useCallback, useEffect, useRef } from "react";
import { Terminal as XTerm,type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FONT_MONO } from "@/design/fonts";

/* eslint-disable no-restricted-syntax -- xterm ITheme needs raw hex ANSI values */
const DARK_THEME: ITheme = {
  background: "#121212",
  foreground: "#D4D4D4",
  cursor: "#A3A3A3",
  cursorAccent: "#121212",
  selectionBackground: "#2E2E2E",
  selectionForeground: "#E5E5E5",
  black: "#121212", brightBlack: "#404040",
  red: "#F87171", brightRed: "#FCA5A5",
  green: "#6DB33F", brightGreen: "#86EFAC",
  yellow: "#FCD34D", brightYellow: "#FDE68A",
  blue: "#60A5FA", brightBlue: "#93C5FD",
  magenta: "#C084FC", brightMagenta: "#D8B4FE",
  cyan: "#22D3EE", brightCyan: "#67E8F9",
  white: "#A3A3A3", brightWhite: "#E5E5E5",
};

const LIGHT_THEME: ITheme = {
  background: "#FFFFFF",
  foreground: "#262626",
  cursor: "#404040",
  cursorAccent: "#FFFFFF",
  selectionBackground: "#E5E5E5",
  selectionForeground: "#171717",
  black: "#171717", brightBlack: "#737373",
  red: "#EF4444", brightRed: "#F87171",
  green: "#22C55E", brightGreen: "#6DB33F",
  yellow: "#D97706", brightYellow: "#F59E0B",
  blue: "#2563EB", brightBlue: "#3B82F6",
  magenta: "#9333EA", brightMagenta: "#A855F7",
  cyan: "#0891B2", brightCyan: "#06B6D4",
  white: "#737373", brightWhite: "#171717",
};
/* eslint-enable no-restricted-syntax */

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

export interface CliTerminalProps {
  program: string;
  args?: string[];
  cwd?: string | null;
  /** Whether this terminal's tab is currently shown. Drives refit + focus. */
  active: boolean;
}

let _sesSeq = 0;
const nextSesId = () => `cli-${++_sesSeq}-${Date.now()}`;

export function CliTerminal({ program, args = [], cwd = null, active }: CliTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const unlistensRef = useRef<Array<() => void>>([]);
  const roRef = useRef<ResizeObserver | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const ptyReadyRef = useRef(false);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const fontSizeRef = useRef(12);

  const scheduleFit = useCallback((focus = false) => {
    const term = termRef.current;
    const fit = fitRef.current;
    const container = containerRef.current;
    if (!term || !fit || !container) return;
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current);
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
      try { fit.fit(); } catch { return; }
      const { cols, rows } = term;
      const prev = lastSizeRef.current;
      if (ptyReadyRef.current && (!prev || prev.cols !== cols || prev.rows !== rows)) {
        lastSizeRef.current = { cols, rows };
        invoke("pty_resize", { sessionId: sessionRef.current, cols, rows }).catch(() => {});
      }
      if (focus) term.focus();
    });
  }, []);

  // Create xterm + spawn the program once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const xterm = new XTerm({
      fontFamily: FONT_MONO,
      fontSize: fontSizeRef.current,
      lineHeight: 1.4,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
      theme: isDarkMode() ? DARK_THEME : LIGHT_THEME,
      allowTransparency: false,
      convertEol: false,
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(container);

    termRef.current = xterm;
    fitRef.current = fit;

    const sessionId = nextSesId();
    sessionRef.current = sessionId;

    xterm.onData((data) => {
      invoke("pty_write", { sessionId, data }).catch(() => {});
    });

    let ulData: () => void = () => {};
    let ulExit: () => void = () => {};

    (async () => {
      ulData = await listen<{ sessionId: string; data: string }>(
        "pty-data",
        ({ payload }) => {
          if (payload.sessionId !== sessionId) return;
          xterm.write(payload.data);
        },
      );
      ulExit = await listen<{ sessionId: string }>(
        "pty-exit",
        ({ payload }) => {
          if (payload.sessionId !== sessionId) return;
          xterm.writeln("\r\n\x1b[2m[" + program + " exited — close the tab to remove]\x1b[0m");
        },
      );
      unlistensRef.current = [ulData, ulExit];

      try {
        await invoke("pty_create", {
          sessionId,
          cols: xterm.cols,
          rows: xterm.rows,
          cwd: cwd ?? null,
          program,
          args,
        });
        ptyReadyRef.current = true;
        scheduleFit(true);
      } catch (err) {
        xterm.writeln(`\r\n\x1b[31mFailed to launch ${program}: ${err}\x1b[0m\r\n`);
      }
    })();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => scheduleFit());
      ro.observe(container);
      roRef.current = ro;
    }

    return () => {
      if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current);
      roRef.current?.disconnect();
      unlistensRef.current.forEach((fn) => fn());
      invoke("pty_close", { sessionId }).catch(() => {});
      xterm.dispose();
      termRef.current = null;
      fitRef.current = null;
      sessionRef.current = null;
      ptyReadyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program]);

  // Refit + focus when the tab becomes active.
  useEffect(() => {
    if (active) scheduleFit(true);
  }, [active, scheduleFit]);

  // Track colour-mode changes.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (termRef.current) {
        termRef.current.options.theme = isDarkMode() ? DARK_THEME : LIGHT_THEME;
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="h-full w-full bg-surface-page">
      <div ref={containerRef} className="h-full w-full" style={{ padding: "8px 12px" }} />
    </div>
  );
}
