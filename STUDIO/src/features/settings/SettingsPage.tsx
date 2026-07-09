import { useState } from "react";
import {
  MicrophoneIcon       as Microphone,
  BrainIcon             as Brain,
  DesktopIcon           as Desktop,
  UserIcon,
  SquaresFourIcon       as SquaresFour,
  CpuIcon               as Cpu,
  KeyboardIcon          as Keyboard,
  SignOutIcon           as SignOut,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { SearchInput } from "@/components/ui/SearchInput";
import { Icon, Back, Manage } from "@/components/icons";
import { environmentService } from "@/core/platform/environmentService";
import {
  HARNESS_PERMISSION_KEY,
  COMPUTER_USE_PERMISSION_KEY,
  LOCAL_MCP_SERVERS,
  startLocalMcp,
  stopLocalMcp,
  setLocalMcpPermission,
  type LocalMcpServerDef,
} from "@/runtime";
import { useNavigation } from "@/contexts/NavigationContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useFeatures } from "@/hooks/useFeatures";
import { useDebounce } from "@/hooks/useDebounce";
import { useModelsContext as useModels } from "@/features/models/context";
import { AuthControls } from "@/components/AuthControls";
import { AppSettings, ThemePreference } from "@/types";
import { logger } from "@/core/logging/logger";
import { AutostartService } from "@/core/platform/autostartService";
import { resolveTheme } from "@/utils/theme";

import {
  NavTile,
  SectionLabel,
  IntelligenceView,
  AudioView,
  InterfaceView,
  LocalServicesView,
  ShortcutsView,
  SettingsDebugPanel,
} from "./components";

// ---------------------------------------------------------------------------
// Types + animation constants
// ---------------------------------------------------------------------------

type SettingsView = "main" | "ai_models" | "audio" | "interface" | "shortcuts" | "local_services";

const pageAnim = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit:    { opacity: 0, x: 20 },
  transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] },
  className: "space-y-10",
} as const;

