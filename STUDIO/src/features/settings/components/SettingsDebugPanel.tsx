import { useState, useEffect, useCallback } from "react";
import {
  BugIcon as Bug,
  FlaskIcon as Flask,
  FileArrowDownIcon as FileArrowDown,
  DownloadIcon as Download,
  Icon,
  Refresh,
  Warning,
  Close,
  Wifi,
  type PhosphorIcon,
} from "@/ui/icons";
import { IconButton } from "@/ui/primitives/IconButton";
import { Button } from "@/ui/primitives/Button";
import { useSettings } from "@/app/contexts/SettingsContext";
import { configService } from "@/core/storage/configService";
import { comprehensiveDiagnostics, type DiagnosticTest, type DiagnosticReport } from "@/core/errors/comprehensiveDiagnostics";
import { getSaltInfo } from "@/core/storage/secureStorage";
import { tokenManager } from "@/lib/tokenManager";
import { logger } from "@/core/logging/logger";
import { environmentService } from "@/core/platform/environmentService";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComponentStatus {
  status: "operational" | "degraded" | "down";
  message?: string;
  metadata?: Record<string, unknown>;
}

interface ApiHealthData {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  components: {
    api: ComponentStatus;
    engine: ComponentStatus;
    ai: ComponentStatus;
    database: ComponentStatus;
  };
  metrics: {
    jobs: { queued: number; running: number; completed: number; failed: number };
  };
}

// ── Neutral status dots (D-401 — no hue; active = strong, inactive = faint, error = Warning glyph) ──

type DotState = "operational" | "degraded" | "down" | "green" | "yellow" | "red";

const dot = (status: DotState) => {
  // D-401: healthy/operational/green = strong (primary) dot; degraded/yellow = faint (muted); down/red = faint + Warning glyph below.
  const isHealthy    = status === "operational" || status === "green";
  const isDegraded   = status === "degraded"    || status === "yellow";
  const isDown       = status === "down"        || status === "red";
  const color = isHealthy
    ? "bg-primary"
    : isDegraded
      ? "bg-muted"
      : isDown
        ? "bg-muted"
        : "bg-muted";
  return (
    <span className="inline-flex items-center gap-1">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
      {isDown && <Warning size="xs" weight="regular" className="text-primary" aria-hidden="true" />}
    </span>
  );
};

type TestStatus = "pass" | "fail" | "warning" | "skip" | "running" | "pending";

