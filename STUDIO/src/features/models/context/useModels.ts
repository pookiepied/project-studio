import { useState, useEffect } from "react";
import { fetchModels } from "@/features/models/services/modelService";
import type { Model, ModelsResponse, ProviderInfo } from "@/core/models";
import { errorService } from "@/core/errors/errorService";
import { useSettings } from "@/app/contexts/SettingsContext";
import { useDaemon } from "@/features/models/hooks/useLocalProviderDaemon";
import { createDaemonClient } from "@/core/daemon/daemonClient";
import { logger } from "@/core/logging/logger";

export interface UseModelsResult {
  models: Model[];
  providers: Record<string, ProviderInfo>;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  totalModels: number;
  uniqueModels: number;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and manage models from API
 * Respects ollamaEnabled setting to include/exclude local models
 */
export function useModels(): UseModelsResult {
  const { settings } = useSettings();
  const { status: daemonStatus } = useDaemon();
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadModels = async (forceRefresh: boolean = false) => {
    setLoading(true);
    setError(null);

    try {
      const shouldUseDaemonLocalModels = settings.localProviderEnabled && daemonStatus.running;
      const includeDirectOllama = settings.ollamaEnabled && !shouldUseDaemonLocalModels;

      // Use direct Ollama discovery only when daemon-local discovery is not active.
      const response = await fetchModels(
        forceRefresh,
        includeDirectOllama,
        settings.parakeetEnabled,
        settings.edgeTtsEnabled
      );

      if (response.success && response.data) {
        let finalData = response.data;

        // Only fetch from daemon when it is actually running — avoids ERR_CONNECTION_REFUSED spam
        if (shouldUseDaemonLocalModels) {
          try {
            const daemonClient = createDaemonClient(daemonStatus.port || settings.localProviderPort);
            const [daemonModels, daemonHealth] = await Promise.all([
              daemonClient.fetchModels(forceRefresh),
              daemonClient.checkHealth(),
            ]);

            const filteredDaemonModels = daemonModels.filter((m) => {
              if (m.provider === "ollama") return settings.ollamaEnabled;
              if (m.provider === "lmstudio") return settings.lmstudioEnabled;
              return true;
            });

            const hasEnabledConnectedProvider =
              (settings.ollamaEnabled && daemonHealth.providers.ollama) ||
              (settings.lmstudioEnabled && daemonHealth.providers.lmstudio);

            if (filteredDaemonModels.length > 0) {
              // Map daemon LocalModel to Model shape for merging
              const mappedModels: Model[] = filteredDaemonModels.map(m => ({
                id: m.id,
                name: m.name,
                provider: "local",
                type: "chat" as const,
                free: true,
              }));

              finalData = {
                ...finalData,
                models: [...finalData.models, ...mappedModels],
                providers: {
                  ...finalData.providers,
                  local: {
                    provider: "local",
                    status: "active" as const,
                    lastChecked: new Date().toISOString(),
                    apiKeyValid: true,
                    modelCount: filteredDaemonModels.length,
                  },
                },
                totalModels: finalData.totalModels + filteredDaemonModels.length,
                uniqueModels: finalData.uniqueModels + filteredDaemonModels.length,
              };

              logger.info("useModels", `Merged ${filteredDaemonModels.length} local models from daemon`);
            } else if (hasEnabledConnectedProvider) {
              finalData = {
                ...finalData,
                providers: {
                  ...finalData.providers,
                  local: {
                    provider: "local",
                    status: "active" as const,
                    lastChecked: new Date().toISOString(),
                    apiKeyValid: true,
                    modelCount: 0,
                  },
                },
              };

              logger.info("useModels", "Local provider connected but no local models were discovered");
            }
          } catch (error) {
            logger.debug("useModels", "Failed to fetch local models from daemon", error);
            // Continue with cloud models only if daemon is unavailable
          }
        }

        setData(finalData);
      } else {
        const userMessage = errorService.getUserMessage(response.error);
        setError(userMessage);
      }
    } catch (err) {
      const userMessage = errorService.getUserMessage(err);
      setError(userMessage);
    } finally {
      setLoading(false);
    }
  };

  // Reload when relevant settings or daemon running state changes
  useEffect(() => {
    loadModels(false);
    // loadModels is component-local; reload only on relevant settings/daemonStatus fields
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ollamaEnabled, settings.lmstudioEnabled, settings.localProviderEnabled, settings.localProviderPort, settings.parakeetEnabled, settings.edgeTtsEnabled, daemonStatus.running, daemonStatus.port]);

  return {
    models: data?.models || [],
    providers: data?.providers || {},
    loading,
    error,
    lastUpdated: data?.lastUpdated || null,
    totalModels: data?.totalModels || 0,
    uniqueModels: data?.uniqueModels || 0,
    refetch: () => loadModels(true), // Force refresh when manually triggered
  };
}
