import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence }                   from "framer-motion";
import { BrowserPanelContext }                       from "@/app/contexts/BrowserPanelContext";
import { ArtifactPanelContext }                      from "@/app/contexts/ArtifactPanelContext";
import { ModelLibraryPanel }                         from "@/features/models";
import { SummaryPanel }                              from "@/features/artifacts";
import { ContextAutocomplete }                       from "@/features/chat/components/ContextAutocomplete";
import { environmentService }                        from "@/core/platform/environmentService";
import { useChat }                                   from "@/features/chat/context";
import { useModelsContext as useModels }              from "@/features/models/context";
import { useDraftPersistence }                       from "@/features/chat/hooks/useDraftPersistence";
import { useSettings }                               from "@/app/contexts/SettingsContext";
import { useTTS }                                    from "@/features/voice/hooks/useTTS";
import { useChatScroll }                             from "@/features/chat/hooks/useChatScroll";
import { useAtMention }                              from "@/features/chat/hooks/useAtMention";
import { useConversationsList }                      from "@/features/chat/hooks/useConversationsList";
import { useAttachments }                            from "@/features/chat/hooks/useAttachments";
import { useBrowserPanel }                           from "@/app/hooks/useBrowserPanel";
import { useArtifactPanel }                          from "@/app/hooks/useArtifactPanel";
import { useTerminalPanel }                          from "@/app/hooks/useTerminalPanel";
import { useMessageEdit }                            from "@/features/chat/hooks/useMessageEdit";
import { useMessagePopups }                          from "@/features/chat/hooks/useMessagePopups";
import { useConversationStatuses }                   from "@/features/chat/hooks/useConversationStatuses";
import { useSummaryPanel }                           from "@/app/hooks/useSummaryPanel";
import { useConvRename }                             from "@/features/chat/hooks/useConvRename";
import { usePermissionPrompt }                       from "@/features/chat/hooks/usePermissionPrompt";
import { useExclusivePanel, broadcastPanelOpen }     from "@/lib/hooks/useExclusivePanel";
import { useLocalCapabilities }                      from "@/features/chat/hooks/useLocalCapabilities";
import { useClaudeAccountStatus }                    from "@/features/chat/hooks/useClaudeAccountStatus";
import type { ConversationStorageScope }             from "@/core/conversations";

import { ChatHeader }           from "@/features/chat/components/ChatHeader";
import { ChatMessageList }      from "@/features/chat/components/ChatMessageList";
import { ConversationRail }     from "@/features/chat/components/ConversationRail";
import { ChatComposer }         from "@/features/chat/components/ChatComposer";
import { RenameModal }          from "@/features/chat/components/RenameModal";
import { ProjectContextPicker } from "@/features/chat/components/ProjectContextPicker";
import { ContextWindowButton }  from "@/features/chat/components/ContextWindowButton";
import { PendingMessageQueue }  from "@/features/chat/components/PendingMessageQueue";
import { ConnectionStatusBar }  from "@/features/chat/components/ConnectionStatusBar";
import { ComposerApprovalCard } from "@/features/permissions";
import { AskUserQuestionCard }  from "@/features/chat/components/AskUserQuestionCard";
import { DocumentStorageModal } from "@/features/artifacts";
import { ClaudeCodeIcon }       from "@/ui/brand";
import { ClaudeUsageBadge }     from "@/features/chat/components/ClaudeUsageBadge";
import {
  RightWorkspaceControls,
  RightWorkspacePanel,
  useRightWorkspace,
} from "@/features/workspace";
import type { ChatEngine } from "@/cliBridges/types";

// ---------------------------------------------------------------------------

// Breathing room below the last line so it - and the ready/status line - always
// clears the floating composer's top fade (~16px) with comfortable slack, in
// every scenario including landing at the bottom of an old conversation after a
// restart. Also leaves room for the last message's absolute hover action bar.
const BOTTOM_SCROLL_CLEARANCE = 48;

// Claude-owns-transcript banner — Claude Code brand-warm accent (Anthropic
// terracotta family, matches ClaudeCodeIcon #CC785C). Not a neutral surface;
// no design-token equivalent, so hex is intentional here.
/* eslint-disable no-restricted-syntax -- §17 brand carve-out: Claude Code warm accent, no neutral-token equivalent */
const CLAUDE_TRANSCRIPT_BANNER =
  "mb-2 rounded-xl border border-[#E9D8CF] dark:border-[#3A2A22] bg-[#FFF8F4] dark:bg-[#241B17] px-3 py-2 shadow-sm";
