import { Toaster } from "sonner";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { AuthProvider } from "@/features/auth/context/AuthContext";
import { OfflineProvider } from "@/app/contexts/OfflineContext";
import { SettingsProvider, useSettings } from "@/app/contexts/SettingsContext";
import { ModelsProvider } from "@/features/models/context";
import { OfflineModal } from "@/ui/feedback/OfflineModal";
import { UpdateBanner } from "@/ui/feedback/UpdateBanner";
import { ContextMenu } from "@/ui/layout/ContextMenu";
import { resolveTheme } from "@/lib/theme";
import { AppRouter } from "./AppRouter";

function AppToaster() {
  const { settings } = useSettings();
  return <Toaster theme={resolveTheme(settings.theme)} position="top-center" richColors />;
}

/**
 * AppProviders — the provider/error-boundary stack wrapping the router.
 * Renders ErrorBoundary > SettingsProvider > ModelsProvider > AuthProvider >
 * OfflineProvider, plus the router and global chrome (modals, toaster, menus).
 */
export function AppProviders({ onRouterReady }: { onRouterReady: () => void }) {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <ModelsProvider>
          <AuthProvider>
            <OfflineProvider>
              <AppRouter onReady={onRouterReady} />
              <OfflineModal />
              <UpdateBanner />
              <ContextMenu />
              <AppToaster />
            </OfflineProvider>
          </AuthProvider>
        </ModelsProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}
