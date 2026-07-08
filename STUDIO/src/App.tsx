import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { connectionManager } from "./services/connection";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { OfflineProvider } from "./contexts/OfflineContext";
import { SettingsProvider, useSettings } from "./contexts/SettingsContext";
import { ModelsProvider } from "@/features/models/context";
import { Toaster } from "sonner";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { HomePage } from "./pages/HomePage";
import { OverlayPage } from "./pages/OverlayPage";
import { ShaderWelcomePage } from "./pages/ShaderWelcomePage";
import { SplashPreviewPage } from "./pages/SplashPreviewPage";
import { AuthCallback } from "./pages/AuthCallback";
import { SplashScreen } from "./components/feedback/SplashScreen";
import { OfflineModal } from "./components/feedback/OfflineModal";
import { UpdateBanner } from "./components/feedback/UpdateBanner";
import { ContextMenu } from "./components/layout/ContextMenu";
import { unifiedStorage } from "./services/storage/unifiedStorageService";
import { globalErrorHandler } from "./services/errors/globalErrorHandler";
import { apiManager } from "./services/network/apiManager";
import { logger } from "./services/logging/logger";
import { environmentService } from "./services/platform/environmentService";
import { invoke } from "@tauri-apps/api/core";
import { useHarnessInit } from "./hooks/useHarnessInit";
import { HarnessPermissionModal } from "./components/ui/HarnessPermissionModal";
import { deployBundledLocalSkills } from "./services/skills/skillDeployer";
import { STARTUP_SPLASH_MIN_MS } from "./constants/splashTiming";
import { resolveTheme } from "./utils/theme";

function AppToaster() {
  const { settings } = useSettings();
  return <Toaster theme={resolveTheme(settings.theme)} position="top-center" richColors />;
}

// ── Overlay window detection ──────────────────────────────────────────────────
// Must happen at module scope (before any hook or effect) so the overlay window
// skips the full app initialisation entirely and stays lightweight.
const IS_OVERLAY_WINDOW =
  new URLSearchParams(window.location.search).get("w") === "overlay";

const IS_SPLASH_PREVIEW =
  new URLSearchParams(window.location.search).get("splashPreview") === "1";

type InitializationStep = 
  | 'starting'
  | 'secure-storage'
  | 'error-handler'
  | 'storage'
  | 'theme'
  | 'auth'
  | 'offline'
  | 'complete'
  | 'error';

function MainApp() {
  const [initStep, setInitStep] = useState<InitializationStep>('starting');
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRouterReady, setIsRouterReady] = useState(false);
  const [showStartupSplash, setShowStartupSplash] = useState(true);
  const startupStartedAtRef = useRef(performance.now());

  useEffect(() => {
    let mounted = true;

    const initializeApp = async () => {
      try {
        logger.info('App', 'Starting initialization');
        setInitStep('starting');
        
        // Step 0: Initialize Tauri secure storage (if Tauri)
        if (environmentService.isTauri()) {
          logger.debug('App', 'Initializing Tauri secure storage');
          setInitStep('secure-storage');
          try {
            await invoke('init_secure_storage');
            logger.debug('App', 'Tauri secure storage initialized successfully');
          } catch (error) {
            logger.warn('App', 'Failed to initialize Tauri secure storage', error);
            // Don't fail - continue with empty storage
          }
        }
        
        // Step 1: Initialize global error handler
        logger.debug('App', 'Initializing error handler');
        setInitStep('error-handler');
        globalErrorHandler.initialize();
        logger.debug('App', 'Error handler initialized successfully');
        
        // Step 1: Initialize storage
        logger.debug('App', 'Initializing storage');
        setInitStep('storage');
        await unifiedStorage.initialize();
        logger.debug('App', 'Storage initialized successfully');
        
        // Step 2: Theme initialization (minimal)
        logger.debug('App', 'Theme step');
        setInitStep('theme');
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to test
        
        // Step 3: Auth initialization (minimal)
        logger.debug('App', 'Auth step');
        setInitStep('auth');
        await new Promise(resolve => setTimeout(resolve, 100));

        // Step 3b: Deploy bundled local skills (first launch only — no-op on subsequent runs)
        if (environmentService.isTauri()) {
          logger.debug('App', 'Deploying bundled local skills');
          try {
            await deployBundledLocalSkills();
          } catch (e) {
            logger.warn('App', 'Skill deployment failed (non-fatal)', e);
          }
        }
        
        // Step 5: Offline initialization (minimal)
        logger.debug('App', 'Offline step');
        setInitStep('offline');
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Step 6: Complete
        logger.info('App', 'Initialization complete');
        setInitStep('complete');

        if (!mounted) return;
        setIsInitialized(true);

        // Tell Rust the frontend is ready so it can call set_focus() now.
        // Tauri calls set_focus() early in setup() before WebView2 has loaded,
        // so focus is lost by the time the user can interact. Calling app_ready
        // here re-grabs focus after React has fully rendered, fixing the
        // "first click doesn't trigger animation" bug.
        if (environmentService.isTauri()) {
          requestAnimationFrame(() => {
            invoke('app_ready').catch(() => {});
          });
        }

      } catch (error) {
        logger.error('App', `Initialization failed at step: ${initStep}`, error);
        setError(`Initialization failed at ${initStep}: ${error instanceof Error ? error.message : String(error)}`);
        setInitStep('error');
        if (mounted) {
          setIsInitialized(true);
          setShowStartupSplash(false);
        }
      }
    };

    initializeApp();

    return () => {
      mounted = false;
    };
    // init runs once on mount; initStep is read inside catch for error context only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isInitialized || !isRouterReady || error || !showStartupSplash) return;

    const elapsed = performance.now() - startupStartedAtRef.current;
    const remaining = Math.max(0, STARTUP_SPLASH_MIN_MS - elapsed);
    const splashTimer = window.setTimeout(() => {
      setShowStartupSplash(false);
    }, remaining);

    return () => window.clearTimeout(splashTimer);
  }, [error, isInitialized, isRouterReady, showStartupSplash]);

  const appContent = error ? (
    <div className="h-screen flex items-center justify-center bg-surface-page transition-colors duration-300">
      <div className="text-center p-8">
        <h1 className="text-2xl font-bold text-secondary mb-4">Initialization Error</h1>
        <p className="text-gray-700 dark:text-gray-300 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900 rounded hover:bg-gray-700 dark:hover:bg-gray-300"
        >
          Retry
        </button>
      </div>
    </div>
  ) : isInitialized ? (
    <ErrorBoundary>
      <SettingsProvider>
        <ModelsProvider>
        <AuthProvider>
          <OfflineProvider>
            <AppRouter onReady={() => setIsRouterReady(true)} />
            <OfflineModal />
            <UpdateBanner />
            <ContextMenu />
            <AppToaster />
          </OfflineProvider>
        </AuthProvider>
        </ModelsProvider>
      </SettingsProvider>
    </ErrorBoundary>
  ) : (
    <div className="h-screen bg-surface-page transition-colors duration-300" />
  );

  return (
    <>
      {appContent}

      <AnimatePresence>
        {showStartupSplash && !error && <SplashScreen key="startup-splash" />}
      </AnimatePresence>
    </>
  );
}

