import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CaretDownIcon as CaretDown } from "@phosphor-icons/react";
import { useOnClickOutside } from "@/lib/hooks/useOnClickOutside";
import { useSettings } from "@/app/contexts/SettingsContext";
import { resolveTheme } from "@/lib/theme";
import { PROJECT_APPS } from "./projectApps";
import { psArray, psString, runPowerShell } from "./projectAppsShell";
import {
  getAvailableProjectApps,
  getCachedProjectAppsSync,
} from "./projectAppsDetection";
import type { ExternalProjectApp, ProjectContextLike } from "./types";

interface ProjectLauncherProps {
  isTauri: boolean;
  projectContext?: ProjectContextLike | null;
}

const SELECTED_APP_STORAGE_KEY = "studio.projectApps.selected.v1";

function getSelectedProjectAppSync(): string | null {
  try {
    return localStorage.getItem(SELECTED_APP_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setSelectedProjectAppSync(appId: string): void {
  try {
    localStorage.setItem(SELECTED_APP_STORAGE_KEY, appId);
  } catch {
    /* ignore storage failures */
  }
}

function buildAppLaunchScript(app: ExternalProjectApp, projectPath: string) {
  return `
$appId = ${psString(app.id)}
$commands = ${psArray(app.commands)}
$paths = ${psArray(app.windowsPaths)}
$arguments = ${psArray(app.args(projectPath))}

function Join-ProcessArguments {
  param([string[]]$Values)
  ($Values | ForEach-Object {
    '"' + ([string]$_).Replace('"', '\\"') + '"'
  }) -join ' '
}

function Start-ProjectApp {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )
  $joinedArguments = Join-ProcessArguments -Values $Arguments
  Start-Process -FilePath $FilePath -ArgumentList $joinedArguments
}

foreach ($path in $paths) {
  $expandedPath = $ExecutionContext.InvokeCommand.ExpandString($path)
  $resolved = Resolve-Path -Path $expandedPath -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($resolved) {
    Start-ProjectApp -FilePath $resolved.Path -Arguments $arguments
    exit 0
  }
}
foreach ($command in $commands) {
  $resolvedCommand = Get-Command $command -ErrorAction SilentlyContinue
  if ($resolvedCommand) {
    Start-ProjectApp -FilePath $resolvedCommand.Source -Arguments $arguments
    exit 0
  }
}
throw "Project app not found: $appId"
`;
}

function isDarkColor(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.25;
}

function BrandPathIcon({
  path,
  hex,
  isDark,
  scale = 1,
}: {
  path: string;
  hex: string;
  isDark: boolean;
  scale?: number;
}) {
  // eslint-disable-next-line no-restricted-syntax -- SVG icon fill fallback (lightens dark brand marks in dark mode); dynamic hex, not a class
  const fill = isDark && isDarkColor(hex) ? "#E6E6E6" : hex;
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill={fill}
      aria-hidden="true"
      className="flex-shrink-0"
      style={{ transform: `scale(${scale})` }}
    >
      <path d={path} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}

function VsCodeIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="flex-shrink-0">
      <path fill={color} d="M17.5 2.6 7.4 11.7 3.1 8.4 1.5 9.2v5.6l1.6.8 4.3-3.3 10.1 9.1 5-2.1V4.7l-5-2.1Z" />
      <path fill="#fff" fillOpacity=".22" d="M17.5 7.4v9.2l-6-4.6 6-4.6Z" />
    </svg>
  );
}

function VisualStudioIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="flex-shrink-0">
      <path fill={color} d="M17.4 3.2 9.2 8.8 4.8 5.4 2 6.8v10.4l2.8 1.4 4.4-3.4 8.2 5.6 4.6-1.9V5.1l-4.6-1.9Zm-.2 4.3v9L11.6 12l5.6-4.5ZM5.1 9.4 7.9 12l-2.8 2.6V9.4Z" />
    </svg>
  );
}

// Folder glyph — fixed multi-tone icon hues (data-viz/brand carve-out), no neutral-token equivalent
/* eslint-disable no-restricted-syntax */
function FileExplorerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="flex-shrink-0">
      <path fill="#FDD663" d="M2.5 7.2c0-1 .8-1.8 1.8-1.8h5l1.8 2h8.6c1 0 1.8.8 1.8 1.8v1.1h-19V7.2Z" />
      <path fill="#F4B400" d="M2.5 9.3h19l-1.2 8.1c-.2.9-.9 1.5-1.8 1.5H5.1c-.9 0-1.7-.7-1.8-1.6L2.5 9.3Z" />
      <path fill="#FFE18A" d="M3.4 10.3h17.2l-.2 1.3H3.5l-.1-1.3Z" opacity=".9" />
    </svg>
  );
}
/* eslint-enable no-restricted-syntax */

function TerminalIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="flex-shrink-0">
      <path fill={color} d="M4.5 4h15c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2h-15c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2Zm.2 3.8 3.4 3.2-3.4 3.2 1.4 1.5 5-4.7-5-4.7-1.4 1.5Zm7.4 7.7v2h6.6v-2h-6.6Z" />
    </svg>
  );
}

function ProjectAppIcon({ app, isDark }: { app: ExternalProjectApp; isDark: boolean }) {
  if (app.icon.kind === "simple-icon") {
    return (
      <BrandPathIcon
        path={app.icon.path}
        hex={app.icon.hex}
        isDark={isDark}
        scale={app.icon.scale}
      />
    );
  }

  if (app.icon.name === "vscode") return <VsCodeIcon color={app.color} />;
  if (app.icon.name === "visual-studio") return <VisualStudioIcon color={app.color} />;
  if (app.icon.name === "terminal") return <TerminalIcon color={app.color} />;
  return <FileExplorerIcon />;
}

export function ProjectLauncher({ isTauri, projectContext }: ProjectLauncherProps) {
  const { settings } = useSettings();
  const isDark = resolveTheme(settings.theme) === "dark";
  const [open, setOpen] = useState(false);
  const [availableIds, setAvailableIds] = useState<Set<string>>(
    () => getCachedProjectAppsSync() ?? new Set(["explorer"]),
  );
  const [selectedAppId, setSelectedAppId] = useState<string | null>(
    () => getSelectedProjectAppSync(),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => setOpen(false), open);

  useEffect(() => {
    if (!isTauri) {
      setAvailableIds(new Set());
      return;
    }

    let cancelled = false;
    getAvailableProjectApps(isTauri).then((ids) => {
      if (!cancelled) setAvailableIds(new Set(ids));
    });

    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  const availableApps = useMemo(
    () => PROJECT_APPS.filter((app) => availableIds.has(app.id)),
    [availableIds],
  );

  const selectedApp = availableApps.find((app) => app.id === selectedAppId);
  const defaultApp = selectedApp ?? availableApps[0];
  if (!isTauri || !projectContext?.path || !defaultApp) return null;

  const openApp = (app: ExternalProjectApp, remember = false) => {
    setOpen(false);
    if (remember) {
      setSelectedAppId(app.id);
      setSelectedProjectAppSync(app.id);
    }
    runPowerShell(buildAppLaunchScript(app, projectContext.path)).catch((err) => {
      console.error(`[ProjectLauncher] Failed to open project in ${app.label}:`, err);
    });
  };

  return (
    <div ref={containerRef} className="relative flex items-center">
      <div className="flex h-7 items-center rounded-lg border border-gray-200 bg-white shadow-sm dark:border-surface-border dark:bg-surface-raised">
        <button
          type="button"
          onClick={() => openApp(defaultApp)}
          title={`Open project in ${defaultApp.label}`}
          className="flex h-7 w-7 items-center justify-center rounded-l-lg text-gray-500 transition-colors duration-100 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-surface-selected dark:hover:text-gray-300"
        >
          <ProjectAppIcon app={defaultApp} isDark={isDark} />
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Choose project app"
          className="flex h-7 w-5 items-center justify-center rounded-r-lg border-l border-gray-100 text-gray-400 transition-colors duration-100 hover:bg-gray-50 hover:text-gray-600 dark:border-surface-border dark:hover:bg-surface-selected dark:hover:text-gray-300"
        >
          <CaretDown size={12} weight="bold" />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-surface-border dark:bg-surface-raised"
          >
            {availableApps.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => openApp(app, true)}
                className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors duration-100 hover:bg-gray-50 dark:hover:bg-surface-selected ${
                  app.id === defaultApp.id
                    ? "bg-gray-50 text-gray-900 dark:bg-surface-selected dark:text-gray-100"
                    : "text-gray-700 dark:text-gray-300"
                }`}
              >
                <ProjectAppIcon app={app} isDark={isDark} />
                <span className="truncate">{app.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