const mainAnim = {
  ...pageAnim,
  initial: { opacity: 0, x: -20 },
  exit:    { opacity: 0, x: -20 },
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SettingsPage = () => {
  const { updateSettings } = useSettings();
  const { isEnabled } = useFeatures();
  const { user, isAuthenticated, logout } = useAuth();
  const { navigateTo } = useNavigation();
  const { providers, loading: modelsLoading, uniqueModels } = useModels();

  const [showSavedIndicator, setShowSavedIndicator] = useState(false);
  const [viewStack, setViewStack] = useState<SettingsView[]>(["main"]);
  const [searchQuery, setSearchQuery] = useState("");
  const isTauri = environmentService.isTauri();
  const [studioHarnessEnabled, setStudioHarnessEnabled] = useState(
    () => localStorage.getItem(HARNESS_PERMISSION_KEY) === "granted"
  );
  const [studioHarnessToggling, setStudioHarnessToggling] = useState(false);
  const [computerUseEnabled, setComputerUseEnabled] = useState(
    () => localStorage.getItem(COMPUTER_USE_PERMISSION_KEY) === "granted"
  );
  const [computerUseToggling, setComputerUseToggling] = useState(false);

  const currentView = viewStack[viewStack.length - 1];
  const prevView    = viewStack[viewStack.length - 2] ?? "main";

  const navigateToView = (view: SettingsView) => setViewStack((s) => [...s, view]);
  const goBack = () => setViewStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  // ── Debounced save + saved indicator ──────────────────────────────────────

  const debouncedSave = useDebounce(async (key: keyof AppSettings, value: any) => {
    try {
      await updateSettings({ [key]: value });
      if (key === "startOnBoot" && isEnabled("autostart")) {
        try { await AutostartService.toggle(value as boolean); } catch (err) {
          logger.warn("Settings", "Failed to toggle autostart", err);
        }
      }
      setShowSavedIndicator(true);
      setTimeout(() => setShowSavedIndicator(false), 2000);
    } catch (err) {
      logger.error("Settings", "Failed to save settings", err);
    }
  }, 500);

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    debouncedSave(key, value);
  };

  // ── Theme change (needs DOM side-effect) ──────────────────────────────────

  const handleThemeChange = async (theme: ThemePreference) => {
    const resolvedTheme = resolveTheme(theme);
    document.documentElement.classList.add("theme-transitioning");
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    window.setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 320);
    try { localStorage.setItem("studio-theme", theme); } catch (_) { /* best-effort: storage may be unavailable in private mode / over quota */ }
    await updateSettings({ theme });
  };

  // ── Local MCP toggles (Studio Harness + Computer Use, independent) ─────────

  const toggleLocalMcp = async (
    server: LocalMcpServerDef,
    enable: boolean,
    setEnabled: (v: boolean) => void,
    setToggling: (v: boolean) => void
  ): Promise<void> => {
    if (!isTauri || setToggling === undefined) return;
    setToggling(true);
    try {
      if (enable) {
        await startLocalMcp(server);
        setLocalMcpPermission(server, true);
        setEnabled(true);
      } else {
        await stopLocalMcp(server.name);
        setLocalMcpPermission(server, false);
        setEnabled(false);
      }
    } catch { /* non-fatal */ } finally {
      setToggling(false);
    }
  };

  const handleStudioHarnessToggle = (enable: boolean) =>
    toggleLocalMcp(LOCAL_MCP_SERVERS[0], enable, setStudioHarnessEnabled, setStudioHarnessToggling);

  const handleComputerUseToggle = (enable: boolean) =>
    toggleLocalMcp(LOCAL_MCP_SERVERS[1], enable, setComputerUseEnabled, setComputerUseToggling);

  // ── Render helpers (shared across main + search views) ───────────────────

  const renderBackNav = (label = "Settings") => (
    <Button
      variant="ghost"
      size="sm"
      onClick={goBack}
      leftIcon={<Back size="sm" weight="regular" />}
      className="mb-6 -ml-0.5"
    >
      {label}
    </Button>
  );

  const renderSearchBar = (autoFocus = false) => (
    <div className="mt-8">
      <SearchInput
        value={searchQuery}
        onValueChange={setSearchQuery}
        placeholder="Search settings..."
        autoFocus={autoFocus}
        aria-label="Search settings"
      />
    </div>
  );

  const renderAccountBlock = () =>
    isAuthenticated && user ? (
      <div className="flex items-center gap-3">
        {user.picture ? (
          <img src={user.picture} alt={user.name} className="w-9 h-9 rounded-full flex-shrink-0" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-surface-raised flex items-center justify-center flex-shrink-0">
            <UserIcon size={18} weight="regular" className="text-muted" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-primary truncate">{user.name}</p>
          <p className="text-xs text-muted truncate">{user.email}</p>
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label="Sign out"
          onClick={logout}
          className="flex-shrink-0"
        >
          <Icon icon={SignOut as unknown as PhosphorIcon} size="sm" weight="regular" />
        </IconButton>
      </div>
    ) : (
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-surface-raised flex items-center justify-center flex-shrink-0">
          <UserIcon size={18} weight="regular" className="text-muted" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-muted">Not signed in</p>
          <p className="text-xs text-muted mt-0.5">Sign in to sync your data</p>
        </div>
        <AuthControls />
      </div>
    );

  // ── Search results view ───────────────────────────────────────────────────

  const renderSearchView = () => {
    const q = searchQuery.toLowerCase();
    const has = (...terms: string[]) => terms.some((t) => t.toLowerCase().includes(q));

    const showAccount    = has("account", "profile", "email", "sign out", "logout");
    const showAiModels   = has("ai", "models", "providers", "chat", "rephrase model", "transcription model", "tts", "text-to-speech", "openrouter", "groq", "openai", "image generation", "video generation", "image model", "video model", "flux", "veo");
    const showAudio      = has("audio", "microphone", "vad", "voice activity", "silence", "auto-rephrase", "rephrase tone", "tone", "transcription pipeline");
    const showLocalAi    = has("local ai", "local services", "ollama", "lm studio", "faster whisper", "engine", "local system", "harness", "system integration", "files", "terminal");
    const showInterface  = has("interface", "behavior", "appearance", "theme", "light", "dark", "notifications", "tray", "minimize", "boot", "autostart");
    const showShortcuts  = has("hotkey", "shortcut", "recording", "keyboard", "voice hotkey", "pulse", "overlay", "volume");
    const showExtensions = has("extensions", "mcp", "apps", "integrations", "tools");
    const showAdmin      = has("manage", "admin", "whitelist", "router", "modes");

    if (!showAccount && !showAiModels && !showAudio && !showLocalAi && !showInterface && !showShortcuts && !showExtensions && !showAdmin) {
      return (
        <div className="text-center py-12 text-muted text-sm">
          No settings found matching &ldquo;{searchQuery}&rdquo;
        </div>
      );
    }

    return (
      <div className="space-y-10">
        {showAccount && (
          <section className="space-y-4">
            <SectionLabel icon={<UserIcon size={16} weight="regular" />} title="ACCOUNT" />
            {renderAccountBlock()}
          </section>
        )}
        {showAiModels && (
          <section className="space-y-6">
            <SectionLabel icon={<Brain size={16} weight="regular" />} title="MODELS" />
            <IntelligenceView updateSetting={updateSetting} onNavigateToLocalServices={() => { setSearchQuery(""); navigateToView("local_services"); }} />
          </section>
        )}
        {showAudio && (
          <section className="space-y-4">
            <SectionLabel icon={<Microphone size={16} weight="regular" />} title="AUDIO" />
            <AudioView updateSetting={updateSetting} />
          </section>
        )}
        {showLocalAi && (
          <section className="space-y-4">
            <SectionLabel icon={<Cpu size={16} weight="regular" />} title="LOCAL AI" />
            <LocalServicesView
              updateSetting={updateSetting}
              isTauri={isTauri}
              studioHarness={{ enabled: studioHarnessEnabled, toggling: studioHarnessToggling }}
              computerUse={{ enabled: computerUseEnabled, toggling: computerUseToggling }}
              onStudioHarnessToggle={handleStudioHarnessToggle}
              onComputerUseToggle={handleComputerUseToggle}
            />
          </section>
        )}
        {showInterface && (
          <section className="space-y-4">
            <SectionLabel icon={<Desktop size={16} weight="regular" />} title="APPEARANCE" />
            <InterfaceView updateSetting={updateSetting} onThemeChange={handleThemeChange} />
          </section>
        )}
        {showShortcuts && (
          <section className="space-y-4">
            <SectionLabel icon={<Keyboard size={16} weight="regular" />} title="SHORTCUTS & PULSE" />
            <ShortcutsView updateSetting={updateSetting} />
          </section>
        )}
        {showExtensions && (
          <section className="space-y-4">
            <SectionLabel icon={<SquaresFour size={16} weight="regular" />} title="APPS" />
            <NavTile
              icon={<SquaresFour size={14} weight="regular" />}
              title="Apps"
              subtitle="Connect apps and tools to your AI"
              onClick={() => navigateTo("extensions")}
            />
          </section>
        )}
        {showAdmin && (
          <section className="space-y-4">
            <SectionLabel icon={<Manage size="md" weight="regular" />} title="ADMIN" />
            <NavTile
              icon={<Manage size="sm" weight="regular" />}
              title="Manage"
              subtitle="Whitelist, admin modes, and router defaults"
              onClick={() => navigateTo("manage")}
            />
          </section>
        )}
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────

  const settingsHeader = (
    <div>
      <h1 className="text-base font-display tracking-ultra-wide text-primary mb-1">
        SETTINGS
      </h1>
      <p className="text-sm text-muted">
        Configure your STUDIO experience
      </p>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto scrollbar-auto-hide px-4 py-6 sm:px-8 sm:py-10 md:p-12 relative bg-surface-page">
      {/* Saved indicator */}
      <AnimatePresence>
        {showSavedIndicator && (
          <motion.div
            initial={{ opacity: 0, y: -24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-popover px-4 py-2 bg-surface-base border border-surface-border text-primary text-sm rounded-xl shadow-lg pointer-events-none"
          >
            Settings saved
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-3xl mx-auto">
        <AnimatePresence mode="wait">

          {/* SEARCH RESULTS */}
          {searchQuery ? (
            <motion.div key="search" {...pageAnim}>
              {settingsHeader}
              {renderSearchBar(true)}
              <div className="mt-10">{renderSearchView()}</div>
            </motion.div>

          ) : currentView === "main" ? (
            /* MAIN */
            <motion.div key="main" {...mainAnim}>
              {settingsHeader}
              {renderSearchBar()}

              <section>{renderAccountBlock()}</section>

              <section className="space-y-1">
                <NavTile
                  icon={<Brain size={16} weight="regular" />}
                  title="AI Models"
                  subtitle={modelsLoading ? "Loading…" : `${Object.keys(providers).length} providers · ${uniqueModels} models`}
                  onClick={() => navigateToView("ai_models")}
                />
                <NavTile
                  icon={<Microphone size={16} weight="regular" />}
                  title="Voice & Audio"
                  subtitle="Microphone, voice detection, transcription pipeline"
                  onClick={() => navigateToView("audio")}
                />
                <NavTile
                  icon={<Desktop size={16} weight="regular" />}
                  title="Appearance"
                  subtitle="Theme, notifications, tray, and startup"
                  onClick={() => navigateToView("interface")}
                />
                <NavTile
                  icon={<Keyboard size={16} weight="regular" />}
                  title="Shortcuts & Pulse"
                  subtitle="Hotkeys, voice volume, and floating overlay"
                  onClick={() => navigateToView("shortcuts")}
                />
                <NavTile
                  icon={<Cpu size={16} weight="regular" />}
                  title="Local AI"
                  subtitle="Ollama, LM Studio, Faster Whisper, system access"
                  onClick={() => navigateToView("local_services")}
                />
                <NavTile
                  icon={<SquaresFour size={16} weight="regular" />}
                  title="Apps & Extensions"
                  subtitle="Connect apps and tools to your AI"
                  onClick={() => navigateTo("extensions")}
                />
                <NavTile
                  icon={<Manage size="md" weight="regular" />}
                  title="Manage"
                  subtitle="Admin whitelist, modes, and router controls"
                  onClick={() => navigateTo("manage")}
                />
              </section>
            </motion.div>

          ) : currentView === "ai_models" ? (
            /* AI MODELS */
            <motion.div key="ai_models" {...pageAnim}>
              {renderBackNav()}
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h1 className="text-base font-display tracking-ultra-wide text-primary mb-1">
                    AI MODELS
                  </h1>
                  <p className="text-sm text-muted">
                    Providers, model selection, and local AI services
                  </p>
                </div>
              </div>
              <IntelligenceView updateSetting={updateSetting} onNavigateToLocalServices={() => navigateToView("local_services")} />
            </motion.div>

          ) : currentView === "audio" ? (
            /* VOICE & AUDIO */
            <motion.div key="audio" {...pageAnim}>
              {renderBackNav()}
              <h1 className="text-base font-display tracking-ultra-wide text-primary mb-1">VOICE & AUDIO</h1>
              <p className="text-sm text-muted mb-8">
                Microphone, voice detection, and transcription pipeline
              </p>
              <AudioView updateSetting={updateSetting} />
            </motion.div>

          ) : currentView === "interface" ? (
            /* APPEARANCE */
            <motion.div key="interface" {...pageAnim}>
              {renderBackNav()}
              <h1 className="text-base font-display tracking-ultra-wide text-primary mb-1">APPEARANCE</h1>
              <p className="text-sm text-muted mb-8">
                Theme, notifications, system tray, and startup behavior
              </p>
              <InterfaceView updateSetting={updateSetting} onThemeChange={handleThemeChange} />
            </motion.div>

          ) : currentView === "shortcuts" ? (
            /* SHORTCUTS & PULSE */
            <motion.div key="shortcuts" {...pageAnim}>
              {renderBackNav()}
              <h1 className="text-base font-display tracking-ultra-wide text-primary mb-1">SHORTCUTS & PULSE</h1>
              <p className="text-sm text-muted mb-8">
                Global hotkeys, voice volume, and floating AI status overlay
              </p>
              <ShortcutsView updateSetting={updateSetting} />
            </motion.div>

          ) : (
            /* LOCAL AI */
            <motion.div key="local_services" {...pageAnim}>
              {renderBackNav(prevView === "ai_models" ? "AI Models" : "Settings")}
              <div className="mb-8">
                <h1 className="text-base font-display tracking-ultra-wide text-primary mb-1">LOCAL AI</h1>
                <p className="text-sm text-muted">
                  Local model providers, transcription engines, and system integration
                </p>
              </div>
              <LocalServicesView
                updateSetting={updateSetting}
                isTauri={isTauri}
                studioHarness={{ enabled: studioHarnessEnabled, toggling: studioHarnessToggling }}
                computerUse={{ enabled: computerUseEnabled, toggling: computerUseToggling }}
                onStudioHarnessToggle={handleStudioHarnessToggle}
                onComputerUseToggle={handleComputerUseToggle}
              />
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <SettingsDebugPanel />
    </div>
  );
};
