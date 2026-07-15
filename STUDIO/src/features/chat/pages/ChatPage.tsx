import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence }                   from "framer-motion";
import { BrowserPanelContext }                       from "@/app/contexts/BrowserPanelContext";
import { ArtifactPanelContext }                      from "@/app/contexts/ArtifactPanelContext";
import { environmentService }                        from "@/core/platform/environmentService";
import { openConversationWindow }                    from "@/core/platform/conversationWindowService";
import { useRightPanelWidth }                         from "@/app/shell/workspaceLayoutStore";
import { useChat }                                   from "@/features/chat/context";
import { useModelsContext as useModels }              from "@/features/models/context";
import { useDraftPersistence }                       from "@/features/chat/hooks/useDraftPersistence";
import { useSettings }                               from "@/app/contexts/SettingsContext";
import { useTTSContext as useTTS }                   from "@/features/voice/context/TTSContext";
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
import { useConvRename }                             from "@/features/chat/hooks/useConvRename";
import { usePermissionPrompt }                       from "@/features/chat/hooks/usePermissionPrompt";
import { useExclusivePanel, broadcastPanelOpen }     from "@/lib/hooks/useExclusivePanel";
import { useLocalCapabilities }                      from "@/features/chat/hooks/useLocalCapabilities";
import { useClaudeAccountStatus }                    from "@/features/chat/hooks/useClaudeAccountStatus";

import { ChatMessageList }      from "@/features/chat/components/ChatMessageList";
import { ConversationRail }     from "@/features/chat/components/ConversationRail";
import { ChatComposer }         from "@/features/chat/components/ChatComposer";
import { ConnectionStatusBar }  from "@/features/chat/components/ConnectionStatusBar";
import { LeftWorkspaceSidebar } from "@/features/chat/components/LeftWorkspaceSidebar";
import {
  RightWorkspacePanel,
  useRightWorkspace,
} from "@/features/workspace";
import { PendingComposerInteractions } from "./ChatComposerPanels";
import { ChatConversationComposerDock } from "./ChatConversationComposerDock";
import { ChatPageOverlays } from "./ChatPageOverlays";
import { ChatTopChrome } from "./ChatTopChrome";
import { useComposerDockHeight } from "./useComposerDockHeight";
import { useChatComposerInput } from "./useChatComposerInput";
import { useChatEnvironmentControls } from "./useChatEnvironmentControls";
import { useChatProjectRegistry } from "./useChatProjectRegistry";
import { useChatTurnStatus } from "./useChatTurnStatus";
import { useRenderableConversation } from "@/features/chat/canonical";

// ---------------------------------------------------------------------------

