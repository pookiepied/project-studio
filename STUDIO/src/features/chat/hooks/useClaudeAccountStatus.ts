import { useCallback, useEffect, useState } from "react";
import {
  getClaudeAccountStatus,
  type ClaudeAccountStatus,
} from "@/cliBridges";

export function useClaudeAccountStatus(enabled: boolean, refreshToken?: number | string) {
  const [status, setStatus] = useState<ClaudeAccountStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return null;
    setLoading(true);
    try {
      const next = await getClaudeAccountStatus(force);
      setStatus(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    refresh(false);
  }, [enabled, refresh, refreshToken]);

  return {
    status,
    loading,
    refresh,
  };
}