const CLAUDE_FORK_BUTTON =
  "flex-shrink-0 rounded-lg border border-[#E3C8BA] dark:border-[#4A342A] bg-white/80 dark:bg-[#2D211C] px-2.5 py-1 text-2xs font-medium text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-[#352820] transition-colors";
/* eslint-enable no-restricted-syntax */

export const ChatPage = () => {
  const {
    conversation,
    isLoading,
    isStreaming,
    streamingContent,
    streamingMessageId,
    error,
    clearError,
    currentModel,
    conversationStorageScope,
    setConversationStorageScope,
    chatEngine,
    setChatEngine,
    claudeModel,
    setClaudeModel,
    claudeSession,
    claudePermissionMode,
    setClaudePermissionMode,
    claudeEffortLevel,
    setClaudeEffortLevel,
    currentModelSupportsVision,
    setModel,
    editMessage,
    editMessageAndRegenerate,
    deleteMessageById,
    regenerateResponse,
    updateTitle,
    loadConversationById,
    createNewConversation,
    forkConversationToStudio,
    sendMessage,
    continueResponse,
    abortGeneration,
    displayedMessages,
    appendToDisplayedMessages,
    hasMoreMessages,
    loadMoreMessages,
    isLoadingMore,
    getMessageToolCalls,
    activeToolCalls,
    resolveToolApproval,
    answerPendingQuestion,
    grantToolPermission,
    isSummarizing,
    contextTokens,
    contextLimit,
    usageContextTokens,
    projectContext,
    setProjectContext,
    thinkingContent,
    reasoningBudget,
    setReasoningBudget,
    harnessSegments,
    pendingMessages,
    cancelPendingMessage,
    sessionTasks,
  } = useChat();

  const messages = displayedMessages;
  const isClaudeOwnedConversation = conversation?.metadata?.owner === "claude";
  const [conversationListScope, setConversationListScope] = useState<ConversationStorageScope>(conversationStorageScope);
  const hasStartedConversation = messages.length > 0;

  // -- External hooks ----------------------------------------------------------
  const { models, loading: modelsLoading } = useModels();
  const { settings, updateSettings }       = useSettings();
  const { claudeCliAvailable }             = useLocalCapabilities();
  const { status: claudeAccountStatus, loading: claudeAccountLoading, refresh: refreshClaudeAccountStatus } =
    useClaudeAccountStatus(conversationStorageScope === "local" && claudeCliAvailable, claudeSession?.lastTurnAt ?? 0);
  const tts                                = useTTS();
  const { inputMessage, setInputMessage, clearDraft } = useDraftPersistence(conversation?.id);

  const {
    atMentionVisible, atMentionPos, atMentionQuery,
    availableApps, handleAtMentionInput, handleSelectApp, closeAtMention,
  } = useAtMention();

  const conversationStatuses = useConversationStatuses();

  const {
    conversations,
    reload:                   reloadConversations,
    handleDeleteConversation: deleteConversation,
    handleSaveConvTitle:      saveConvTitle,
  } = useConversationsList(conversationListScope, {
    projectPath: conversationListScope === "local" ? projectContext?.path ?? null : null,
    claudeProjectPath: conversationListScope === "local" ? projectContext?.path ?? null : null,
  });

  useEffect(() => {
    setConversationListScope(conversationStorageScope);
  }, [conversation?.id, conversationStorageScope]);

  const {
    messagesContainerRef, messagesEndRef, messagesContentRef, loadMoreTriggerRef,
  } = useChatScroll({
    conversationId: conversation?.id,
    messageCount: messages.length, isStreaming, hasMoreMessages, isLoadingMore, loadMoreMessages,
  });

  const {
    attachments, setAttachments, showAttachMenu, setShowAttachMenu, attachMenuRef,
    fileInputRef, recentFiles, handleTriggerFileInput, handleFileSelect, handleSelectRecentFile,
    pendingFiles, isDocUploading, confirmDocUpload, cancelDocUpload, addFiles,
  } = useAttachments({ models, currentModel });

  // -- Extracted hooks ---------------------------------------------------------
  const {
    browserPanelOpen, setBrowserPanelOpen,
    browserTabs, activeBrowserTabId, setActiveBrowserTabId,
    setBrowserPanelWidth,
    browserPanelContextValue, handleTabClose,
    createBrowserTab, ensureBrowserTab, navigateBrowserTab,
    moveBrowserHistory, reloadBrowserTab, setBrowserZoom,
    toggleDeviceToolbar, clearBrowsingData,
  } = useBrowserPanel();

  const {
    terminalOpen, setTerminalOpen,
    setTerminalWidth,
    handleCloseTerminal,
  } = useTerminalPanel();

  const {
    editingMessageId, editingContent, setEditingContent, editTextareaRef,
    handleEditMessage, handleSaveEdit, handleCancelEdit,
  } = useMessageEdit({ messages, editMessage, editMessageAndRegenerate });

  const {
    copiedMessageId, ttsMenuId, setTtsMenuId, toolsPopupId, setToolsPopupId,
    handleCopyMessage,
  } = useMessagePopups();

  const {
    open:           artifactPanelOpen,
    setOpen:        setArtifactPanelOpen,
    tabs:           artifactTabs,
    activeTabId:    activeArtifactTabId,
    setActiveTabId: setActiveArtifactTabId,
    setWidth:       setArtifactPanelWidth,
    closeTab:       closeArtifactTab,
    contextValue:   artifactContextValue,
  } = useArtifactPanel();

  const isTauri = environmentService.isTauri();

  // -- Summary panel -----------------------------------------------------------
  const { summaryPanelOpen, summaryPanelWidth, setSummaryPanelOpen } = useSummaryPanel(sessionTasks.length);
  const rightWorkspace = useRightWorkspace({
    projectContext,
    terminalOpen,
    setTerminalOpen: (open) => {
      if (open) setTerminalOpen(true);
      else handleCloseTerminal();
    },
    browserOpen: browserPanelOpen,
    setBrowserOpen: setBrowserPanelOpen,
    artifactsOpen: artifactPanelOpen,
    setArtifactsOpen: setArtifactPanelOpen,
  });

  // -- Mutually-exclusive top-right panels --------------------------------------
  // Opening Overview closes Tools/Terminal & Notifications, and vice-versa.
  useExclusivePanel("overview", summaryPanelOpen, () => setSummaryPanelOpen(false));
  useExclusivePanel("tools", rightWorkspace.open, rightWorkspace.closeAll);

  // -- Model library -----------------------------------------------------------
  const [libraryOpen, setLibraryOpen] = useState(false);

  // -- Rename modal ------------------------------------------------------------
  const { isEditingTitle, titleInput, setIsEditingTitle, setTitleInput, handleSaveTitle } =
    useConvRename({ conversation, updateTitle, reloadConversations });

  // -- Conversation options + dropdown -----------------------------------------
  const [showConvMenu,      setShowConvMenu]      = useState(false);
  const [showConversations, setShowConversations] = useState(false);
  const [editingConvId,     setEditingConvId]     = useState<string | null>(null);
  const [editingConvTitle,  setEditingConvTitle]  = useState("");
  const [hoveredConvId,     setHoveredConvId]     = useState<string | null>(null);

  // reload when conversation id changes; conversation/ref excluded to avoid reload storms
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (conversation) reloadConversations(); }, [conversation?.id]);

  // -- Permission prompt -------------------------------------------------------
  const { pendingPermission, setPendingPermission } = usePermissionPrompt(activeToolCalls);

  // -- Floating composer dock height -------------------------------------------
  // Measured so the message list gets matching bottom padding - the last message
  // can scroll clear of the floating composer instead of being trapped behind it.
  const composerDockRef = useRef<HTMLDivElement>(null);
  const [composerDockH, setComposerDockH] = useState(132);
  useEffect(() => {
    const el = composerDockRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const h = el.offsetHeight;
      // Only update on a real change - prevents a setState storm / update-depth
      // loop while the textarea height animates during paste/typing.
      setComposerDockH(prev => (Math.abs(prev - h) > 1 ? h : prev));
    };
    const ro = new ResizeObserver(() => {
      // Defer to one measurement per frame instead of running synchronously
      // inside the observer callback (which forces reflow and can loop).
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(el);
    measure();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [conversation?.id]);

  // -- Input handlers ----------------------------------------------------------
  const isEmptyConversation = messages.length === 0;
  const emptyInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationInputRef = useRef<HTMLTextAreaElement>(null);
  const activeInputRef = isEmptyConversation ? emptyInputRef : conversationInputRef;

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.currentTarget.value;
    setInputMessage(value);
    handleAtMentionInput(value, e.currentTarget.selectionStart ?? value.length, { current: e.currentTarget });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const handleSendMessage = async () => {
    const hasAttachments = attachments.length > 0;
    if ((!inputMessage.trim() && !hasAttachments) || isLoading) return;

    if (attachments.some(a => a.isImage) && !currentModelSupportsVision) {
      appendToDisplayedMessages({
        id:        `vision-warning-${Date.now()}`,
        role:      "assistant",
        content:   `The selected model (${currentModel}) doesn't support image attachments. Please select a vision-capable model, or remove the attachments.`,
        timestamp: Date.now(),
      });
      setAttachments([]);
      return;
    }

    const msg  = inputMessage.trim();
    const atts = [...attachments];
    setInputMessage("");
    clearDraft();
    setAttachments([]);
    await sendMessage(msg, true, atts);
  };

  useEffect(() => {
    if (!conversation) return;
    const raf = requestAnimationFrame(() => activeInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
    // focus on conversation id change only; conversation object would re-fire on every metadata mutation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, activeInputRef]);

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (text) { setInputMessage(text); setTimeout(() => activeInputRef.current?.focus(), 50); }
    };
    const focusHandler = () => {
      setTimeout(() => activeInputRef.current?.focus(), 50);
    };
    window.addEventListener("inject-chat-text", handler);
    window.addEventListener("focus-chat-input", focusHandler);
    return () => {
      window.removeEventListener("inject-chat-text", handler);
      window.removeEventListener("focus-chat-input", focusHandler);
    };
  }, [activeInputRef, setInputMessage]);

  const customModelName = useMemo(
    () => models.find(m => m.id === currentModel)?.name,
    [models, currentModel]
  );

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

  // Mirror a project's per-folder accessMode onto the global autopilot flag so
  // dependent surfaces (the Claude bridge permission mode, Settings) stay in
  // step when a project is opened or its mode changes. We deliberately do NOT
  // force a value when no project is active — a global chat owns its own
  // review/autonomous choice via autopilotMode and must not be clobbered here
  // (that was the bug that locked global chats to review).
  useEffect(() => {
    if (projectContext) {
      updateSettings({ autopilotMode: projectContext.accessMode === "autonomous" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectContext?.path, projectContext?.accessMode]);

  // Shared props for both ChatComposer instances (empty state + conversation dock)
  const composerProps = {
    inputMessage, attachments, attachMenuRef, showAttachMenu,
    isLoading, isStreaming,
    currentModel,
    engineLocked: conversationStorageScope === "cloud",
    availableEngines,
    chatEngine, claudeModel,
    claudePermissionMode, claudeEffortLevel,
    customModelName, modelsLoading, reasoningBudget, settings,
    projectContext, recentFiles,
    onInputChange: handleInputChange,
    onKeyDown: handleKeyDown,
    onSend: handleSendMessage,
    onAbort: abortGeneration,
    onToggleAttachMenu: () => setShowAttachMenu(v => !v),
    onTriggerFileInput: handleTriggerFileInput,
    onSelectRecentFile: handleSelectRecentFile,
    onAttachmentsChange: setAttachments,
    onToggleAutopilot: () => {
      // Derive the flip from the EFFECTIVE mode, not the raw global flag, so the
      // toggle is correct whether or not a project is open. In a project the
      // per-folder accessMode is authoritative (the mirror effect syncs
      // autopilotMode); in a global chat autopilotMode is the single source.
      const currentAutonomous = projectContext
        ? projectContext.accessMode === "autonomous"
        : settings.autopilotMode;
      const newMode: "review" | "autonomous" = currentAutonomous ? "review" : "autonomous";
      if (projectContext) {
        setProjectContext({ ...projectContext, accessMode: newMode });
      } else {
        updateSettings({ autopilotMode: newMode === "autonomous" });
      }
    },
    onChatEngineChange: setChatEngine,
    onSelectModel: setModel,
    onClaudeModelChange: setClaudeModel,
    onOpenLibrary: () => setLibraryOpen(true),
    onTranscript: (text: string) => setInputMessage(prev => prev ? `${prev} ${text}` : text),
    onReasoningChange: setReasoningBudget,
    onAddFiles: addFiles,
    onClaudePermissionModeChange: setClaudePermissionMode,
    onClaudeEffortLevelChange: setClaudeEffortLevel,
  };

  const composerMetaRow = (showContextIndicator: boolean) => (
    <div className="flex min-h-[28px] items-start justify-between gap-3">
      <div
        className={`min-w-0 transition-opacity duration-200 ${
          conversationStorageScope === "local"
            ? "opacity-100"
            : "opacity-0 pointer-events-none select-none"
        }`}
        aria-hidden={conversationStorageScope !== "local"}
      >
        <div className={conversationStorageScope === "local" ? "" : "invisible"}>
          <ProjectContextPicker
            projectContext={projectContext}
            setProjectContext={setProjectContext}
          />
        </div>
      </div>

      <div className="flex h-7 shrink-0 items-center justify-end">
        {showContextIndicator && (
          <ContextWindowButton
            usedTokens={usageContextTokens > 0 ? usageContextTokens : contextTokens}
            maxTokens={contextLimit}
            isSummarizing={isSummarizing}
            hasContextSummary={!!conversation?.contextSummary}
            variant="meta"
          />
        )}
      </div>
    </div>
  );

  // -- Render ------------------------------------------------------------------

  return (
    <BrowserPanelContext.Provider value={browserPanelContextValue}>
    <ArtifactPanelContext.Provider value={artifactContextValue}>
    <div className="h-full flex flex-col relative bg-surface-page transition-colors duration-300">

      {/* Stable file input - outside animations so ref is always valid */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.markdown,.csv,.log,.json,.xml,.yaml,.yml,.toml,.html,.htm,.js,.ts,.jsx,.tsx,.py,.go,.rs,.java,.c,.cpp,.cs,.rb,.php,.sh"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Document storage modal - appears when a non-image file is selected */}
      <DocumentStorageModal
        files={pendingFiles}
        isOpen={pendingFiles.length > 0}
        isUploading={isDocUploading}
        onPermanent={() => confirmDocUpload(true)}
        onTemporary={() => confirmDocUpload(false)}
        onSkip={() => confirmDocUpload(null)}
        onCancel={cancelDocUpload}
      />

      {/* Backdrop - conversations dropdown */}
      <AnimatePresence>
        {showConversations && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setShowConversations(false)}
            className="fixed inset-0 bg-black/10 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      <ModelLibraryPanel
        isOpen={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onSelectModel={(id) => { setModel(id); setLibraryOpen(false); }}
        selectedModel={currentModel}
      />

      <RenameModal
        isOpen={isEditingTitle}
        titleInput={titleInput}
        onTitleChange={setTitleInput}
        onSave={handleSaveTitle}
        onCancel={() => { setIsEditingTitle(false); setTitleInput(""); }}
      />

      {/* -- SPLIT VIEW: chat column + side panels -- */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* -- Chat column -- */}
        <div className="flex-1 flex flex-col overflow-hidden relative" style={{ minWidth: "380px" }}>

          {/* Floating overview panel - overlays chat, does not push layout */}
          <AnimatePresence>
            {summaryPanelOpen && (
              <motion.div
                key="summary-panel-float"
                initial={{ opacity: 0, scale: 0.95, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: "top right", width: summaryPanelWidth, top: "46px", right: "12px" }}
                className="absolute z-50"
              >
                <SummaryPanel
                  onClose={() => setSummaryPanelOpen(false)}
                  sessionTasks={sessionTasks}
                  isStreaming={isStreaming}
                  activeToolCalls={activeToolCalls}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <ChatHeader
            conversationTitle={conversation?.title}
            projectName={conversationStorageScope === "local" ? projectContext?.name : undefined}
            isTauri={isTauri}
            summaryPanelOpen={summaryPanelOpen}
            onToggleSummaryPanel={() => {
              const next = !summaryPanelOpen;
              setSummaryPanelOpen(next);
              if (next) broadcastPanelOpen("overview");
            }}
            terminalOpen={terminalOpen}
            onToggleTerminal={() =>
              setTerminalOpen(v => {
                const next = !v;
                if (next) broadcastPanelOpen("tools");
                return next;
              })
            }
            showConvMenu={showConvMenu}
            onToggleConvMenu={() => setShowConvMenu(v => !v)}
            onCloseConvMenu={() => setShowConvMenu(false)}
            onRenameChat={() => setIsEditingTitle(true)}
            onNewChat={() => { createNewConversation(); setShowConversations(false); }}
            conversations={conversations}
            storageScope={conversationListScope}
            currentConvId={conversation?.id}
            showConversations={showConversations}
            editingConvId={editingConvId}
            editingConvTitle={editingConvTitle}
            hoveredConvId={hoveredConvId}
            onToggleConversations={() => setShowConversations(v => !v)}
            onStorageScopeChange={async (scope) => {
              setConversationListScope(scope);

              if (scope === conversationStorageScope) return;

              if (!hasStartedConversation) {
                setConversationStorageScope(scope);
                return;
              }

              createNewConversation(scope, {
                preserveProject: scope === "local" && !!projectContext,
              });
            }}
            onCloseConversations={() => setShowConversations(false)}
            onSelectConversation={async (id) => { await loadConversationById(id); setShowConversations(false); }}
            onNewConversation={() => {
              createNewConversation(conversationListScope, {
                preserveProject: conversationListScope === "local" && !!projectContext,
              });
              setShowConversations(false);
            }}
            onDeleteConversation={(id, e) => {
              e.stopPropagation();
              deleteConversation(id, conversation?.id, loadConversationById, createNewConversation)
                .catch(() => {});
            }}
            onStartEditTitle={(id, title, e) => { e.stopPropagation(); setEditingConvId(id); setEditingConvTitle(title); }}
            onSaveConvTitle={(id) =>
              saveConvTitle(id, editingConvTitle, conversation?.id, updateTitle)
                .then(() => { setEditingConvId(null); setEditingConvTitle(""); })
            }
            onCancelConvEdit={() => { setEditingConvId(null); setEditingConvTitle(""); }}
            onEditTitleChange={setEditingConvTitle}
            onHoverConv={setHoveredConvId}
            conversationStatuses={conversationStatuses}
            accountControl={
              conversationStorageScope === "local" && chatEngine === "claude" ? (
                <ClaudeUsageBadge
                  status={claudeAccountStatus}
                  loading={claudeAccountLoading}
                  rateLimit={claudeSession?.rateLimit}
                  onRefresh={() => refreshClaudeAccountStatus(true)}
                  compact
                />
              ) : null
            }
            rightControls={
              <RightWorkspaceControls
                isTauri={isTauri}
                projectContext={projectContext}
                open={rightWorkspace.open}
                summaryPanelOpen={summaryPanelOpen}
                onToggleSummaryPanel={() => {
                  const next = !summaryPanelOpen;
                  setSummaryPanelOpen(next);
                  if (next) broadcastPanelOpen("overview");
                }}
                onToggleOpen={() => {
                  if (!rightWorkspace.open) broadcastPanelOpen("tools");
                  rightWorkspace.toggleOpen();
                }}
              />
            }
          />

          {/* -- MAIN CONTENT: empty-centred ↔ conversation -- */}
          <AnimatePresence mode="popLayout" initial={false}>
            {isEmptyConversation ? (

              /* Empty state - composer centred */
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.35 } }}
                exit={{ opacity: 0, y: -16, transition: { duration: 0.2 } }}
                className="flex-1 flex flex-col items-center justify-center px-5 pb-10"
              >
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }}
                  className="text-2xl font-light text-gray-500 dark:text-gray-400 mb-7 select-none tracking-tight"
                >
                  What should we work on?
                </motion.p>

                <div className="w-full max-w-2xl">
                  <ConnectionStatusBar convId={conversation?.id} />
                  {/* Review-mode permission slide-in - surfaces the first
                      pending_approval tool call right above the composer. */}
                  <div className="mb-2">
                    <ComposerApprovalCard
                      toolCall={
                        activeToolCalls.find((tc) =>
                          tc.status === "pending_approval" &&
                          tc.approvalKind !== "global_access"
                        ) ?? null
                      }
                      onDecision={resolveToolApproval}
                    />
                    {(() => {
                      const q = activeToolCalls.find((tc) => tc.status === "pending_question");
                      return q ? (
                        <AskUserQuestionCard
                          key={q.callId}
                          question={q.args.question as string}
                          suggestions={q.args.suggestions as string[] | undefined}
                          onAnswer={answerPendingQuestion}
                        />
                      ) : null;
                    })()}
                  </div>
                  <ChatComposer {...composerProps} inputRef={emptyInputRef} />
                </div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.3, duration: 0.4 } }}
                  className="w-full max-w-2xl min-h-[42px]"
                >
                  {composerMetaRow(false)}
                </motion.div>
              </motion.div>

            ) : (

              /* Conversation view */
              <motion.div
                key="conversation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.25 } }}
                className="flex-1 flex flex-col overflow-hidden relative"
              >
                {/* Rail + scroll area - fills full height; the composer floats over
                    its bottom so messages scroll behind and dissolve at the field */}
                <div className="flex-1 flex flex-col relative overflow-hidden min-h-0">
                  {/* Top fade - messages dissolve into the header as they scroll
                      up, instead of hard-clipping at the scroll edge. */}
                  <div className="pointer-events-none absolute top-0 inset-x-0 h-8 z-10 bg-gradient-to-b from-white to-transparent dark:from-surface-page" />
                  <ConversationRail
                    messages={messages}
                    containerRef={messagesContainerRef}
                    bottomInset={composerDockH}
                  />
                  <ChatMessageList
                  scrollPaddingBottom={composerDockH + BOTTOM_SCROLL_CLEARANCE}
                  messages={messages}
                  isLoadingMore={isLoadingMore}
                  hasMoreMessages={hasMoreMessages}
                  messagesContainerRef={messagesContainerRef}
                  messagesEndRef={messagesEndRef}
                  messagesContentRef={messagesContentRef}
                  loadMoreTriggerRef={loadMoreTriggerRef}
                  chatEngine={chatEngine}
                  convId={conversation?.id}
                  contextTokens={contextTokens}
                  usageContextTokens={usageContextTokens}
                  contextLimit={contextLimit}
                  isLoading={isLoading}
                  isStreaming={isStreaming}
                  streamingContent={streamingContent}
                  streamingMessageId={streamingMessageId}
                  thinkingContent={thinkingContent}
                  harnessSegments={harnessSegments}
                  activeToolCalls={activeToolCalls}
                  editingMessageId={editingMessageId}
                  editingContent={editingContent}
                  editTextareaRef={editTextareaRef}
                  onEditChange={setEditingContent}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={handleCancelEdit}
                  copiedMessageId={copiedMessageId}
                  ttsPlayingId={tts.playingId}
                  ttsLoadingId={tts.loadingId}
                  ttsMenuId={ttsMenuId}
                  toolsPopupId={toolsPopupId}
                  getMessageToolCalls={getMessageToolCalls}
                  onCopy={handleCopyMessage}
                  onEdit={handleEditMessage}
                  onDelete={deleteMessageById}
                  onSpeak={(id, content) => tts.speak(id, content, settings.ttsModel)}
                  onSetTtsMenuId={setTtsMenuId}
                  onSetToolsPopupId={setToolsPopupId}
                  onRegenerate={regenerateResponse}
                  onContinue={continueResponse}
                  pendingPermission={pendingPermission}
                  onGrantPermission={grantToolPermission}
                  onDismissPermission={() => setPendingPermission(null)}
                  error={error}
                  onClearError={clearError}
                />
                </div>{/* end rail + scroll area wrapper */}

                {/* Floating composer - overlays the bottom of the message area.
                    pointer-events-none lets scroll pass through the empty gutters;
                    the centred column re-enables interaction. A gradient backdrop
                    fades messages out exactly as they reach the text field. */}
                <div
                  ref={composerDockRef}
                  className="absolute bottom-0 inset-x-0 z-20 pointer-events-none"
                >
                  {/* Soft fade above the dock - messages dissolve just before the
                      text field (and above the Claude-owns-transcript banner when
                      it's shown) instead of hard-clipping. Mirrors the top fade. */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-gradient-to-t from-white to-transparent dark:from-surface-page" />
                  <div className="pointer-events-none absolute inset-0 bg-surface-page" />
                  <div className="relative px-5 pt-3 pb-7">
                    <div className="max-w-2xl mx-auto relative pointer-events-auto">
                      {isClaudeOwnedConversation && (
                        <div className={CLAUDE_TRANSCRIPT_BANNER}>
                          <div className="flex items-center gap-2">
                            <ClaudeCodeIcon size={15} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
                                Claude Code owns this transcript
                              </p>
                              <p className="text-2xs text-gray-500 dark:text-gray-500">
                                Continue with Claude to keep the native history intact, or fork a Studio-owned copy.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={forkConversationToStudio}
                              className={CLAUDE_FORK_BUTTON}
                            >
                              Fork to Studio
                            </button>
                          </div>
                        </div>
                      )}

                      <PendingMessageQueue
                        messages={pendingMessages}
                        onCancel={cancelPendingMessage}
                      />

                      <ConnectionStatusBar convId={conversation?.id} />

                      {/* Review-mode permission slide-in - surfaces the first
                          pending_approval tool call right above the composer.
                          The promise held by ChatProvider's
                          pendingApprovalResolveRef keeps waiting while the
                          user navigates to another view; the card re-renders
                          from activeToolCalls the moment chat comes back. */}
                      <div className="mb-2">
                        <ComposerApprovalCard
                          toolCall={
                            activeToolCalls.find((tc) =>
                              tc.status === "pending_approval" &&
                              tc.approvalKind !== "global_access"
                            ) ?? null
                          }
                          onDecision={resolveToolApproval}
                        />
                        {(() => {
                          const q = activeToolCalls.find((tc) => tc.status === "pending_question");
                          return q ? (
                            <AskUserQuestionCard
                              key={q.callId}
                              question={q.args.question as string}
                              suggestions={q.args.suggestions as string[] | undefined}
                              onAnswer={answerPendingQuestion}
                            />
                          ) : null;
                        })()}
                      </div>

                      <div>
                        <ChatComposer {...composerProps} inputRef={conversationInputRef} />
                      </div>

                      <div className="min-h-[42px]">
                        {composerMetaRow(true)}
                      </div>
                    </div>
                  </div>
                </div>

              </motion.div>
            )}
          </AnimatePresence>

        </div>{/* end chat column */}

        <RightWorkspacePanel
          open={rightWorkspace.open}
          homeOpen={rightWorkspace.homeOpen}
          openViews={rightWorkspace.openViews}
          activeView={rightWorkspace.activeView}
          onClose={rightWorkspace.closeAll}
          onCloseView={rightWorkspace.closeView}
          onOpenView={(view) => {
            if (view === "browser") ensureBrowserTab();
            rightWorkspace.openView(view);
            broadcastPanelOpen("tools");
          }}
          projectContext={projectContext}
          onTerminalWidthChange={setTerminalWidth}
          browserTabs={browserTabs}
          activeBrowserTabId={activeBrowserTabId}
          onBrowserTabChange={setActiveBrowserTabId}
          onBrowserTabClose={(id) => {
            if (browserTabs.length <= 1) rightWorkspace.closeView("browser");
            handleTabClose(id);
          }}
          onBrowserNewTab={() => createBrowserTab()}
          onBrowserNavigate={navigateBrowserTab}
          onBrowserHistory={moveBrowserHistory}
          onBrowserReload={reloadBrowserTab}
          onBrowserZoom={setBrowserZoom}
          onBrowserToggleDeviceToolbar={toggleDeviceToolbar}
          onBrowserClearData={clearBrowsingData}
          onBrowserWidthChange={setBrowserPanelWidth}
          artifactTabs={artifactTabs}
          activeArtifactTabId={activeArtifactTabId}
          onArtifactTabChange={setActiveArtifactTabId}
          onArtifactTabClose={closeArtifactTab}
          onArtifactWidthChange={setArtifactPanelWidth}
        />


      </div>{/* end flex row */}

      {/* @ app mention popup */}
      <ContextAutocomplete
        isVisible={atMentionVisible}
        contexts={[]}
        onSelect={() => {}}
        onClose={closeAtMention}
        searchQuery={atMentionQuery}
        position={atMentionPos}
        apps={availableApps}
        onSelectApp={(app) => handleSelectApp(app, inputMessage, setInputMessage, activeInputRef)}
      />

    </div>
    </ArtifactPanelContext.Provider>
    </BrowserPanelContext.Provider>
  );
};
