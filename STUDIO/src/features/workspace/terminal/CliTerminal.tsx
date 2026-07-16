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
import { codingSessionManager } from "./codingSessionManager";

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

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function terminalTheme(): ITheme {
  const base = isDarkMode() ? DARK_THEME : LIGHT_THEME;
  const background = token("--surface-page", base.background || "transparent");
  const foreground = token("--text-primary", base.foreground || "inherit");
  return {
    ...base,
    background,
    foreground,
    cursor: token("--text-secondary", foreground),
    cursorAccent: background,
    selectionBackground: token("--surface-selected", base.selectionBackground || background),
    selectionForeground: foreground,
    black: background,
    brightBlack: token("--text-muted", base.brightBlack || foreground),
    white: token("--text-secondary", base.white || foreground),
    brightWhite: foreground,
  };
}

export interface CliTerminalProps {
  program: string;
  args?: string[];
  cwd?: string | null;
  /** Whether this terminal's tab is currently shown. Drives refit + focus. */
  active: boolean;
  cliId?: string;
}

let _sesSeq = 0;
const nextSesId = () => `cli-${++_sesSeq}-${Date.now()}`;

async function ensureOpencodeSystemThemeConfig(): Promise<string | null> {
  try {
    const [{ appDataDir, join }, fs] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const dir = await join(await appDataDir(), "cli");
    await fs.mkdir(dir, { recursive: true });
    const path = await join(dir, "opencode-tui-system.json");
    await fs.writeTextFile(path, JSON.stringify({
      $schema: "https://opencode.ai/tui.json",
      theme: "system",
    }, null, 2));
    return path;
  } catch {
    return null;
  }
}

async function themeEnv(cliId?: string): Promise<Record<string, string>> {
  const dark = isDarkMode();
  const env: Record<string, string> = {
    COLORTERM: "truecolor",
    TERM: "xterm-256color",
    COLORFGBG: dark ? "15;0" : "0;15",
  };
  if (cliId === "opencode") {
    const tuiConfig = await ensureOpencodeSystemThemeConfig();
    if (tuiConfig) env.OPENCODE_TUI_CONFIG = tuiConfig;
  }
  return env;
}

export function CliTerminal({ program, args = [], cwd = null, active, cliId }: CliTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const unlistensRef = useRef<Array<() => void>>([]);
  const roRef = useRef<ResizeObserver | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const ptyReadyRef = useRef(false);
  const activeRef = useRef(active);
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
      theme: terminalTheme(),
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
    let admitted = false;
    let disposed = false;

    (async () => {
      try {
        codingSessionManager.acquire({
          id: sessionId,
          runtime: "local",
          kind: cliId === "opencode" ? "opencode" : "cli-bridge",
          cwd,
          status: "starting",
        });
        admitted = true;
        if (disposed) {
          codingSessionManager.release(sessionId);
          admitted = false;
          return;
        }
      } catch (error) {
        xterm.writeln(`\r\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`);
        return;
      }
      ulData = await listen<{ sessionId: string; data: string }>(
        "pty-data",
        ({ payload }) => {
          if (payload.sessionId !== sessionId) return;
          codingSessionManager.update(sessionId, "active");
          xterm.write(payload.data);
        },
      );
      ulExit = await listen<{ sessionId: string }>(
        "pty-exit",
        ({ payload }) => {
          if (payload.sessionId !== sessionId) return;
          codingSessionManager.update(sessionId, "exited");
          codingSessionManager.release(sessionId);
          admitted = false;
          xterm.writeln("\r\n\x1b[2m[" + program + " exited — close the tab to remove]\x1b[0m");
        },
      );
      if (disposed) {
        ulData();
        ulExit();
        codingSessionManager.release(sessionId);
        admitted = false;
        return;
      }
      unlistensRef.current = [ulData, ulExit];

      try {
        await invoke("pty_create", {
          sessionId,
          cols: xterm.cols,
          rows: xterm.rows,
          cwd: cwd ?? null,
          env: await themeEnv(cliId),
          program,
          args,
        });
        if (disposed) {
          invoke("pty_close", { sessionId }).catch(() => {});
          codingSessionManager.release(sessionId);
          admitted = false;
          return;
        }
        ptyReadyRef.current = true;
        codingSessionManager.update(sessionId, activeRef.current ? "active" : "idle");
        scheduleFit(true);
      } catch (err) {
        codingSessionManager.release(sessionId);
        admitted = false;
        if (!disposed) xterm.writeln(`\r\n\x1b[31mFailed to launch ${program}: ${err}\x1b[0m\r\n`);
      }
    })();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => scheduleFit());
      ro.observe(container);
      roRef.current = ro;
    }

    return () => {
      disposed = true;
      if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current);
      roRef.current?.disconnect();
      unlistensRef.current.forEach((fn) => fn());
      invoke("pty_close", { sessionId }).catch(() => {});
      if (admitted) codingSessionManager.release(sessionId);
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
    activeRef.current = active;
    const sessionId = sessionRef.current;
    if (sessionId) codingSessionManager.update(sessionId, active ? "active" : "idle");
    if (active) scheduleFit(true);
  }, [active, scheduleFit]);

  // Track colour-mode changes.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (termRef.current) {
        termRef.current.options.theme = terminalTheme();
        termRef.current.refresh(0, Math.max(0, termRef.current.rows - 1));
        scheduleFit();
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [scheduleFit]);

  return (
    <div className="h-full w-full overflow-hidden rounded-lg bg-surface-page px-4 pb-2 pt-[52px]">
      <div ref={containerRef} className="h-full w-full overflow-hidden rounded-lg bg-surface-page" />
    </div>
  );
}