const statusDot = (status: TestStatus) => {
  // D-401: pass = strong; fail/warning = faint + Warning glyph; running = faint (animated spinner instead of blue);
  // skip/pending = faint.
  const isPass    = status === "pass";
  const isFail    = status === "fail";
  const isWarning = status === "warning";
  const color = isPass
    ? "bg-primary"
    : isFail || isWarning
      ? "bg-muted"
      : "bg-muted";
  return (
    <span className="inline-flex items-center">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
      {(isFail || isWarning) && (
        <Warning size="xs" weight="regular" className="ml-1 text-primary" aria-hidden="true" />
      )}
    </span>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

export const SettingsDebugPanel = () => {
  const { settings } = useSettings();
  const [showDebug, setShowDebug]           = useState(false);
  const [configLocation, setConfigLocation] = useState<string>("");
  const [appVersion, setAppVersion]         = useState<string>("—");

  // Storage / security
  const [storageBackend, setStorageBackend] = useState<string>("—");
  const [saltInfo, setSaltInfo]             = useState<{ exists: boolean; length: number; preview: string } | null>(null);
  const [tokenSecurityInfo, setTokenSecurityInfo] = useState<{
    platform: "tauri" | "web";
    storageType: string;
    encryptionEnabled: boolean;
    tokensPresent: { accessToken: boolean; refreshToken: boolean; userInfo: boolean };
  } | null>(null);

  // API health
  const [apiHealth, setApiHealth]           = useState<ApiHealthData | null>(null);
  const [apiHealthLoading, setApiHealthLoading] = useState(false);
  const [apiHealthError, setApiHealthError] = useState(false);

  // Diagnostics
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnosticsResults, setDiagnosticsResults] = useState<DiagnosticTest[]>([]);
  const [diagnosticsReport, setDiagnosticsReport]   = useState<DiagnosticReport | null>(null);
  const [currentTest, setCurrentTest]               = useState<string>("");

  // ── On mount / open ─────────────────────────────────────────────────────────

  useEffect(() => {
    loadVersion();
    detectStorageBackend();
    loadSaltInfo();
    loadTokenSecurityInfo();
  }, []);

  const loadVersion = async () => {
    try {
      if (environmentService.isTauri()) {
        const { getVersion } = await import("@tauri-apps/api/app");
        setAppVersion(await getVersion());
      }
    } catch {
      setAppVersion("—");
    }
  };

  const detectStorageBackend = async () => {
    try {
      const { unifiedStorage } = await import("@/core/storage/unifiedStorageService");
      await unifiedStorage.initialize();
      setStorageBackend((await unifiedStorage.isUsingTauriFS()) ? "Tauri FS" : "Web Storage");
    } catch {
      setStorageBackend("Error");
    }
  };

  const loadSaltInfo = async () => {
    try {
      setSaltInfo(await getSaltInfo());
    } catch {
      setSaltInfo({ exists: false, length: 0, preview: "Error" });
    }
  };

  const loadTokenSecurityInfo = async () => {
    try {
      setTokenSecurityInfo(await tokenManager.getStorageSecurityInfo());
    } catch {
      logger.error("DebugPanel", "Failed to load token security info");
    }
  };

  const loadConfigLocation = async () => {
    setConfigLocation(await configService.getLocation());
  };

  // ── API health ───────────────────────────────────────────────────────────────

  const refreshApiHealth = useCallback(async () => {
    setApiHealthLoading(true);
    setApiHealthError(false);
    try {
      const res = await fetch("https://api.pookiepied.dev/system/status");
      if (!res.ok) throw new Error(`${res.status}`);
      setApiHealth(await res.json() as ApiHealthData);
    } catch {
      setApiHealth(null);
      setApiHealthError(true);
    } finally {
      setApiHealthLoading(false);
    }
  }, []);

  // ── Diagnostics ──────────────────────────────────────────────────────────────

  const runDiagnostics = async () => {
    setDiagnosticsRunning(true);
    setDiagnosticsResults([]);
    setCurrentTest("");
    setDiagnosticsReport(null);
    try {
      const report = await comprehensiveDiagnostics.runDiagnostics((test) => {
        setCurrentTest(test.name);
        setDiagnosticsResults((prev) => {
          const idx = prev.findIndex((t) => t.id === test.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = test;
            return updated;
          }
          return [...prev, test];
        });
      });
      setDiagnosticsReport(report);
    } catch (error) {
      setDiagnosticsResults([{
        id: "error",
        name: "Diagnostic Error",
        category: "system",
        status: "fail",
        message: `Failed to run diagnostics: ${error instanceof Error ? error.message : String(error)}`,
      }]);
    } finally {
      setDiagnosticsRunning(false);
      setCurrentTest("");
    }
  };

  // ── Export / reset ───────────────────────────────────────────────────────────

  const handleExportSettings = async () => {
    try {
      const exported = await configService.export();
      const blob = new Blob([exported], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "STUDIO.conf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export settings");
    }
  };

  const handleExportDiagnostics = async () => {
    if (!diagnosticsReport) { alert("Run diagnostics first."); return; }
    try {
      const text = await comprehensiveDiagnostics.exportReport(diagnosticsReport);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `studio-diagnostics-${new Date().toISOString().split("T")[0]}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export diagnostic report");
    }
  };

  const handleResetSettings = async () => {
    if (!confirm("Reset all settings to defaults?")) return;
    try {
      await configService.reset();
      alert("Settings reset! Please restart the app.");
      window.location.reload();
    } catch {
      alert("Failed to reset settings");
    }
  };

  // ── Trigger button ───────────────────────────────────────────────────────────

  if (!showDebug) {
    return (
      <IconButton
        variant="outline"
        size="md"
        aria-label="Open developer tools"
        onClick={() => { setShowDebug(true); loadConfigLocation(); refreshApiHealth(); }}
        className="fixed bottom-6 right-6 z-popover shadow-sm hover:shadow-md"
      >
        <Icon icon={Bug as unknown as PhosphorIcon} size="md" weight="regular" />
      </IconButton>
    );
  }

  const passed   = diagnosticsResults.filter((r) => r.status === "pass").length;
  const failed   = diagnosticsResults.filter((r) => r.status === "fail").length;
  const warnings = diagnosticsResults.filter((r) => r.status === "warning").length;
  const skipped  = diagnosticsResults.filter((r) => r.status === "skip").length;

  // ── Panel ────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed bottom-6 right-6 w-80 bg-surface-base border border-surface-border rounded-lg shadow-xl overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-divider">
        <div className="flex items-center gap-2">
          <Icon icon={Bug as unknown as PhosphorIcon} size="sm" weight="regular" className="text-muted" />
          <h3 className="text-3xs font-semibold text-muted tracking-widest uppercase font-sans">
            Developer Tools
          </h3>
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label="Close developer tools"
          onClick={() => setShowDebug(false)}
        >
          <Close size="sm" weight="regular" />
        </IconButton>
      </div>

      {/* Scrollable body */}
      <div className="p-4 space-y-3 max-h-[320px] overflow-y-auto scrollbar-auto-hide text-xs">

        {/* ── App ─────────────────────────────────────────────────────────── */}
        <section className="space-y-1.5">
          <p className="text-3xs font-semibold text-disabled uppercase tracking-widest">App</p>

          <Row label="Version">
            <span className="font-mono text-primary">{appVersion}</span>
          </Row>
          <Row label="Environment">
            <span className="font-mono text-secondary">
              {environmentService.isTauri() ? "Tauri desktop" : "Web browser"}
            </span>
          </Row>
          <Row label="Storage">
            <div className="flex items-center gap-1.5">
              {dot(storageBackend === "Tauri FS" ? "green" : storageBackend === "Web Storage" ? "yellow" : "red")}
              <span className="text-secondary">{storageBackend}</span>
            </div>
          </Row>
        </section>

        {/* ── Service Health ───────────────────────────────────────────────── */}
        <section className="space-y-1.5 pt-2 border-t border-surface-divider">
          <div className="flex items-center justify-between">
            <p className="text-3xs font-semibold text-disabled uppercase tracking-widest">Service Health</p>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Refresh health"
              onClick={refreshApiHealth}
              disabled={apiHealthLoading}
            >
              <Refresh size="xs" weight="regular" className={apiHealthLoading ? "motion-safe:animate-spin" : ""} />
            </IconButton>
          </div>

          {apiHealthError && !apiHealth && (
            <p className="text-3xs text-primary flex items-center gap-1">
              <Warning size="xs" weight="regular" />
              Could not reach API
            </p>
          )}

          {apiHealth && (
            <>
              {/* Overall badge */}
              <div className="flex items-center gap-1.5 mb-0.5">
                {dot(
                  apiHealth.status === "healthy" ? "operational" :
                  apiHealth.status === "degraded" ? "degraded" : "down"
                )}
                <span className="text-3xs text-muted capitalize">{apiHealth.status}</span>
                <span className="text-3xs text-disabled ml-auto">
                  {new Date(apiHealth.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* Components */}
              {(["api", "ai", "engine", "database"] as const).map((key) => {
                const comp = apiHealth.components[key];
                return (
                  <Row key={key} label={key.charAt(0).toUpperCase() + key.slice(1)}>
                    <div className="flex items-center gap-1.5">
                      {dot(comp.status)}
                      <span className="text-secondary capitalize">{comp.status}</span>
                    </div>
                  </Row>
                );
              })}

              {/* Job metrics */}
              <div className="mt-1 px-2 py-1.5 bg-surface-raised rounded-lg space-y-0.5">
                <p className="text-3xs text-muted font-medium mb-1">Job Queue</p>
                {(["queued", "running", "completed", "failed"] as const).map((k) => (
                  <div key={k} className="flex justify-between text-3xs">
                    <span className="text-muted capitalize">{k}</span>
                    <span className="font-mono text-secondary">{apiHealth.metrics.jobs[k]}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {!apiHealth && !apiHealthError && (
            <div className="flex items-center gap-1.5 text-3xs text-muted">
              <Wifi size="xs" className="text-disabled" />
              <span>Checking…</span>
            </div>
          )}
        </section>

        {/* ── Security ─────────────────────────────────────────────────────── */}
        <section className="space-y-1.5 pt-2 border-t border-surface-divider">
          <p className="text-3xs font-semibold text-disabled uppercase tracking-widest">Security</p>

          <Row label="Encryption Salt">
            <div className="flex items-center gap-1.5">
              {dot(saltInfo?.exists ? "green" : "red")}
              <span className="font-mono text-3xs text-secondary">
                {saltInfo?.exists ? `${saltInfo.length}B (${saltInfo.preview})` : "Missing"}
              </span>
            </div>
          </Row>

          {tokenSecurityInfo && (
            <>
              <Row label="Token Platform">
                <span className="font-mono text-secondary">{tokenSecurityInfo.platform}</span>
              </Row>
              <Row label="Token Storage">
                <div className="flex items-center gap-1.5">
                  {dot(tokenSecurityInfo.encryptionEnabled ? "green" : "red")}
                  <span className="font-mono text-3xs text-secondary">{tokenSecurityInfo.storageType}</span>
                </div>
              </Row>
              <Row label="Tokens Present">
                <span className="font-mono text-secondary">
                  {Object.values(tokenSecurityInfo.tokensPresent).filter(Boolean).length}/3
                </span>
              </Row>
            </>
          )}
        </section>

        {/* ── Configuration ────────────────────────────────────────────────── */}
        <section className="space-y-1.5 pt-2 border-t border-surface-divider">
          <p className="text-3xs font-semibold text-disabled uppercase tracking-widest">Configuration</p>

          <div>
            <p className="text-muted mb-0.5">Config path</p>
            <p className="font-mono text-3xs text-secondary break-all leading-relaxed">
              {configLocation || "Loading…"}
            </p>
          </div>

          <div className="space-y-0.5">
            <p className="text-muted mb-0.5">Active models</p>
            <Row label="Transcription">
              <span className="font-mono text-3xs text-secondary truncate max-w-[120px]">
                {settings.transcriptionModel.split(":")[1] ?? settings.transcriptionModel}
              </span>
            </Row>
            <Row label="Rephrase">
              <span className="font-mono text-3xs text-secondary truncate max-w-[120px]">
                {settings.rephraseModel.split(":")[1] ?? settings.rephraseModel}
              </span>
            </Row>
            <Row label="Chat">
              <span className="font-mono text-3xs text-secondary truncate max-w-[120px]">
                {settings.defaultChatModel.split(":")[1] ?? settings.defaultChatModel}
              </span>
            </Row>
          </div>
        </section>

        {/* ── Diagnostics results ──────────────────────────────────────────── */}
        {(diagnosticsRunning || diagnosticsResults.length > 0) && (
          <section className="space-y-1.5 pt-2 border-t border-surface-divider">
            <div className="flex items-center justify-between">
              <p className="text-3xs font-semibold text-disabled uppercase tracking-widest">Diagnostics</p>
              {diagnosticsResults.length > 0 && (
                <span className="text-3xs text-muted">
                  {passed}P · {failed}F · {warnings}W · {skipped}S
                </span>
              )}
            </div>

            {diagnosticsRunning && currentTest && (
              <p className="text-3xs text-primary font-mono truncate">{currentTest}</p>
            )}

            <div className="space-y-1 max-h-36 overflow-y-auto scrollbar-auto-hide">
              {diagnosticsResults.map((result, i) => (
                <div key={result.id ?? i} className="flex items-start gap-1.5 text-3xs">
                  <div className="mt-0.5">{statusDot(result.status)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-secondary truncate">{result.name}</p>
                    {result.status !== "pass" && result.status !== "running" && result.message && (
                      <p className="text-muted truncate">{result.message}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-4 py-3 border-t border-surface-divider">
        <Button
          variant="outline"
          size="sm"
          onClick={runDiagnostics}
          disabled={diagnosticsRunning}
          className="flex-1"
        >
          <Icon icon={Flask as unknown as PhosphorIcon} size="sm" weight="regular" />
          {diagnosticsRunning ? "Running…" : "Diagnose"}
        </Button>
        <IconButton
          variant="outline"
          size="sm"
          aria-label="Export core/config"
          onClick={handleExportSettings}
        >
          <Icon icon={FileArrowDown as unknown as PhosphorIcon} size="sm" weight="regular" />
        </IconButton>
        <IconButton
          variant="outline"
          size="sm"
          aria-label="Export diagnostics"
          onClick={handleExportDiagnostics}
          disabled={!diagnosticsReport}
        >
          <Icon icon={Download as unknown as PhosphorIcon} size="sm" weight="regular" />
        </IconButton>
        <IconButton
          variant="outline"
          size="sm"
          aria-label="Reset to defaults"
          onClick={handleResetSettings}
        >
          <Refresh size="sm" weight="regular" />
        </IconButton>
      </div>
    </div>
  );
};

// ── Layout helper ─────────────────────────────────────────────────────────────

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3 text-3xs">
    <span className="text-muted flex-shrink-0">{label}</span>
    <span className="flex items-center gap-1 min-w-0">{children}</span>
  </div>
);
