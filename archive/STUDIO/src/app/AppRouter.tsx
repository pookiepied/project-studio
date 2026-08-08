import { useState, useEffect } from "react";
import { toast } from "sonner";
import { connectionManager } from "@/core/connection";
import { useAuth } from "@/features/auth/context/AuthContext";
import { HomePage } from "@/app/routes/HomePage";
import { ShaderWelcomePage } from "@/app/routes/ShaderWelcomePage";
import { AuthCallback } from "@/app/routes/AuthCallback";
import { apiManager } from "@/core/network/apiManager";
import { environmentService } from "@/core/platform/environmentService";
import { logger } from "@/core/logging/logger";
import { useRuntimeInit } from "@/runtime";
import { LocalCapabilitiesModal } from "@/features/permissions";

// Simple router component to handle authentication flow
export function AppRouter({ onReady }: { onReady: () => void }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [checkingAPI, setCheckingAPI] = useState(true);
  const isWeb = environmentService.isWeb();
  const { showModal: showHarnessModal, handleAllow: allowHarness, handleDeny: denyHarness } = useRuntimeInit();
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
        logger.error('App', 'Failed to check API core/config', error);
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
        <LocalCapabilitiesModal open={showHarnessModal} onAllow={allowHarness} onDeny={denyHarness} />
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
