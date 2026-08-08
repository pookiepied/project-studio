import { Toaster } from "sonner";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { AuthProvider } from "@/features/auth/context/AuthContext";
import { OfflineProvider } from "@/app/contexts/OfflineContext";
import { SettingsProvider, useSettings } from "@/app/contexts/SettingsContext";
import { ModelsProvider } from "@/features/models/context";
import { TTSProvider } from "@/features/voice/context/TTSContext";
import { ReadAloudMiniPlayer } from "@/features/voice/components/ReadAloudMiniPlayer";
import { OfflineModal } from "@/app/globals/OfflineModal";
import { UpdateBanner } from "@/app/globals/UpdateBanner";
import { ContextMenu } from "@/app/globals/ContextMenu";
import { resolveTheme } from "@/lib/theme";
import { AppRouter } from "./AppRouter";

function AppToaster() {
  const { settings } = useSettings();
  return <Toaster theme={resolveTheme(settings.theme)} position="top-center" richColors />;
}

/**
 * AppProviders — the provider/error-boundary stack wrapping the router.
 * Renders ErrorBoundary > SettingsProvider > ModelsProvider > AuthProvider >
 * OfflineProvider > TTSProvider, plus the router and global chrome (modals,
 * toaster, menus, and the read-aloud mini player).
 */
export function AppProviders({ onRouterReady }: { onRouterReady: () => void }) {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <ModelsProvider>
          <AuthProvider>
            <OfflineProvider>
              <TTSProvider>
                <AppRouter onReady={onRouterReady} />
                <ReadAloudMiniPlayer />
                <OfflineModal />
                <UpdateBanner />
                <ContextMenu />
                <AppToaster />
              </TTSProvider>
            </OfflineProvider>
          </AuthProvider>
        </ModelsProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}
