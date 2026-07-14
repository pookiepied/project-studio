import React, { useState, useEffect, useMemo, useCallback } from "react";
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
import { useProjects }          from "@/features/chat/hooks/useProjects";
import { projectRegistry, type ProjectEntry } from "@/core/projects";
import { open as openDialog }   from "@tauri-apps/plugin-dialog";
import { PendingMessageQueue }  from "@/features/chat/components/PendingMessageQueue";
import { ConnectionStatusBar }  from "@/features/chat/components/ConnectionStatusBar";
import {
  RightWorkspacePanel,
  useRightWorkspace,
} from "@/features/workspace";
import { ClaudeTranscriptNotice, PendingComposerInteractions } from "./ChatComposerPanels";
import { ChatPageOverlays } from "./ChatPageOverlays";
import { ChatTopChrome } from "./ChatTopChrome";
import { useComposerDockHeight } from "./useComposerDockHeight";
import { useChatComposerInput } from "./useChatComposerInput";
import { useChatEnvironmentControls } from "./useChatEnvironmentControls";

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

  const messages = displayedMessages;
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

  // Project registry: the canonical list behind the projects/conversations
  // switcher. Opening a folder registers it; selecting one makes it this
  // conversation's context.
  const { projects, refresh: refreshProjects, removeProject, deleteProject } = useProjects();
  const runningTurnTool = activeToolCalls.find(
    (tc) => tc.status === "running" && !tc.parentCallId
  );
  const hasVisibleTurnActivity =
    streamingContent.trim().length > 0 ||
    thinkingContent.trim().length > 0 ||
    harnessSegments.length > 0 ||
    !!runningTurnTool;
  const hasActiveTurn = isLoading || isStreaming || !!streamingMessageId;
  const isPreparingTurn = hasActiveTurn && !hasVisibleTurnActivity;

  const handleSelectProject = useCallback(async (project: ProjectEntry) => {
    setProjectContext({ path: project.path, name: project.name, accessMode: project.accessMode });
    await projectRegistry.touch(project.id);
    await refreshProjects();
  }, [setProjectContext, refreshProjects]);

  const handleOpenProjectFolder = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    const entry = await projectRegistry.add(selected);
    setProjectContext({ path: entry.path, name: entry.name, accessMode: entry.accessMode });
    await refreshProjects();
  }, [setProjectContext, refreshProjects]);

  // Any project that becomes the active context gets registered, whichever way
  // it was chosen (switcher, composer picker, or restored with a conversation).
  const activeProjectPath = projectContext?.path;
  const activeProjectName = projectContext?.name;
  useEffect(() => {
    if (!activeProjectPath || conversationStorageScope !== "local") return;
    projectRegistry
      .add(activeProjectPath, { name: activeProjectName })
      .then(() => refreshProjects())
      .catch(() => {});
  }, [activeProjectPath, activeProjectName, conversationStorageScope, refreshProjects]);

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

      {/* -- SPLIT VIEW: chat column + side panels -- */}
      <div className="flex-1 flex overflow-hidden min-h-0">

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
                  turnStatus={messages.length > 0 && !pendingPermission ? {
                    engine: chatEngine,
                    convId: conversation?.id,
                    generating: isPreparingTurn || hasVisibleTurnActivity,
                    label: (() => {
                      if (isPreparingTurn) return "Preparing";
                      if (runningTurnTool) return "Working";
                      if (streamingContent && streamingContent.length > 0) return "Responding";
                      return "Thinking";
                    })(),
                    thinking: thinkingContent,
                    contextUsed: usageContextTokens && usageContextTokens > 0 ? usageContextTokens : undefined,
                    contextLimit,
                  } : null}
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

                {/* Floating composer - overlays the bottom of the message area.
                    pointer-events-none lets scroll pass through the empty gutters;
                    the centred column re-enables interaction. A gradient backdrop
                    fades messages out exactly as they reach the text field. */}
                <div
                  ref={composerDockRef}
                  className="absolute bottom-0 inset-x-0 z-20 pointer-events-none"
                  // This overlay is a DOM sibling of the message scroller, not a
                  // descendant, so native wheel scrolling stops working the moment
                  // the cursor is over its pointer-events-auto column (TurnStatus,
                  // approval cards); forward the delta manually so scroll/lock
                  // behaves the same everywhere over the conversation.
                  onWheel={(e) => forwardWheel(e.deltaY)}
                >
                  {/* Soft fade above the dock - messages dissolve just before the
                      text field (and above the Claude-owns-transcript banner when
                      it's shown) instead of hard-clipping. Mirrors the top fade. */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-gradient-to-t from-white to-transparent dark:from-surface-page" />
                  <div className="pointer-events-none absolute inset-0 bg-surface-page" />
                  <div className="relative px-5 pt-3 pb-5">
                    <div className="max-w-2xl mx-auto relative pointer-events-auto">
                      {isClaudeOwnedConversation && (
                        <ClaudeTranscriptNotice onFork={forkConversationToStudio} />
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
                      <PendingComposerInteractions
                        activeToolCalls={activeToolCalls}
                        onApprovalDecision={resolveToolApproval}
                        onQuestionAnswer={answerPendingQuestion}
                      />

                      {/* Turn status now renders inline in the scroll flow (see
                          ChatMessageList's `turnStatus` prop below) so a short
                          answer just sits below its own text wherever that
                          lands, instead of being glued to the composer as a
                          permanent HUD. It only ends up hugging the composer
                          once real content grows tall enough to reach it;
                          the existing auto-scroll pin handles that for free. */}

                      {composerBlock(conversationInputRef)}
                    </div>
                  </div>
                </div>

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
