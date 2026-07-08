import { useState, useCallback } from "react";

interface UsePermittedToolsResult {
  permittedTools: string[];
  grantToolPermission: (tool: string) => void;
  revokeToolPermission: (tool: string) => void;
  resetPermittedTools: () => void;
}

export function usePermittedTools(): UsePermittedToolsResult {
  const [permittedTools, setPermittedTools] = useState<string[]>([]);

  const grantToolPermission = useCallback((tool: string) => {
    setPermittedTools((prev) => prev.includes(tool) ? prev : [...prev, tool]);
  }, []);

  const revokeToolPermission = useCallback((tool: string) => {
    setPermittedTools((prev) => prev.filter((t) => t !== tool));
  }, []);

  const resetPermittedTools = useCallback(() => {
    setPermittedTools([]);
  }, []);

  return { permittedTools, grantToolPermission, revokeToolPermission, resetPermittedTools };
}