// Breathing room below the last line so it - and the ready/status line - always
// clears the floating composer's top fade (~16px) with comfortable slack, in
// every scenario including landing at the bottom of an old conversation after a
// restart. Also leaves room for the last message's absolute hover action bar.
const BOTTOM_SCROLL_CLEARANCE = 6;

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
  } = useChat();

  const canonicalConversation = useRenderableConversation({
    conversationId: conversation?.id,
    enabled: conversationStorageScope === "cloud" && conversation?.metadata?.owner !== "claude",
    limit: 500,
  });
  const messages =
    canonicalConversation.status === "ready" && canonicalConversation.state
      ? canonicalConversation.state.messages
      : displayedMessages;
  const isClaudeOwnedConversation = conversation?.metadata?.owner === "claude";
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
    conversationListScope,
    availableEngines,
    handleStorageScopeChange,
    toggleAutopilot,
  } = useChatEnvironmentControls({
    conversationId: conversation?.id,
    conversationStorageScope,
    hasStartedConversation,
    isClaudeOwnedConversation,
    claudeCliAvailable,
    chatEngine,
    projectContext,
    autopilotMode: settings.autopilotMode,
    setChatEngine,
    setConversationStorageScope,
    createNewConversation,
    setProjectContext,
    updateSettings,
  });

  const {
    conversations,
    reload:                   reloadConversations,
    handleDeleteConversation: deleteConversation,
    handleSaveConvTitle:      saveConvTitle,
  } = useConversationsList(conversationListScope);

  const {
    messagesContainerRef, messagesEndRef, messagesContentRef, loadMoreTriggerRef, forwardWheel,
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
    browserTabs, setActiveBrowserTabId,
    setBrowserPanelWidth,
    browserPanelContextValue, handleTabClose,
    createBrowserTab, navigateBrowserTab,
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
    copiedMessageId, ttsMenuId, setTtsMenuId,
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
  // Width the right workspace panel currently occupies (0 when closed). The
  // top-right control cluster shifts left by this so it rides the panel's edge
  // instead of being covered by it.
  const rightPanelWidth = useRightPanelWidth();

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
    createBrowserTab,
    closeBrowserTab: handleTabClose,
  });

  // -- Mutually-exclusive top-right panels --------------------------------------
  // Opening Tools/Terminal closes Notifications, and vice-versa.
  useExclusivePanel("tools", rightWorkspace.open, rightWorkspace.closeAll);

  // -- Model library -----------------------------------------------------------
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);

  // -- Rename modal ------------------------------------------------------------
  const { isEditingTitle, titleInput, setIsEditingTitle, setTitleInput, handleSaveTitle } =
    useConvRename({ conversation, updateTitle, reloadConversations });

  // -- Conversation inline-rename state (dock owns its own browser/options UI) --
  const [editingConvId,     setEditingConvId]     = useState<string | null>(null);
  const [editingConvTitle,  setEditingConvTitle]  = useState("");

  // reload when conversation id changes; conversation/ref excluded to avoid reload storms
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (conversation) reloadConversations(); }, [conversation?.id]);

  // -- Permission prompt -------------------------------------------------------
  const { pendingPermission, setPendingPermission } = usePermissionPrompt(activeToolCalls);

  const {
    composerDockRef,
    composerDockHeight: composerDockH,
  } = useComposerDockHeight(conversation?.id);

  const isEmptyConversation = messages.length === 0;

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

  const {
    emptyInputRef,
    conversationInputRef,
    activeInputRef,
    handleInputChange,
    handleKeyDown,
  } = useChatComposerInput({
    conversationId: conversation?.id,
    isEmptyConversation,
    setInputMessage,
    handleAtMentionInput,
    onSend: handleSendMessage,
  });

  const customModelName = useMemo(
    () => models.find(m => m.id === currentModel)?.name,
    [models, currentModel]
  );

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
    onToggleAutopilot: toggleAutopilot,
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

  const {
    projects,
    removeProject,
    deleteProject,
    handleSelectProject,
    handleOpenProjectFolder,
  } = useChatProjectRegistry({
    projectContext,
    conversationStorageScope,
    setProjectContext,
  });

  const turnStatus = useChatTurnStatus({
    activeToolCalls,
    streamingContent,
    thinkingContent,
    harnessSegments,
    isLoading,
    isStreaming,
    streamingMessageId,
    hasMessages: messages.length > 0,
    pendingPermission,
    chatEngine,
    conversationId: conversation?.id,
    usageContextTokens,
    contextLimit,
  });

  const composerBlock = (inputRef: React.RefObject<HTMLTextAreaElement | null>) => (
    <ChatComposer {...composerProps} inputRef={inputRef} />
  );

  // -- Render ------------------------------------------------------------------

  return (
    <BrowserPanelContext.Provider value={browserPanelContextValue}>
    <ArtifactPanelContext.Provider value={artifactContextValue}>
    <div className="h-full flex flex-col relative bg-surface-page transition-colors duration-300">

      <ChatPageOverlays
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
        pendingFiles={pendingFiles}
        isDocUploading={isDocUploading}
        onConfirmDocUpload={confirmDocUpload}
        onCancelDocUpload={cancelDocUpload}
        libraryOpen={libraryOpen}
        onCloseLibrary={() => setLibraryOpen(false)}
        onSelectModel={(id) => { setModel(id); setLibraryOpen(false); }}
        selectedModel={currentModel}
        renameOpen={isEditingTitle}
        titleInput={titleInput}
        onTitleChange={setTitleInput}
        onSaveTitle={handleSaveTitle}
        onCancelRename={() => { setIsEditingTitle(false); setTitleInput(""); }}
        atMentionVisible={atMentionVisible}
        closeAtMention={closeAtMention}
        atMentionQuery={atMentionQuery}
        atMentionPos={atMentionPos}
        availableApps={availableApps}
        onSelectApp={(app) => handleSelectApp(app, inputMessage, setInputMessage, activeInputRef)}
      />

      <ChatTopChrome
        active={hasStartedConversation}
        conversationTitle={conversation?.title}
        projectName={conversationStorageScope === "local" ? projectContext?.name : undefined}
        scope={conversationStorageScope}
        onScopeChange={handleStorageScopeChange}
        projects={projects}
        currentProjectPath={projectContext?.path}
        conversations={conversations}
        currentConvId={conversation?.id}
        conversationStatuses={conversationStatuses}
        projectContext={projectContext}
        setProjectContext={setProjectContext}
        isEmptyConversation={isEmptyConversation}
        usageContextTokens={usageContextTokens}
        contextTokens={contextTokens}
        contextLimit={contextLimit}
        isSummarizing={isSummarizing}
        hasContextSummary={!!conversation?.contextSummary}
        chatEngine={chatEngine}
        claudeAccountStatus={claudeAccountStatus}
        claudeAccountLoading={claudeAccountLoading}
        claudeRateLimit={claudeSession?.rateLimit}
        onRefreshClaudeAccount={() => refreshClaudeAccountStatus(true)}
        onSelectProject={handleSelectProject}
        onOpenProjectFolder={handleOpenProjectFolder}
        onRemoveProject={(id) => { void removeProject(id); }}
        onDeleteProject={(id) => { void deleteProject(id); }}
        onSelectConversation={async (id) => { await loadConversationById(id); }}
        onOpenConversationInSideChat={(id) => {
          rightWorkspace.openView("side-chat", { conversationId: id });
          broadcastPanelOpen("tools");
        }}
        onOpenConversationInNewWindow={(id) => { void openConversationWindow(id); }}
        onNewConversation={() => {
          createNewConversation(conversationListScope, {
            preserveProject: conversationListScope === "local" && !!projectContext,
          });
        }}
        onStartEditTitle={(id, title, e) => { e.stopPropagation(); setEditingConvId(id); setEditingConvTitle(title); }}
        onDeleteConversation={(id, e) => {
          e.stopPropagation();
          deleteConversation(id, conversation?.id, loadConversationById, createNewConversation)
            .catch(() => {});
        }}
        editingConvId={editingConvId}
        editingConvTitle={editingConvTitle}
        onEditTitleChange={setEditingConvTitle}
        onSaveConvTitle={(id) =>
          saveConvTitle(id, editingConvTitle, conversation?.id, updateTitle)
            .then(() => { setEditingConvId(null); setEditingConvTitle(""); })
        }
        onCancelConvEdit={() => { setEditingConvId(null); setEditingConvTitle(""); }}
        rightPanelWidth={rightPanelWidth}
        isTauri={isTauri}
        workspaceOpen={rightWorkspace.open}
        onToggleWorkspace={() => {
          if (!rightWorkspace.open) broadcastPanelOpen("tools");
          rightWorkspace.toggleOpen();
        }}
      />

      {/* -- SPLIT VIEW: left sidebar + chat column + side panels -- */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Left sidebar is rendered as the first flex child so its panel can
            push (reflow) the chat column on expand/collapse, mirroring the
            right workspace. Its fixed control controls float above the flow. */}
        <LeftWorkspaceSidebar
          open={leftSidebarOpen}
          onOpenChange={setLeftSidebarOpen}
          scope={conversationStorageScope}
          onScopeChange={handleStorageScopeChange}
          projects={projects}
          currentProjectPath={projectContext?.path}
          conversations={conversations}
          currentConvId={conversation?.id}
          conversationStatuses={conversationStatuses}
          onSelectProject={handleSelectProject}
          onOpenProjectFolder={handleOpenProjectFolder}
          onRemoveProject={(id) => { void removeProject(id); }}
          onDeleteProject={(id) => { void deleteProject(id); }}
          onSelectConversation={async (id) => { await loadConversationById(id); }}
          onOpenConversationInSideChat={(id) => {
            rightWorkspace.openView("side-chat", { conversationId: id });
            broadcastPanelOpen("tools");
          }}
          onOpenConversationInNewWindow={(id) => { void openConversationWindow(id); }}
          onNewConversation={() => {
            createNewConversation(conversationListScope, {
              preserveProject: conversationListScope === "local" && !!projectContext,
            });
          }}
          onStartEditTitle={(id, title, e) => { e.stopPropagation(); setEditingConvId(id); setEditingConvTitle(title); }}
          onDeleteConversation={(id, e) => {
            e.stopPropagation();
            deleteConversation(id, conversation?.id, loadConversationById, createNewConversation)
              .catch(() => {});
          }}
          editingConvId={editingConvId}
          editingConvTitle={editingConvTitle}
          onEditTitleChange={setEditingConvTitle}
          onSaveConvTitle={(id) =>
            saveConvTitle(id, editingConvTitle, conversation?.id, updateTitle)
              .then(() => { setEditingConvId(null); setEditingConvTitle(""); })
          }
          onCancelConvEdit={() => { setEditingConvId(null); setEditingConvTitle(""); }}
        />

        {/* -- Chat column -- */}
        <div className="flex-1 flex flex-col overflow-hidden relative" style={{ minWidth: "380px" }}>

          {/* -- MAIN CONTENT: empty-centered / conversation -- */}
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
                  className="font-display text-3xl font-normal text-secondary mb-7 select-none"
                >
                  What should we work on?
                </motion.p>

                <div className="w-full max-w-2xl">
                  <ConnectionStatusBar convId={conversation?.id} />
                  {/* Review-mode permission slide-in - surfaces the first
                      pending_approval tool call right above the composer. */}
                  <PendingComposerInteractions
                    activeToolCalls={activeToolCalls}
                    onApprovalDecision={resolveToolApproval}
                    onQuestionAnswer={answerPendingQuestion}
                  />
                  {composerBlock(emptyInputRef)}
                </div>
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
                  <ConversationRail
                    messages={messages}
                    containerRef={messagesContainerRef}
                    bottomInset={composerDockH}
                  />
                  <ChatMessageList
                  scrollPaddingBottom={composerDockH + BOTTOM_SCROLL_CLEARANCE}
                  turnStatus={turnStatus}
                  messages={messages}
                  isLoadingMore={isLoadingMore}
                  hasMoreMessages={hasMoreMessages}
                  messagesContainerRef={messagesContainerRef}
                  messagesEndRef={messagesEndRef}
                  messagesContentRef={messagesContentRef}
                  loadMoreTriggerRef={loadMoreTriggerRef}
                  isLoading={isLoading}
                  isStreaming={isStreaming}
                  streamingContent={streamingContent}
                  streamingMessageId={streamingMessageId}
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
                  onCopy={handleCopyMessage}
                  onEdit={handleEditMessage}
                  onDelete={deleteMessageById}
                  onSpeak={(id, content) => tts.speak(id, content, settings.ttsModel)}
                  onSetTtsMenuId={setTtsMenuId}
                  onRegenerate={regenerateResponse}
                  onContinue={continueResponse}
                  pendingPermission={pendingPermission}
                  onGrantPermission={grantToolPermission}
                  onDismissPermission={() => setPendingPermission(null)}
                  error={error}
                  onClearError={clearError}
                />
                </div>{/* end rail + scroll area wrapper */}

                <ChatConversationComposerDock
                  dockRef={composerDockRef}
                  onWheelDelta={forwardWheel}
                  isClaudeOwnedConversation={isClaudeOwnedConversation}
                  onForkConversation={forkConversationToStudio}
                  pendingMessages={pendingMessages}
                  onCancelPendingMessage={cancelPendingMessage}
                  conversationId={conversation?.id}
                  activeToolCalls={activeToolCalls}
                  onApprovalDecision={resolveToolApproval}
                  onQuestionAnswer={answerPendingQuestion}
                  composer={composerBlock(conversationInputRef)}
                />

              </motion.div>
            )}
          </AnimatePresence>

        </div>{/* end chat column */}

        <RightWorkspacePanel
          open={rightWorkspace.open}
          tabs={rightWorkspace.tabs}
          activeTabId={rightWorkspace.activeTabId}
          onClose={rightWorkspace.closeAll}
          onCloseTab={rightWorkspace.closeTab}
          onActivateTab={rightWorkspace.setActiveTabId}
          onCreateTab={(type, options) => {
            const id = rightWorkspace.openView(type, {
              rootPath: projectContext?.path ?? null,
              cwd: projectContext?.path ?? null,
              ...options,
            });
            broadcastPanelOpen("tools");
            return id;
          }}
          onUpdateTab={rightWorkspace.updateTab}
          projectContext={projectContext}
          onTerminalWidthChange={setTerminalWidth}
          browserTabs={browserTabs}
          onBrowserTabChange={setActiveBrowserTabId}
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

    </div>
    </ArtifactPanelContext.Provider>
    </BrowserPanelContext.Provider>
  );
};