// Simple router component to handle authentication flow
function AppRouter({ onReady }: { onReady: () => void }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [checkingAPI, setCheckingAPI] = useState(true);
  const isWeb = environmentService.isWeb();
  const { showModal: showHarnessModal, handleAllow: allowHarness, handleDeny: denyHarness } = useHarnessInit();
  const isCallbackRoute = window.location.pathname === '/oauth/callback';

  // Toast when a background conversation finishes while viewing a different one.
  useEffect(() => {
    return connectionManager.on((event) => {
      if (event.type === "task:completed_unread") {
        toast.info("A conversation finished in the background", { duration: 4000 });
      }
    });
  }, []);

  // Check API configuration on mount
  useEffect(() => {
    const checkAPI = async () => {
      try {
        await apiManager.isConfigured();
      } catch (error) {
        logger.error('App', 'Failed to check API config', error);
      } finally {
        setCheckingAPI(false);
      }
    };

    checkAPI();
  }, []);

  useEffect(() => {
    if (isCallbackRoute || (!isLoading && !checkingAPI)) {
      onReady();
    }
  }, [checkingAPI, isCallbackRoute, isLoading, onReady]);
   
  // Handle OAuth callback route (mobile flow)
  if (isCallbackRoute) {
    return <AuthCallback />;
  }

  // Show loading during checks
  if (isLoading || checkingAPI) {
    return <div className="h-screen bg-surface-page transition-colors duration-300" />;
  }

  // Desktop (Tauri): Gate behind auth just like web
  if (!isWeb) {
    if (!isAuthenticated) {
      return <ShaderWelcomePage />;
    }
    return (
      <>
        <HomePage />
        <HarnessPermissionModal open={showHarnessModal} onAllow={allowHarness} onDeny={denyHarness} />
      </>
    );
  }

  // Web: Show simplified welcome page if not authenticated
  // For web, we need authentication due to security (can't store API keys in browser)
  if (!isAuthenticated) {
    return <ShaderWelcomePage />;
  }

  // Web: Show main app if authenticated
  return <HomePage />;
}

/**
 * App — top-level entry point.
 * No hooks here; just decides which tree to mount.
 */
function App() {
  let content;
  if (IS_SPLASH_PREVIEW) {
    content = <SplashPreviewPage />;
  } else if (IS_OVERLAY_WINDOW) {
    // Lightweight overlay window — skip all providers and initialisation
    content = <OverlayPage />;
  } else {
    content = <MainApp />;
  }

  // Honour prefers-reduced-motion for ALL framer-motion animations in one place
  // (the global CSS reduced-motion block only covers CSS transitions/keyframes).
  return <MotionConfig reducedMotion="user">{content}</MotionConfig>;
}

export default App;
