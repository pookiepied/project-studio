import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatEngine } from "@/cliBridges/types";
import type { ConversationStorageScope } from "@/core/conversations";
import type { AppSettings } from "@/types";

interface ProjectContextValue {
  path: string;
  name: string;
  accessMode?: "review" | "autonomous";
}

interface UseChatEnvironmentControlsOptions {
  conversationId: string | undefined;
  conversationStorageScope: ConversationStorageScope;
  hasStartedConversation: boolean;
  isClaudeOwnedConversation: boolean;
  claudeCliAvailable: boolean;
  chatEngine: ChatEngine;
  projectContext: ProjectContextValue | null;
  autopilotMode: boolean | undefined;
  setChatEngine: (engine: ChatEngine, options?: { persist?: boolean }) => void;
  setConversationStorageScope: (scope: ConversationStorageScope) => void;
  createNewConversation: (
    scope?: ConversationStorageScope,
    options?: { preserveProject?: boolean }
  ) => void;
  setProjectContext: (ctx: ProjectContextValue | null) => void;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
}

export function useChatEnvironmentControls({
  conversationId,
  conversationStorageScope,
  hasStartedConversation,
  isClaudeOwnedConversation,
  claudeCliAvailable,
  chatEngine,
  projectContext,
  autopilotMode,
  setChatEngine,
  setConversationStorageScope,
  createNewConversation,
  setProjectContext,
  updateSettings,
}: UseChatEnvironmentControlsOptions) {
  const [conversationListScope, setConversationListScope] =
    useState<ConversationStorageScope>(conversationStorageScope);

  useEffect(() => {
    setConversationListScope(conversationStorageScope);
  }, [conversationId, conversationStorageScope]);

  const availableEngines = useMemo<readonly ChatEngine[]>(
    () => isClaudeOwnedConversation
      ? (["claude"] as const)
      : conversationStorageScope === "local" && claudeCliAvailable
      ? (["studio", "claude"] as const)
      : (["studio"] as const),
    [conversationStorageScope, claudeCliAvailable, isClaudeOwnedConversation]
  );

  useEffect(() => {
    if (!availableEngines.includes(chatEngine)) {
      setChatEngine(availableEngines[0], { persist: false });
    }
  }, [availableEngines, chatEngine, setChatEngine]);

  useEffect(() => {
    if (projectContext) {
      updateSettings({ autopilotMode: projectContext.accessMode === "autonomous" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectContext?.path, projectContext?.accessMode]);

  const handleStorageScopeChange = useCallback(async (scope: ConversationStorageScope) => {
    setConversationListScope(scope);

    if (scope === conversationStorageScope) return;

    if (!hasStartedConversation) {
      setConversationStorageScope(scope);
      return;
    }

    createNewConversation(scope, {
      preserveProject: scope === "local" && !!projectContext,
    });
  }, [
    conversationStorageScope,
    hasStartedConversation,
    setConversationStorageScope,
    createNewConversation,
    projectContext,
  ]);

  const toggleAutopilot = useCallback(() => {
    const currentAutonomous = projectContext
      ? projectContext.accessMode === "autonomous"
      : autopilotMode;
    const newMode: "review" | "autonomous" = currentAutonomous ? "review" : "autonomous";

    if (projectContext) {
      setProjectContext({ ...projectContext, accessMode: newMode });
    } else {
      updateSettings({ autopilotMode: newMode === "autonomous" });
    }
  }, [projectContext, autopilotMode, setProjectContext, updateSettings]);

  return {
    conversationListScope,
    availableEngines,
    handleStorageScopeChange,
    toggleAutopilot,
  };
}
