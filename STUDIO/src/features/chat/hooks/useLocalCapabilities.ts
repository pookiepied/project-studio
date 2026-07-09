import { useCallback, useEffect, useState } from "react";
import {
  checkLocalCapabilities,
  type LocalCapabilitiesSnapshot,
} from "@/runtime";

export function useLocalCapabilities() {
  const [snapshot, setSnapshot] = useState<LocalCapabilitiesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await checkLocalCapabilities());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    snapshot,
    loading,
    refresh,
    claudeCliAvailable: snapshot?.capabilities["claude-cli"].available ?? false,
    claudeCliStatus: snapshot?.capabilities["claude-cli"] ?? null,
  };
}
