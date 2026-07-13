import { GoogleLoginButton } from "@/features/auth/components/GoogleLoginButton";
import { toast } from "sonner";
import { apiManager } from "@/core/network/apiManager";
import { logger } from "@/core/logging/logger";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { environmentService } from "@/core/platform/environmentService";
import {
  Close,
  Remove,
  Moon,
  Sun,
} from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { HERO_GRADIENT } from "@/design/constants";

const SESSION_AUTH_ERROR_KEY = "studio_auth_error";

// ── Easter-egg context menu ────────────────────────────────────────────────────

function LoginContextMenu({
  pos,
  onClose,
}: {
  pos: { x: number; y: number };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDark, setIsDark] = useState(
    document.documentElement.classList.contains("dark")
  );

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("studio-theme", next ? "dark" : "light"); } catch {
      /* ignore storage failures */
    }
    setIsDark(next);
    onClose();
  };

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.13, ease: "easeOut" }}
      style={{ top: pos.y, left: pos.x }}
      className="fixed z-context w-52 p-1.5
        bg-white/96 dark:bg-surface-page/96 backdrop-blur-2xl
        border border-gray-100 dark:border-white/[0.06]
        rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.12)]
        dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]
        overflow-hidden font-sans select-none"
    >
      {/* Branding header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 mb-0.5">
        <img src="/logo.png" alt="" className="w-4 h-4 object-contain opacity-70" />
        <div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 leading-none">
            STUDIO
          </p>
          <p className="text-2xs text-gray-400 dark:text-gray-600 mt-0.5">
            v 0.1.4
          </p>
        </div>
      </div>

      <div className="h-px bg-gray-100 dark:bg-white/[0.06] mx-1.5 mb-1" />

      {/* Theme toggle */}
      <Button
        onClick={toggleTheme}
        variant="ghost"
        className="h-auto w-full justify-start gap-2.5 px-3 py-2 rounded-lg
          text-sm font-medium text-gray-700 dark:text-gray-300
          hover:bg-gray-100/80 dark:hover:bg-white/[0.06]
          hover:text-gray-700 dark:hover:text-gray-300"
      >
        {isDark
          ? <Sun size="sm" className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
          : <Moon size="sm" className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
        }
        {isDark ? "Switch to light" : "Switch to dark"}
      </Button>

      <div className="h-px bg-gray-100 dark:bg-white/[0.06] mx-1.5 my-1" />

      {/* Ambient tagline */}
      <div className="px-3 py-2">
        <p className="text-xs text-gray-400/70 dark:text-gray-600 italic leading-relaxed">
          "Crafted for the obsessive."
        </p>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export const ShaderWelcomePage = () => {
  const [checkingAPI, setCheckingAPI] = useState(true);
  const [apiConfigured, setApiConfigured] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const isTauri = environmentService.isTauri();

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_AUTH_ERROR_KEY);
    if (stored) {
      sessionStorage.removeItem(SESSION_AUTH_ERROR_KEY);
      toast.error(stored, { duration: 6000 });
    }
  }, []);

  // Intercept global context menu — replace with Easter-egg menu on login page
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // prevents the global ContextMenu from also firing
      const menuW = 208, menuH = 160;
      setCtxMenu({
        x: Math.min(e.clientX, window.innerWidth  - menuW - 8),
        y: Math.min(e.clientY, window.innerHeight - menuH - 8),
      });
    };
    // capture: true fires before bubbling listeners (including global ContextMenu)
    window.addEventListener("contextmenu", handler, { capture: true });
    return () => window.removeEventListener("contextmenu", handler, { capture: true });
  }, []);

  useEffect(() => {
    apiManager.isConfigured()
      .then(setApiConfigured)
      .catch(() => {})
      .finally(() => setCheckingAPI(false));
  }, []);

  const handleLoginSuccess = () => logger.info("ShaderWelcome", "Login successful");

  const handleLoginError = (error: string) => {
    logger.error("ShaderWelcome", "Login error:", error);
    try { sessionStorage.setItem(SESSION_AUTH_ERROR_KEY, error); } catch { /* unavailable */ }
    toast.error(error, { duration: 6000 });
  };

  const handleMinimize = async () => {
    if (!isTauri) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch { /* noop */ }
  };

  const handleClose = async () => {
    if (!isTauri) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch { /* noop */ }
  };

  if (checkingAPI) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-surface-page">
        <div className="w-4 h-4 border-2 border-gray-300 dark:border-surface-border border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    /* Tight outer padding — panel nearly fills the whole window */
    <div className="h-screen w-full bg-white dark:bg-surface-page flex flex-col p-3 overflow-hidden">
      <AnimatePresence>
        {ctxMenu && (
          <LoginContextMenu pos={ctxMenu} onClose={closeCtxMenu} />
        )}
      </AnimatePresence>

      {/* ── Nav — sits above the panel, not inside it ───────────────────────── */}
      <motion.nav
        data-tauri-drag-region={isTauri ? "" : undefined}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
        className="flex items-center justify-between mb-2.5 select-none flex-shrink-0 px-1"
      >
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="STUDIO" className="w-6 h-6 object-contain" />
          <span className="font-display text-2xs tracking-ultra-wide text-gray-900 dark:text-primary">
            STUDIO
          </span>
        </div>

        {isTauri && (
          <div className="flex items-center gap-0.5">
            <IconButton
              aria-label="Minimize"
              onClick={handleMinimize}
              className="h-auto w-auto p-1.5 rounded-md text-gray-400 dark:text-secondary hover:text-gray-700 dark:hover:text-muted hover:bg-gray-900/[0.06] dark:hover:bg-white/[0.06]"
            >
              <Remove size="sm" />
            </IconButton>
            <IconButton
              aria-label="Close"
              onClick={handleClose}
              className="h-auto w-auto p-1.5 rounded-md text-gray-400 dark:text-secondary hover:text-secondary hover:bg-surface-raised/10"
            >
              <Close size="sm" />
            </IconButton>
          </div>
        )}
      </motion.nav>

      {/* ── Hero panel — full width, fills remaining height ─────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.65, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="w-full flex-1 relative rounded-2xl overflow-hidden border border-white/25"
        style={{ background: HERO_GRADIENT }}
      >

        {/* Dot grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.045]"
          style={{
            backgroundImage: `radial-gradient(circle, rgba(0,0,0,0.65) 1px, transparent 1px)`,
            backgroundSize: "22px 22px",
          }}
        />

        {/* Rising floor glow */}
        <div
          className="absolute bottom-0 inset-x-0 h-[55%] pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 85% 60% at 50% 100%, rgba(255,255,255,0.45) 0%, transparent 70%)",
          }}
        />

        {/* Top-edge sheen */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent" />

        {/* Content — centered */}
        <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-8">

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.28, ease: [0.4, 0, 0.2, 1] }}
            // fluid responsive clamp() — can't map to static scale token; intentional one-off for shader hero
            // eslint-disable-next-line no-restricted-syntax
            className="font-display text-[clamp(3.2rem,6.5vw,5.5rem)] text-black
              leading-[1.04] tracking-[-0.02em] mb-6 max-w-2xl"
          >
            Your AI workspace,<br />beautifully<br />organized.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.4, ease: [0.4, 0, 0.2, 1] }}
            className="text-base text-black/55 max-w-xs leading-relaxed mb-10"
          >
            Chat, transcribe, remember — everything your AI needs, in one place.
          </motion.p>

          {!apiConfigured && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.48 }}
              className="mb-6 px-4 py-3 rounded-xl w-full max-w-xs text-left
                bg-surface-raised dark:bg-surface-raised/20
                border border-surface-border dark:border-surface-border/40"
            >
              <p className="text-xs text-secondary dark:text-secondary">
                <strong>Config missing.</strong>{" "}
                Set <code className="bg-surface-raised dark:bg-surface-raised/40 px-1 rounded">VITE_API_BASE_URL</code> and{" "}
                <code className="bg-surface-raised dark:bg-surface-raised/40 px-1 rounded">VITE_GOOGLE_CLIENT_ID</code>{" "}
                in <code className="bg-surface-raised dark:bg-surface-raised/40 px-1 rounded">.env.local</code>.
              </p>
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5, ease: [0.4, 0, 0.2, 1] }}
            className="w-full max-w-[240px]"
          >
            <GoogleLoginButton
              onSuccess={handleLoginSuccess}
              onError={handleLoginError}
            />
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.65 }}
            className="mt-3.5 text-xs text-black/35 leading-relaxed"
          >
            By signing in you agree to our terms and privacy policy.
          </motion.p>

        </div>
      </motion.div>

    </div>
  );
};
